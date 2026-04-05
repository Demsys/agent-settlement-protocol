import { JobWatcher } from './JobWatcher'
import { AssignmentWatcher } from './AssignmentWatcher'
import { ApiError, BlockchainError } from './errors'
import type {
  AgentClientOptions,
  AsyncJobResult,
  BalanceResult,
  CreateAgentResponse,
  CreateJobParams,
  JobRecord,
  JobResult,
} from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'http://localhost:3000'
const DEFAULT_WATCH_INTERVAL_MS = 3_000
/** Default per-request timeout in milliseconds (30 seconds). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

// ---------------------------------------------------------------------------
// Internal HTTP helper
//
// Thin wrapper around native fetch that:
//   - Appends the API key header when provided
//   - Parses JSON responses
//   - Maps non-2xx responses to typed ApiError instances
//   - Detects blockchain-level errors surfaced as a specific body shape
// ---------------------------------------------------------------------------

interface ApiErrorBody {
  error?: string
  code?: string
  message?: string
}

async function request<T>(
  url: string,
  options: RequestInit & { apiKey?: string; timeoutMs?: number } = {},
): Promise<T> {
  const { apiKey, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...fetchOptions } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string> | undefined),
  }

  // Only attach the auth header when an API key was provided so unauthenticated
  // routes (e.g. POST /v1/agents, GET /v1/agents/:id/balance) stay clean.
  if (apiKey) {
    headers['x-api-key'] = apiKey
  }

  // AbortController lets us cancel the fetch after the timeout elapses.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(url, { ...fetchOptions, headers, signal: controller.signal })
  } catch (networkErr) {
    // AbortError means our timeout fired — surface a clear message.
    if ((networkErr as Error).name === 'AbortError') {
      throw new BlockchainError(
        `Request to ${url} timed out after ${timeoutMs}ms`,
        'REQUEST_TIMEOUT',
      )
    }
    // fetch() itself throws on DNS / connection failures (not on HTTP errors).
    throw new BlockchainError(
      `Network error contacting ASP API at ${url}: ${String(networkErr)}`,
      'NETWORK_ERROR',
    )
  } finally {
    clearTimeout(timer)
  }

  // Parse the body regardless of status — error bodies carry useful information.
  let body: unknown
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    body = await response.json()
  } else {
    body = await response.text()
  }

  if (!response.ok) {
    const errBody = (typeof body === 'object' && body !== null ? body : {}) as ApiErrorBody
    const code = errBody.code ?? errBody.error ?? 'API_ERROR'
    const message =
      errBody.message ?? errBody.error ?? `HTTP ${response.status} from ${url}`
    throw new ApiError(response.status, code, message)
  }

  return body as T
}

// ---------------------------------------------------------------------------
// AgentClient
// ---------------------------------------------------------------------------

/**
 * Main entry point for the @asp-sdk/sdk.
 *
 * Every instance is bound to a single agent's API key.
 * Use the static factory `AgentClient.createAgent()` to provision a new agent
 * and get back a ready-to-use client in a single call.
 *
 * Example — create an agent and post a job:
 *
 *   const { client } = await AgentClient.createAgent('my-agent')
 *   const job = await client.createJob({
 *     providerAddress: '0x...',
 *     budget: '5.00',
 *   })
 *   await client.fundJob(job.jobId)
 */
export class AgentClient {
  private readonly apiKey: string | undefined
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(options: AgentClientOptions) {
    this.apiKey = options.apiKey
    // Strip trailing slash once so every path can safely be prefixed with '/'.
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  // -------------------------------------------------------------------------
  // Static factories (no API key required)
  // -------------------------------------------------------------------------

  /**
   * Register a new agent with the protocol and return a ready-to-use client.
   *
   * The returned `agentId` and `address` should be stored by the caller —
   * the API key is embedded in the returned `client` and is not re-exposed.
   *
   * @param name    Human-readable name for the agent.
   * @param baseUrl Optional API base URL. Defaults to http://localhost:3000.
   */
  static async createAgent(
    name: string,
    baseUrl?: string,
  ): Promise<{ client: AgentClient; agentId: string; address: string }> {
    const resolvedBase = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    const response = await request<CreateAgentResponse>(
      `${resolvedBase}/v1/agents`,
      {
        method: 'POST',
        body: JSON.stringify({ name }),
      },
    )

    const client = new AgentClient({ apiKey: response.apiKey, baseUrl: resolvedBase })
    return { client, agentId: response.agentId, address: response.address }
  }

  /**
   * Fetch the ETH and USDC balances for an agent by ID.
   * Does not require an API key — agent balances are public.
   *
   * @param agentId The agent ID returned from createAgent.
   * @param baseUrl Optional API base URL. Defaults to http://localhost:3000.
   */
  static async getBalance(agentId: string, baseUrl?: string): Promise<BalanceResult> {
    const resolvedBase = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    return request<BalanceResult>(`${resolvedBase}/v1/agents/${agentId}/balance`)
  }

  // -------------------------------------------------------------------------
  // Jobs
  // -------------------------------------------------------------------------

  /**
   * Create a new job on-chain. The job starts in the `open` state.
   * You must call `fundJob()` afterwards to move it to `funded`.
   *
   * @param params Job creation parameters. See CreateJobParams.
   */
  async createJob(params: CreateJobParams): Promise<JobResult> {
    return this.req<JobResult>(`${this.baseUrl}/v1/jobs`, {
      method: 'POST',
      apiKey: this.apiKey,
      body: JSON.stringify({
        providerAddress: params.providerAddress,
        budget: params.budget,
        ...(params.deadlineMinutes !== undefined && {
          deadlineMinutes: params.deadlineMinutes,
        }),
      }),
    })
  }

  /**
   * List all jobs associated with the authenticated agent.
   */
  async listJobs(): Promise<JobRecord[]> {
    const response = await this.req<{ jobs: JobRecord[] }>(
      `${this.baseUrl}/v1/jobs`,
      { apiKey: this.apiKey },
    )
    return response.jobs
  }

  /**
   * Fund a job that is currently in the `open` state.
   * This triggers the ERC-20 approve + transferFrom on-chain.
   * The job moves to `funded` upon success.
   *
   * @param jobId The job ID returned from createJob.
   */
  async fundJob(jobId: string): Promise<AsyncJobResult> {
    return this.req<AsyncJobResult>(`${this.baseUrl}/v1/jobs/${jobId}/fund`, {
      method: 'POST',
      apiKey: this.apiKey,
    })
  }

  /**
   * Submit a work deliverable for a funded job.
   * The `deliverable` is hashed on-chain; the raw content is your choice of format.
   * The job moves to `submitted` upon success.
   *
   * @param jobId       The job ID to submit work for.
   * @param deliverable The work result (URL, JSON string, IPFS CID, etc.).
   */
  async submitWork(jobId: string, deliverable: string): Promise<AsyncJobResult> {
    return this.req<AsyncJobResult>(`${this.baseUrl}/v1/jobs/${jobId}/submit`, {
      method: 'POST',
      apiKey: this.apiKey,
      body: JSON.stringify({ deliverable }),
    })
  }

  /**
   * Mark a submitted job as completed. Only the evaluator can call this.
   * Releases the escrowed funds to the provider.
   *
   * @param jobId  The job ID to complete.
   * @param reason Optional human-readable reason stored off-chain.
   */
  async completeJob(jobId: string, reason?: string): Promise<AsyncJobResult> {
    return this.req<AsyncJobResult>(`${this.baseUrl}/v1/jobs/${jobId}/complete`, {
      method: 'POST',
      apiKey: this.apiKey,
      body: JSON.stringify({ ...(reason !== undefined && { reason }) }),
    })
  }

  /**
   * Reject a submitted job. Only the evaluator can call this.
   * Returns the escrowed funds to the client.
   *
   * @param jobId  The job ID to reject.
   * @param reason Optional human-readable reason stored off-chain.
   */
  async rejectJob(jobId: string, reason?: string): Promise<JobResult> {
    return this.req<JobResult>(`${this.baseUrl}/v1/jobs/${jobId}/reject`, {
      method: 'POST',
      apiKey: this.apiKey,
      body: JSON.stringify({ ...(reason !== undefined && { reason }) }),
    })
  }

  // -------------------------------------------------------------------------
  // Observation
  // -------------------------------------------------------------------------

  /**
   * Watch a job's lifecycle by polling GET /v1/jobs/:id.
   * Returns a JobWatcher (EventEmitter) that emits typed events as the job
   * progresses and stops automatically when a terminal state is reached.
   *
   * The watcher does NOT require the job to belong to the authenticated agent —
   * GET /v1/jobs/:id is a public endpoint.
   *
   * Events:
   *   'update'    – fired on every status change (and once on first poll)
   *   'completed' – job accepted and funds released
   *   'rejected'  – job rejected by the evaluator
   *   'expired'   – deadline passed
   *   'error'     – polling error (does NOT stop the watcher automatically)
   *
   * @param jobId      The job ID to watch.
   * @param intervalMs Polling interval in milliseconds. Defaults to 3 000.
   */
  watchJob(jobId: string, intervalMs: number = DEFAULT_WATCH_INTERVAL_MS): JobWatcher {
    return new JobWatcher(jobId, (id) => this.getJobById(id), intervalMs)
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Thin wrapper around module-level `request()` that automatically injects
   * this client's configured timeout so callers don't need to repeat it.
   */
  private req<T>(url: string, options: RequestInit & { apiKey?: string } = {}): Promise<T> {
    return request<T>(url, { ...options, timeoutMs: this.timeoutMs })
  }

  /**
   * Fetch the current state of a single job by ID.
   * Used internally by JobWatcher.
   */
  /**
   * Watch for jobs assigned to a specific evaluator address.
   * Polls GET /v1/evaluator/:address/jobs (public endpoint — no API key needed).
   * Returns an AssignmentWatcher (EventEmitter) that emits typed events.
   *
   * Events:
   *   'assigned'  – new funded job assigned to this evaluator address
   *   'submitted' – an assigned job's deliverable is ready for evaluation
   *   'completed' / 'rejected' / 'expired' – terminal transitions
   *   'error'     – polling error (watcher continues)
   *
   * External evaluators (e.g. ThoughtProof) should call complete() directly
   * on the AgentJobManager contract using their own wallet — the API's
   * /complete endpoint only handles the deployer wallet.
   *
   * @param evaluatorAddress Ethereum address of the evaluator to watch.
   * @param intervalMs       Polling interval in milliseconds. Defaults to 5 000.
   */
  watchForAssignments(
    evaluatorAddress: string,
    intervalMs = 5_000,
  ): AssignmentWatcher {
    return new AssignmentWatcher(evaluatorAddress, this.baseUrl, intervalMs)
  }

  private async getJobById(jobId: string): Promise<JobRecord> {
    return this.req<JobRecord>(`${this.baseUrl}/v1/jobs/${jobId}`)
  }
}
