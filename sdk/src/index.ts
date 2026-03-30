// ---------------------------------------------------------------------------
// @asp-sdk/sdk — public API surface
//
// Everything that downstream code should import comes through here.
// Internal implementation details (JobWatcher internals, request helper, etc.)
// are intentionally NOT re-exported.
// ---------------------------------------------------------------------------

// Main client
export { AgentClient } from './AgentClient'

// Google A2A adapter
export { A2AAdapter } from './A2AAdapter'
export type { A2AAdapterOptions } from './A2AAdapter'
export type { A2ATask, A2ATaskResult, A2AAgentCard, A2AArtifact } from './types'

// Job lifecycle watcher
export { JobWatcher } from './JobWatcher'
export type { JobWatcherEvents } from './JobWatcher'

// All shared types
export type {
  JobStatus,
  TerminalJobStatus,
  JobRecord,
  CreateAgentResponse,
  BalanceResult,
  JobResult,
  AsyncJobResult,
  AgentClientOptions,
  CreateJobParams,
} from './types'

// Typed errors — re-exported so callers can do instanceof checks without
// having to import from the internal path.
export {
  AspError,
  ApiError,
  BlockchainError,
  JobNotFoundError,
  InvalidStateError,
} from './errors'

// Default export is the main client for convenience:
//   import AgentClient from '@asp-sdk/sdk'
export { AgentClient as default } from './AgentClient'
