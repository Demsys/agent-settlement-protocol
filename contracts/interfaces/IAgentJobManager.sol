// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

/**
 * @title IAgentJobManager
 * @notice Interface for the Agentic Commerce protocol (ERC-8183).
 *         Defines the complete lifecycle of a Job between AI agents:
 *         escrow, evaluation, settlement, and expiration.
 * @dev Reference implementation of ERC-8183 (Davide Crapis, Ethereum Foundation
 *      & Virtuals Protocol, March 10 2026), extended with:
 *      - Automatic evaluator assignment from EvaluatorRegistry when evaluator == address(0)
 *      - Protocol fee hook (1%) on complete(), governed via ProtocolToken
 *      - Pull-based refunds to prevent griefing by malicious token contracts
 *
 *      State machine (transitions are strictly forward — never backward):
 *
 *        Open ──fund()──────────────► Funded ──submit()──► Submitted ──complete()──► Completed
 *          │                            │                       │
 *          └──reject() [Client only]    └──reject() [Evaluator] └──reject() [Evaluator]
 *          ▼                            │                       ▼
 *        Rejected ◄───────────────────-┘                     Rejected
 *                                      │                       │
 *                                  (deadline)             (deadline)
 *                                      │                       │
 *                                      └──────────┬────────────┘
 *                                                 ▼
 *                                              Expired
 *
 *      FINDING-004: claimExpired() now accepts both Funded and Submitted states
 *      to prevent funds being permanently locked when the Evaluator disappears.
 */
interface IAgentJobManager {

    // ─── Enums ────────────────────────────────────────────────────────────────

    /**
     * @notice The six possible states of a Job. Transitions are strictly
     *         forward — a job can never revert to a previous state.
     */
    enum JobStatus {
        Open,       // Job created, waiting for the Client to deposit funds
        Funded,     // Budget locked in escrow, waiting for Provider execution
        Submitted,  // Deliverable submitted by Provider, awaiting Evaluator verdict
        Completed,  // Evaluator approved — Provider has been paid
        Rejected,   // Evaluator or Client rejected — Client refund pending
        Expired     // Deadline passed before Submitted — Client refund pending
    }

    // ─── Structs ──────────────────────────────────────────────────────────────

    /**
     * @notice Full on-chain representation of a Job.
     * @dev budget and deadline are packed into a single 32-byte storage slot
     *      (uint128 + uint64 + uint64 = 256 bits) to save gas on frequent reads.
     *      budget MUST be zeroed out before any token transfer to guard against
     *      reentrancy even when ReentrancyGuard is present (defense in depth).
     */
    struct Job {
        address   client;       // Creator of the job; receives refund on Rejected/Expired
        address   provider;     // Executes the task; receives payment on Completed
        address   evaluator;    // Arbitrates the result; set by EvaluatorRegistry if address(0) at creation
        address   token;        // ERC-20 token used for payment (e.g. USDC)
        uint128   budget;       // Amount locked in escrow (in token's native decimals)
        uint64    deadline;     // Unix timestamp — job auto-expires if block.timestamp > deadline
        uint64    createdAt;    // Block timestamp at creation — used for reputation scoring
        JobStatus status;
        bytes32   deliverable;  // Keccak256 hash of the Provider's deliverable (set by submit())
        bytes32   reason;       // Keccak256 hash of the Evaluator's verdict report (set by complete/reject)
    }

    // ─── Events ───────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when a new Job is created at state Open.
     * @dev Indexed on client and provider so agents can efficiently filter
     *      their own jobs via getLogs without scanning all jobs.
     */
    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        address token,
        uint64  deadline
    );

    /**
     * @notice Emitted when the budget is set or updated on an Open job.
     * @dev The budget can be proposed by Client or Provider before funding.
     */
    event BudgetSet(uint256 indexed jobId, uint128 amount);

    /**
     * @notice Emitted when the Client locks funds in escrow — job transitions to Funded.
     */
    event JobFunded(uint256 indexed jobId, uint128 amount);

    /**
     * @notice Emitted when the Provider submits a deliverable — job transitions to Submitted.
     */
    event JobSubmitted(uint256 indexed jobId, bytes32 deliverable);

    /**
     * @notice Emitted when the Evaluator approves the deliverable — job transitions to Completed.
     * @param payment Net amount transferred to the Provider after protocol fee deduction.
     * @param fee     Protocol fee amount extracted and sent to the fee recipient.
     */
    event JobCompleted(
        uint256 indexed jobId,
        address indexed provider,
        uint256 payment,
        uint256 fee
    );

    /**
     * @notice Emitted when a job is rejected — job transitions to Rejected.
     *         The refund is not pushed immediately; use claimRefund().
     * @param refundedTo Address entitled to claim the refund (always the Client).
     */
    event JobRejected(
        uint256 indexed jobId,
        address indexed refundedTo,
        bytes32 reason
    );

    /**
     * @notice Emitted when a funded job's deadline passes — job transitions to Expired.
     *         Triggered by claimExpired(); the refund is not pushed immediately.
     * @param refundedTo Address entitled to claim the refund (always the Client).
     */
    event JobExpired(
        uint256 indexed jobId,
        address indexed refundedTo
    );

    /**
     * @notice Emitted when the deadline of a job is extended.
     * @dev Emitted in two contexts:
     *      1. When the Client calls extendDeadline() on a Funded job (voluntary extension).
     *      2. When submit() auto-extends the deadline because less than MIN_EVALUATION_WINDOW
     *         remains — protecting the Provider from a deadline-griefing attack (FINDING #3).
     *      Both old and new deadlines are logged so indexers can track the full history.
     */
    event DeadlineExtended(uint256 indexed jobId, uint64 oldDeadline, uint64 newDeadline);

    /**
     * @notice Emitted when a refund is registered for later claim (Pull over Push pattern).
     * @dev Separating this event from JobRejected/JobExpired lets the SDK track
     *      pending refunds independently from job status changes.
     */
    event RefundPending(
        address indexed client,
        address indexed token,
        uint256 amount
    );

    /**
     * @notice Emitted when a Client successfully claims a pending refund.
     */
    event RefundClaimed(
        address indexed client,
        address indexed token,
        uint256 amount
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    /// @notice Thrown when a jobId does not correspond to any existing job.
    error JobNotFound(uint256 jobId);

    /// @notice Thrown when a state transition is attempted from an invalid current state.
    /// @param jobId   The job that triggered the revert.
    /// @param current The actual current state of the job.
    error InvalidJobStatus(uint256 jobId, JobStatus current);

    /// @notice Thrown when the caller is not the role required by the function.
    /// @param caller The address that made the call.
    /// @param jobId  The job on which the unauthorized action was attempted.
    /// @param role   Human-readable name of the required role ("client", "provider", "evaluator").
    error NotAuthorized(address caller, uint256 jobId, string role);

    /// @notice Thrown when a deadline is too soon (minimum: block.timestamp + 5 minutes).
    error DeadlineTooSoon(uint64 provided, uint64 minimum);

    /// @notice Thrown when the amount passed to fund() does not match the agreed budget.
    error BudgetMismatch(uint128 expected, uint128 provided);

    /// @notice Thrown when a budget value exceeds uint128.max during a downcast.
    error BudgetExceedsMaximum(uint256 provided, uint256 maximum);

    /// @notice Thrown when a required address parameter is address(0).
    /// @param paramName Name of the parameter that must not be zero ("provider", "token", etc.).
    error ZeroAddress(string paramName);

    /// @notice Thrown when two roles that must differ are set to the same address.
    /// @param paramName The role being assigned that conflicts ("provider", "evaluator").
    error SelfAssignment(string paramName);

    /// @notice Thrown when claimRefund() is called but the caller has no pending refund.
    error NothingToRefund();

    /// @notice Thrown when createJob() is called with an evaluator that is not registered
    ///         and eligible in the EvaluatorRegistry.
    /// @dev Prevents a client from designating an unstaked accomplice as evaluator,
    ///      bypassing all cryptoeconomic guarantees of the staker network.
    error EvaluatorNotEligible(address evaluator);

    /// @notice Thrown when setBudget() is called with an amount below MIN_BUDGET.
    /// @dev Prevents budgets so small that fee calculation rounds to zero, making the
    ///      protocol unable to collect its fee at any feeRate.
    error BudgetBelowMinimum(uint128 amount, uint128 minimum);

    // ─── Core ERC-8183 Functions ──────────────────────────────────────────────

    /**
     * @notice Creates a new Job and places it in the Open state.
     * @dev If evaluator is address(0), the implementation MUST call
     *      EvaluatorRegistry.assignEvaluator(jobId) during fund() to ensure
     *      an evaluator is set before the job becomes Funded.
     *      Reverts if: provider == address(0), token == address(0),
     *      provider == msg.sender, evaluator == msg.sender,
     *      evaluator == provider, or deadline < block.timestamp + 5 minutes.
     * @param provider  Address of the agent that will execute the task.
     * @param evaluator Address of the arbitrator. Pass address(0) to auto-assign
     *                  from the decentralized EvaluatorRegistry staker network.
     * @param token     ERC-20 token address for payment (USDC recommended).
     * @param deadline  Unix timestamp deadline. Minimum: block.timestamp + 5 minutes.
     * @return jobId    Unique identifier for the created job.
     */
    function createJob(
        address provider,
        address evaluator,
        address token,
        uint64  deadline
    ) external returns (uint256 jobId);

    /**
     * @notice Sets or updates the agreed budget on an Open job.
     * @dev Either the Client or the Provider may propose the budget while the
     *      job is Open. The final value must match exactly when fund() is called.
     *      Reverts if the job is not in Open state, or if amount is 0.
     * @param jobId  The job to set the budget on.
     * @param amount Budget in the token's native decimals (e.g. 5_000_000 for 5 USDC).
     */
    function setBudget(uint256 jobId, uint128 amount) external;

    /**
     * @notice Locks the budget in escrow — transitions job from Open to Funded.
     * @dev The caller (Client) must have previously approved this contract for
     *      at least `expectedBudget` of the job's token.
     *      If job.evaluator is address(0), this function MUST call
     *      EvaluatorRegistry.assignEvaluator() before completing.
     *      Uses SafeERC20.safeTransferFrom — compatible with fee-on-transfer tokens
     *      only if token is whitelisted; verify received amount matches expectedBudget.
     *      Reverts if: job is not Open, msg.sender is not the Client,
     *      expectedBudget != job.budget, or the token transfer fails.
     * @param jobId          The job to fund.
     * @param expectedBudget Must match the budget set by setBudget() exactly (prevents
     *                       front-running between setBudget and fund).
     */
    function fund(uint256 jobId, uint128 expectedBudget) external;

    /**
     * @notice Provider submits a deliverable — transitions job from Funded to Submitted.
     * @dev The deliverable is stored as a bytes32 hash. The actual content is
     *      communicated off-chain via the A2A protocol; only the commitment
     *      is recorded on-chain for the Evaluator to verify.
     *      Reverts if: job is not Funded, msg.sender is not the Provider,
     *      block.timestamp > job.deadline (use claimExpired instead),
     *      or deliverable is bytes32(0).
     * @param jobId       The job to submit a deliverable for.
     * @param deliverable Keccak256 hash of the submitted work product.
     */
    function submit(uint256 jobId, bytes32 deliverable) external;

    /**
     * @notice Evaluator approves the deliverable — transitions job to Completed
     *         and releases payment to the Provider minus the protocol fee.
     * @dev Implements the CEI pattern strictly:
     *      (1) Checks: status == Submitted, msg.sender == evaluator
     *      (2) Effects: status = Completed, budget = 0, record fee split
     *      (3) Interactions: safeTransfer to provider, safeTransfer to feeRecipient
     *      The protocol fee (feeRate basis points, max 500 = 5%) is sent to the
     *      fee recipient (ProtocolToken) which handles burn and staker distribution.
     *      Fee rounding always favors the Provider (truncation toward zero).
     *      Reverts if: job is not Submitted, or msg.sender is not the Evaluator.
     * @param jobId  The job to mark as completed.
     * @param reason Keccak256 hash of the evaluation report. Pass bytes32(0) if none.
     */
    function complete(uint256 jobId, bytes32 reason) external;

    /**
     * @notice Rejects a job and registers a refund for the Client (Pull pattern).
     * @dev Valid callers and states:
     *      - Client: only when status == Open (cancellation before funding)
     *      - Evaluator: when status == Funded or status == Submitted
     *      No other caller or state combination is permitted.
     *      Refund is NOT pushed to the Client immediately. The Client must call
     *      claimRefund() to receive their funds (Pull over Push, prevents griefing).
     *      Implements CEI: budget zeroed before emit, refund registered atomically.
     *      Reverts if: caller is not authorized for the current state.
     * @param jobId  The job to reject.
     * @param reason Keccak256 hash of the rejection rationale. Pass bytes32(0) if none.
     */
    function reject(uint256 jobId, bytes32 reason) external;

    /**
     * @notice Client triggers expiration and registers a refund after the deadline.
     * @dev FINDING-004 fix: callable when status == Funded OR status == Submitted,
     *      provided block.timestamp > job.deadline.
     *      Transitions the job to Expired and registers the full budget as a
     *      pending refund for the Client (Pull over Push pattern).
     *      Rationale for accepting Submitted state: if the Provider has submitted
     *      but the Evaluator disappears before the deadline, the funds would be
     *      permanently locked without this transition. The Client is refunded as
     *      the minimal safe outcome — the Provider's recourse is to select a
     *      reliable Evaluator at job creation time.
     *      Not callable on Open jobs (no funds at stake).
     *      Reverts if: job is not Funded or Submitted, deadline has not passed, or
     *      msg.sender is not the Client.
     * @param jobId The funded or submitted job whose deadline has passed.
     */
    function claimExpired(uint256 jobId) external;

    // ─── Refund Claim Function (Pull over Push) ───────────────────────────────

    /**
     * @notice Client claims all pending refunds accumulated across rejected/expired jobs.
     * @dev Aggregates refunds per (caller, token) pair. A single call claims
     *      the full pending balance for one token.
     *      Implements CEI strictly: balance zeroed before safeTransfer.
     *      Protected by ReentrancyGuard in the implementation.
     *      Reverts with NothingToRefund() if the caller has no pending balance
     *      for the specified token.
     * @param token ERC-20 token address for which to claim the pending refund.
     */
    function claimRefund(address token) external;

    // ─── View Functions ───────────────────────────────────────────────────────

    /**
     * @notice Returns the full state of a Job.
     * @dev Returns a memory copy — callers should not assume the struct is live.
     *      Reverts with JobNotFound if jobId does not exist.
     * @param jobId The job to query.
     * @return The full Job struct at the time of the call.
     */
    function getJob(uint256 jobId) external view returns (Job memory);

    /**
     * @notice Returns the current protocol fee rate in basis points.
     * @dev 100 = 1%, 500 = 5% (maximum). Governed by ProtocolToken DAO.
     *      Used by the SDK to compute expected payment amounts off-chain.
     * @return Fee rate in basis points.
     */
    function getFeeRate() external view returns (uint256);

    /**
     * @notice Returns the pending refund balance for a given (client, token) pair.
     * @dev Allows the SDK to display the claimable amount before calling claimRefund().
     * @param client Address of the client whose balance to query.
     * @param token  ERC-20 token address to query the balance for.
     * @return Pending refund amount in the token's native decimals.
     */
    function getPendingRefund(address client, address token) external view returns (uint256);
}
