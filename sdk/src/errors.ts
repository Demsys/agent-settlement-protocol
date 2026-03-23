// ---------------------------------------------------------------------------
// Typed error classes for the @asp/sdk
//
// All SDK errors extend AspError so callers can do a single catch and narrow
// down with instanceof. The `code` field is machine-readable and stable
// across versions — never use the `message` string for branching logic.
// ---------------------------------------------------------------------------

/**
 * Base class for all errors thrown by the @asp/sdk.
 * Never thrown directly — always use a concrete subclass.
 */
export class AspError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    // Restore prototype chain so `instanceof` works after transpilation to ES5.
    Object.setPrototypeOf(this, new.target.prototype)
    this.name = new.target.name
  }
}

/**
 * Thrown when the API server returns a non-2xx HTTP response.
 * The `status` field is the HTTP status code (e.g. 400, 401, 404, 500).
 * The `code` field is the machine-readable error code from the API body
 * (e.g. "INSUFFICIENT_BALANCE", "JOB_NOT_FOUND").
 */
export class ApiError extends AspError {
  constructor(
    public readonly status: number,
    code: string,
    message: string,
  ) {
    super(code, message)
  }
}

/**
 * Thrown when a blockchain-level failure occurs that the API surfaced
 * (e.g. transaction revert, gas estimation failure).
 * This is distinct from ApiError: the HTTP call itself succeeded (2xx)
 * but the on-chain operation failed.
 */
export class BlockchainError extends AspError {
  constructor(message: string, code = 'BLOCKCHAIN_ERROR') {
    super(code, message)
  }
}

/**
 * Thrown when the requested job does not exist in the system.
 * HTTP equivalent: 404.
 */
export class JobNotFoundError extends AspError {
  constructor(jobId: string) {
    super('JOB_NOT_FOUND', `Job "${jobId}" was not found`)
  }
}

/**
 * Thrown when an operation is attempted on a job that is in an incompatible
 * state (e.g. trying to fund an already-funded job, or submit on a completed job).
 */
export class InvalidStateError extends AspError {
  constructor(jobId: string, currentStatus: string, requiredStatus: string) {
    super(
      'INVALID_STATE',
      `Job "${jobId}" is in state "${currentStatus}" but "${requiredStatus}" is required for this operation`,
    )
  }
}
