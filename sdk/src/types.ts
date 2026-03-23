// ---------------------------------------------------------------------------
// Shared TypeScript types for the @asp/sdk
// These mirror the server-side storage types and API response shapes,
// but are kept independent so the SDK has zero server-side dependencies.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Domain primitives
// ---------------------------------------------------------------------------

/** All possible on-chain/off-chain states a job can be in. */
export type JobStatus =
  | 'open'
  | 'funded'
  | 'submitted'
  | 'completed'
  | 'rejected'
  | 'expired'

/** States from which no further transitions are possible. */
export type TerminalJobStatus = 'completed' | 'rejected' | 'expired'

// ---------------------------------------------------------------------------
// Storage-level records (shape returned by the API for job listings)
// ---------------------------------------------------------------------------

/**
 * Full job record as stored and returned by the API server.
 * Mirrors api/src/storage.ts JobRecord.
 */
export interface JobRecord {
  jobId: string
  agentId: string
  txHash: string
  status: JobStatus
  providerAddress: string
  /** Human-readable amount, e.g. "5.00" */
  budget: string
  deadlineMinutes: number
  createdAt: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

/** Response from POST /v1/agents */
export interface CreateAgentResponse {
  agentId: string
  address: string
  apiKey: string
}

/** Response from GET /v1/agents/:id/balance */
export interface BalanceResult {
  ethBalance: string
  usdcBalance: string
}

/** Response from POST /v1/jobs and POST /v1/jobs/:id/fund */
export interface JobResult {
  jobId: string
  txHash: string
  basescanUrl: string
  status: JobStatus
}

/** Response from POST /v1/jobs/:id/submit */
export interface SubmitResult {
  jobId: string
  txHash: string
  deliverableHash: string
  status: JobStatus
}

// ---------------------------------------------------------------------------
// Input parameter types
// ---------------------------------------------------------------------------

/** Parameters for AgentClient constructor */
export interface AgentClientOptions {
  /** API key obtained from POST /v1/agents. Required for authenticated routes. */
  apiKey: string
  /**
   * Base URL of the ASP API server.
   * Defaults to http://localhost:3000
   */
  baseUrl?: string
}

/** Parameters for createJob */
export interface CreateJobParams {
  /** Ethereum address of the provider agent that will execute the work. */
  providerAddress: string
  /** Human-readable budget in USDC, e.g. "5.00". */
  budget: string
  /** Job deadline in minutes. Defaults to 60 if not provided. */
  deadlineMinutes?: number
}
