// ---------------------------------------------------------------------------
// @asp/sdk — public API surface
//
// Everything that downstream code should import comes through here.
// Internal implementation details (JobWatcher internals, request helper, etc.)
// are intentionally NOT re-exported.
// ---------------------------------------------------------------------------

// Main client
export { AgentClient } from './AgentClient'

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
  SubmitResult,
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
//   import AgentClient from '@asp/sdk'
export { AgentClient as default } from './AgentClient'
