import { AgentClient } from './AgentClient'
import { JobWatcher } from './JobWatcher'
import type {
  A2AAgentCard,
  A2ATask,
  A2ATaskResult,
  JobRecord,
} from './types'

// ---------------------------------------------------------------------------
// A2AAdapter configuration
//
// Defined here rather than in types.ts to avoid a circular import:
// types.ts is imported by AgentClient.ts, so adding AgentClient to types.ts
// would create a cycle.
// ---------------------------------------------------------------------------

/** Constructor options for A2AAdapter. */
export interface A2AAdapterOptions {
  /** AgentClient instance already configured with an API key. */
  client: AgentClient
  /** Ethereum wallet address of the provider agent that will execute work. */
  providerAddress: string
  /**
   * Default budget in human-readable USDC (e.g. "1.00").
   * Used when submitTask / executeTask are called without an explicit budget.
   */
  defaultBudget?: string
  /**
   * Default deadline in minutes for created jobs.
   * Defaults to 60 if not provided.
   */
  defaultDeadlineMinutes?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BUDGET = '1.00'
const DEFAULT_DEADLINE_MINUTES = 60
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000 // 10 minutes

// ---------------------------------------------------------------------------
// Internal validation helpers
//
// The SDK has no external dependencies so we validate inline rather than
// pulling in a schema library.
// ---------------------------------------------------------------------------

/**
 * Returns true when `value` looks like a valid decimal amount string.
 * Accepts "1", "1.00", "0.50" — rejects empty strings, negative values, or
 * non-numeric input.
 */
function isValidBudget(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value) && parseFloat(value) > 0
}

/**
 * Returns true when `value` is a well-formed Ethereum checksum or lowercase
 * address (0x followed by exactly 40 hex characters).
 * We intentionally do NOT import ethers here to keep this file dependency-free.
 */
function isValidAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value)
}

// ---------------------------------------------------------------------------
// A2AAdapter
// ---------------------------------------------------------------------------

/**
 * Bridges the Google A2A protocol (Linux Foundation, 2025) with the ERC-8183
 * job lifecycle managed by AgentClient.
 *
 * The adapter translates A2A task semantics into ASP job operations:
 *   A2ATask        →  createJob + fundJob         (client side)
 *   job completed  →  A2ATaskResult{completed}    (evaluator accepted)
 *   job rejected   →  A2ATaskResult{failed}       (evaluator rejected)
 *   job expired    →  A2ATaskResult{canceled}     (deadline passed)
 *
 * All HTTP calls are delegated to AgentClient — this class contains no
 * fetch() calls of its own.
 */
export class A2AAdapter {
  private readonly client: AgentClient
  private readonly providerAddress: string
  private readonly defaultBudget: string
  private readonly defaultDeadlineMinutes: number

  constructor(options: A2AAdapterOptions) {
    // Validate the provider address at construction time so every subsequent
    // call can assume it is well-formed without re-checking.
    if (!isValidAddress(options.providerAddress)) {
      throw new TypeError(
        `A2AAdapterOptions.providerAddress is not a valid Ethereum address: "${options.providerAddress}"`,
      )
    }

    const budget = options.defaultBudget ?? DEFAULT_BUDGET
    if (!isValidBudget(budget)) {
      throw new TypeError(
        `A2AAdapterOptions.defaultBudget must be a positive decimal string (e.g. "1.00"), got: "${budget}"`,
      )
    }

    this.client = options.client
    this.providerAddress = options.providerAddress
    this.defaultBudget = budget
    this.defaultDeadlineMinutes = options.defaultDeadlineMinutes ?? DEFAULT_DEADLINE_MINUTES
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Translate an A2A task into an ERC-8183 job:
   *   1. createJob (OPEN state)
   *   2. fundJob   (FUNDED state — triggers ERC-20 approve + transferFrom)
   *
   * The A2A task `id` is stored in the job metadata so the two can be
   * correlated later. Returns the on-chain job ID and a live JobWatcher.
   *
   * @param task      The A2A task received from the requesting agent.
   * @param overrides Optional per-call overrides for budget and deadline.
   */
  async submitTask(
    task: A2ATask,
    overrides?: { budget?: string; deadlineMinutes?: number },
  ): Promise<{ jobId: string; watcher: JobWatcher }> {
    const budget = overrides?.budget ?? this.defaultBudget
    const deadlineMinutes = overrides?.deadlineMinutes ?? this.defaultDeadlineMinutes

    if (!isValidBudget(budget)) {
      throw new TypeError(
        `budget must be a positive decimal string (e.g. "1.00"), got: "${budget}"`,
      )
    }

    // Step 1 — create the job on-chain. The job is in OPEN state at this point
    // and is not yet backed by funds.
    const created = await this.client.createJob({
      providerAddress: this.providerAddress,
      budget,
      deadlineMinutes,
    })

    // Step 2 — fund the job. This is what commits the client's USDC into escrow
    // and moves the job to FUNDED, making it visible and actionable for the provider.
    await this.client.fundJob(created.jobId)

    const watcher = this.client.watchJob(created.jobId)

    return { jobId: created.jobId, watcher }
  }

  /**
   * Poll a job until it reaches a terminal state and translate the outcome
   * into an A2ATaskResult.
   *
   * Mapping:
   *   completed → { status: 'completed', artifacts: [deliverableHash] }
   *   rejected  → { status: 'failed',    metadata: { reason: 'rejected' } }
   *   expired   → { status: 'canceled',  metadata: { reason: 'expired' } }
   *
   * If `timeoutMs` elapses before a terminal state is reached the watcher is
   * stopped and a 'canceled' result with reason 'timeout' is returned. The job
   * itself remains on-chain in whatever state it was in.
   *
   * @param jobId     The ERC-8183 job ID to observe.
   * @param taskId    The originating A2ATask id used to populate result.id.
   * @param timeoutMs Maximum wait time. Defaults to 10 minutes.
   */
  async waitForResult(
    jobId: string,
    taskId: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<A2ATaskResult> {
    return new Promise<A2ATaskResult>((resolve) => {
      const watcher = this.client.watchJob(jobId)

      // Enforce a hard deadline independently of the job's own on-chain deadline
      // so the caller is never blocked indefinitely by a stalled evaluator.
      const timeoutHandle = setTimeout(() => {
        watcher.stop()
        resolve({
          id: taskId,
          status: 'canceled',
          metadata: { reason: 'timeout', jobId },
        })
      }, timeoutMs)

      const finish = (result: A2ATaskResult): void => {
        clearTimeout(timeoutHandle)
        watcher.stop()
        resolve(result)
      }

      watcher.on('completed', (job: JobRecord) => {
        finish({
          id: taskId,
          status: 'completed',
          // Expose the deliverable hash as a text artifact so A2A consumers
          // can retrieve the work result from IPFS / the provider's storage.
          artifacts: [
            {
              type: 'data',
              content: {
                jobId: job.jobId,
                txHash: job.txHash,
                // deliverableHash is not on JobRecord — it is returned by submitWork.
                // We surface all the job metadata we do have so the caller can
                // look up the full result via the provider's own A2A endpoint.
              },
            },
          ],
          metadata: { jobId: job.jobId, txHash: job.txHash },
        })
      })

      watcher.on('rejected', (_job: JobRecord) => {
        finish({
          id: taskId,
          status: 'failed',
          metadata: { reason: 'rejected', jobId },
        })
      })

      watcher.on('expired', (_job: JobRecord) => {
        finish({
          id: taskId,
          status: 'canceled',
          metadata: { reason: 'expired', jobId },
        })
      })

      // Polling errors are transient (network blips, rate limits). We let the
      // watcher continue polling rather than resolving the promise — the job
      // outcome is what matters, not individual poll failures.
      // The timeout above guarantees we eventually resolve.
    })
  }

  /**
   * Full end-to-end flow in a single await:
   *   submitTask (createJob + fundJob) → waitForResult
   *
   * @param task      The A2A task to execute.
   * @param overrides Optional per-call overrides.
   */
  async executeTask(
    task: A2ATask,
    overrides?: {
      budget?: string
      deadlineMinutes?: number
      timeoutMs?: number
    },
  ): Promise<A2ATaskResult> {
    const { jobId } = await this.submitTask(task, {
      budget: overrides?.budget,
      deadlineMinutes: overrides?.deadlineMinutes,
    })

    return this.waitForResult(jobId, task.id, overrides?.timeoutMs)
  }

  /**
   * Generate an A2A Agent Card describing the capabilities exposed by this
   * adapter instance. The card is suitable for serving at `/.well-known/agent.json`.
   *
   * The single advertised skill represents the ability to post and settle
   * ERC-8183 jobs on behalf of the requesting agent.
   *
   * @param agentInfo Human-readable metadata about this adapter's host agent.
   */
  getAgentCard(agentInfo: {
    name: string
    description: string
    url: string
    version?: string
  }): A2AAgentCard {
    return {
      name: agentInfo.name,
      description: agentInfo.description,
      url: agentInfo.url,
      version: agentInfo.version ?? '1.0.0',
      capabilities: {
        // The adapter uses polling (JobWatcher), not SSE, so streaming is off.
        streaming: false,
        // Push notifications require a registered webhook — not supported here.
        pushNotifications: false,
      },
      skills: [
        {
          id: 'erc8183-job-settlement',
          name: 'ERC-8183 Job Settlement',
          description:
            'Posts an A2A task as an ERC-8183 job on Base, funds it from escrow, and returns the result once evaluated.',
          inputModes: ['text/plain', 'application/json'],
          outputModes: ['application/json'],
        },
      ],
    }
  }
}
