// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─── OpenZeppelin imports ────────────────────────────────────────────────────
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// ─── Internal imports ────────────────────────────────────────────────────────
import "../interfaces/IAgentJobManager.sol";
import "./EvaluatorRegistry.sol";

// ─── Local interface for ReputationBridge ────────────────────────────────────
// Defined here (not imported from ReputationBridge.sol) to avoid a circular
// dependency: AgentJobManager → ReputationBridge → (potentially) AgentJobManager.
// Using a minimal interface is the standard pattern (cf. IUniswap, IChainlink).
interface IReputationBridge {
    /**
     * @notice Records a job outcome in the ERC-8004 reputation registry.
     * @param jobId     The job that reached a terminal state.
     * @param provider  Address of the job's provider agent.
     * @param evaluator Address of the job's evaluator agent.
     * @param completed True if the job was completed, false if rejected.
     * @param reason    Keccak256 hash of the evaluation report.
     */
    function recordJobOutcome(
        uint256 jobId,
        address provider,
        address evaluator,
        bool    completed,
        bytes32 reason
    ) external;
}

/**
 * @title AgentJobManager
 * @notice Reference implementation of ERC-8183 (Agentic Commerce) for the
 *         Agent Settlement Protocol. Manages the full lifecycle of AI agent jobs:
 *         escrow, submission, evaluation, payment, and expiration.
 * @dev Implements IAgentJobManager with four protocol extensions:
 *      1. Automatic evaluator assignment from EvaluatorRegistry (when evaluator == address(0))
 *      2. Protocol fee hook on complete() — feeRate basis points sent to feeRecipient
 *      3. Pull-based refunds via pendingRefunds mapping to prevent griefing
 *      4. Optional ReputationBridge integration: complete()/reject() forward outcomes
 *         to IReputationBridge.recordJobOutcome() when reputationBridge != address(0)
 *
 *      State machine (strictly forward transitions — see IAgentJobManager):
 *        Open → Funded → Submitted → Completed
 *        Open → Rejected
 *        Funded → Rejected (evaluator only)
 *        Funded → Expired (claimExpired, after deadline)
 *        Submitted → Expired (claimExpired, after deadline — FINDING-004 fix)
 *        Submitted → Rejected (evaluator only)
 *
 *      Security guarantees:
 *      - All fund-moving functions follow Checks-Effects-Interactions (CEI)
 *      - All fund-moving functions are protected by ReentrancyGuard
 *      - All token transfers use SafeERC20 (handles non-standard ERC-20s like USDT)
 *      - Refunds use Pull over Push to prevent griefing
 *      - Fee rounding always favors the Provider (truncation toward zero)
 *      - Budget is zeroed before any transfer as defense-in-depth against reentrancy
 *      - feeRecipient must be set at construction time — complete() cannot silently
 *        burn fees (FINDING-003 fix)
 *
 * @custom:security This contract holds user funds. It has been designed with
 *                  defense-in-depth: ReentrancyGuard + CEI + budget zeroing
 *                  before transfers. Do not remove any of these layers.
 */
contract AgentJobManager is IAgentJobManager, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice Maximum protocol fee rate in basis points (500 = 5%).
    /// @dev Hardcoded ceiling to prevent governance from extracting all funds.
    ///      Even with full governance compromise, fees cannot exceed 5%.
    uint256 public constant MAX_FEE_RATE = 500;

    /// @notice Minimum time between job creation and deadline.
    uint64 public constant MIN_DEADLINE_OFFSET = 5 minutes;

    // ─── Immutables ───────────────────────────────────────────────────────────

    /// @notice The EvaluatorRegistry used to auto-assign evaluators.
    /// @dev Immutable — never changes after deployment.
    EvaluatorRegistry public immutable evaluatorRegistry;

    // ─── State variables ──────────────────────────────────────────────────────

    /// @notice Current protocol fee rate in basis points. 100 = 1%.
    /// @dev Governed by the owner (DAO post-launch). Bounded by MAX_FEE_RATE.
    uint256 public feeRate;

    /// @notice Address that receives the protocol fee on complete().
    /// @dev Validated non-zero at construction (FINDING-003). The ProtocolToken
    ///      then handles burn (50%) and staker distribution (50%).
    address public feeRecipient;

    /// @notice Address of the ReputationBridge contract to notify on job settlement.
    /// @dev Optional: when address(0), reputation forwarding is silently skipped.
    ///      Set via setReputationBridge(). Can be reset to address(0) to disable.
    address public reputationBridge;

    /// @notice Auto-incrementing job ID counter. Starts at 1 (0 is reserved as "no job").
    uint256 private nextJobId;

    /// @notice All jobs, keyed by job ID.
    mapping(uint256 => Job) private jobs;

    /// @notice Tracks which job IDs have been created (to distinguish "not found" from "ID 0").
    mapping(uint256 => bool) private jobExists;

    /// @notice Pending refunds per (client address, token address).
    /// @dev Pull over Push: refunds are accumulated here and claimed via claimRefund().
    ///      Using a nested mapping (client => token => amount) allows a single client
    ///      to have refunds in multiple token types across different jobs.
    mapping(address => mapping(address => uint256)) private pendingRefunds;

    // ─── Events not in interface (implementation-specific) ───────────────────

    /**
     * @notice Emitted when the reputationBridge address is updated.
     * @dev address(0) means reputation forwarding is disabled.
     */
    event ReputationBridgeUpdated(address indexed newBridge);

    // ─── Errors not in interface (implementation-specific) ───────────────────

    /// @notice Thrown when the fee rate exceeds MAX_FEE_RATE.
    error FeeRateExceedsMaximum(uint256 provided, uint256 maximum);

    /// @notice Thrown when the budget has not been set (is 0) at fund() time.
    error BudgetNotSet(uint256 jobId);

    /// @notice Thrown when submit() is called after the deadline has passed.
    error DeadlinePassed(uint256 jobId, uint64 deadline, uint64 current);

    /// @notice Thrown when claimExpired() is called before the deadline.
    error DeadlineNotPassed(uint256 jobId, uint64 deadline, uint64 current);

    /// @notice Thrown when deliverable hash is zero (not allowed in submit).
    error ZeroDeliverable(uint256 jobId);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    /**
     * @dev Reverts with JobNotFound if the job ID does not exist.
     *      Used on all functions that operate on an existing job.
     */
    modifier jobMustExist(uint256 jobId) {
        if (!jobExists[jobId]) revert JobNotFound(jobId);
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @notice Deploys the AgentJobManager with initial configuration.
     * @dev FINDING-003 fix: _feeRecipient is now a required constructor parameter.
     *      Requiring it at construction prevents the contract from being deployed
     *      in a state where complete() would revert with a non-obvious SafeERC20
     *      error, permanently trapping funds of Submitted jobs.
     *      The setter setFeeRecipient() is kept for governance rotation, but
     *      the initial value is always validated here.
     * @param _evaluatorRegistry Address of the deployed EvaluatorRegistry contract.
     * @param _feeRate           Initial fee rate in basis points (100 = 1%).
     * @param _feeRecipient      Address that receives the protocol fee on complete().
     *                           Must be non-zero. Typically the ProtocolToken address.
     */
    constructor(
        address _evaluatorRegistry,
        uint256 _feeRate,
        address _feeRecipient
    ) Ownable(msg.sender) {
        if (_evaluatorRegistry == address(0)) revert ZeroAddress("evaluatorRegistry");
        if (_feeRate > MAX_FEE_RATE) revert FeeRateExceedsMaximum(_feeRate, MAX_FEE_RATE);
        // FINDING-003: feeRecipient must be set at deployment. If address(0) were
        // accepted, any job reaching Submitted state with feeRate > 0 would have its
        // funds permanently locked — complete() would revert on safeTransfer(address(0)).
        if (_feeRecipient == address(0)) revert ZeroAddress("feeRecipient");

        evaluatorRegistry = EvaluatorRegistry(_evaluatorRegistry);
        feeRate = _feeRate;
        feeRecipient = _feeRecipient;
        nextJobId = 1; // Start at 1 so that jobId 0 is always "invalid"
    }

    // ─── External functions (ERC-8183 core) ──────────────────────────────────

    /**
     * @notice Creates a new Job and places it in the Open state.
     * @dev If evaluator is address(0), the EvaluatorRegistry will be called during
     *      fund() to assign an evaluator automatically. Budget is not set here —
     *      call setBudget() before fund().
     *      Reverts if: provider == address(0), token == address(0),
     *      provider == msg.sender, evaluator == msg.sender,
     *      evaluator == provider, or deadline < block.timestamp + 5 minutes.
     * @param provider  Address of the agent that will execute the task.
     * @param evaluator Address of the arbitrator, or address(0) for auto-assignment.
     * @param token     ERC-20 token address for payment.
     * @param deadline  Unix timestamp deadline (minimum: now + 5 minutes).
     * @return jobId    Unique identifier for the created job.
     */
    function createJob(
        address provider,
        address evaluator,
        address token,
        uint64  deadline
    ) external returns (uint256 jobId) {
        // CHECKS — validate all inputs before touching state
        if (provider == address(0)) revert ZeroAddress("provider");
        if (token == address(0)) revert ZeroAddress("token");

        // The client (msg.sender) cannot be the provider — a party cannot pay itself.
        if (provider == msg.sender) revert SelfAssignment("provider");

        // The client cannot be their own evaluator — would allow self-approval of work.
        // address(0) is allowed here (auto-assignment path).
        if (evaluator != address(0) && evaluator == msg.sender) revert SelfAssignment("evaluator");

        // The provider cannot be the evaluator — would allow self-evaluation of work.
        if (evaluator != address(0) && evaluator == provider) revert SelfAssignment("evaluator");

        // Deadline must be sufficiently in the future to give the provider time to work.
        if (deadline < uint64(block.timestamp) + MIN_DEADLINE_OFFSET) {
            revert DeadlineTooSoon(deadline, uint64(block.timestamp) + MIN_DEADLINE_OFFSET);
        }

        // EFFECTS — assign ID and create the job record
        jobId = nextJobId;
        unchecked { ++nextJobId; }

        jobs[jobId] = Job({
            client:      msg.sender,
            provider:    provider,
            evaluator:   evaluator,   // May be address(0) — resolved in fund()
            token:       token,
            budget:      0,           // Set via setBudget() before fund()
            deadline:    deadline,
            createdAt:   uint64(block.timestamp),
            status:      JobStatus.Open,
            deliverable: bytes32(0),
            reason:      bytes32(0)
        });
        jobExists[jobId] = true;

        emit JobCreated(jobId, msg.sender, provider, evaluator, token, deadline);
    }

    /**
     * @notice Sets or updates the agreed budget on an Open job.
     * @dev Either the Client or the Provider may propose the budget while the
     *      job is Open. The amount must match exactly when fund() is called
     *      (the expectedBudget parameter), preventing front-running attacks where
     *      one party changes the budget between setBudget and fund.
     * @param jobId  The job to set the budget on.
     * @param amount Budget in the token's native decimals.
     */
    function setBudget(uint256 jobId, uint128 amount) external jobMustExist(jobId) {
        // CHECKS
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Open) revert InvalidJobStatus(jobId, job.status);

        // Only the client or provider may propose the budget.
        if (msg.sender != job.client && msg.sender != job.provider) {
            revert NotAuthorized(msg.sender, jobId, "client or provider");
        }

        // EFFECTS
        job.budget = amount;

        emit BudgetSet(jobId, amount);
    }

    /**
     * @notice Locks the budget in escrow — transitions job from Open to Funded.
     * @dev If job.evaluator is address(0), calls EvaluatorRegistry.assignEvaluator()
     *      to select an evaluator from the staker network before transitioning to Funded.
     *      The token transfer uses SafeERC20.safeTransferFrom — the caller must have
     *      approved this contract for at least expectedBudget tokens.
     *      For fee-on-transfer tokens: the received amount may be less than expectedBudget.
     *      We do NOT support fee-on-transfer tokens — such tokens would cause the
     *      escrow balance to be less than job.budget, breaking the payment invariant.
     * @param jobId          The job to fund.
     * @param expectedBudget Must match job.budget exactly (front-running protection).
     */
    function fund(uint256 jobId, uint128 expectedBudget) external nonReentrant jobMustExist(jobId) {
        // CHECKS
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Open) revert InvalidJobStatus(jobId, job.status);
        if (msg.sender != job.client) revert NotAuthorized(msg.sender, jobId, "client");
        if (job.budget == 0) revert BudgetNotSet(jobId);
        if (expectedBudget != job.budget) revert BudgetMismatch(job.budget, expectedBudget);

        // EFFECTS — resolve evaluator before state change
        // If no explicit evaluator was set, assign one from the registry now.
        // This must happen before status change so that the job has a valid evaluator
        // when it enters the Funded state.
        if (job.evaluator == address(0)) {
            // External call to EvaluatorRegistry — this is safe before our state change
            // because EvaluatorRegistry cannot call back into fund() (no reentrancy vector:
            // assignEvaluator is restricted to onlyJobManager == address(this)).
            job.evaluator = evaluatorRegistry.assignEvaluator(jobId);
        }

        job.status = JobStatus.Funded;

        // INTERACTIONS — transfer tokens into escrow after all state is finalized
        IERC20(job.token).safeTransferFrom(msg.sender, address(this), job.budget);

        emit JobFunded(jobId, job.budget);
    }

    /**
     * @notice Provider submits a deliverable hash — transitions job from Funded to Submitted.
     * @dev The deliverable hash is a commitment to the off-chain work product.
     *      The actual content is communicated via the A2A protocol; only the
     *      keccak256 hash is recorded on-chain for the Evaluator to verify.
     *      Reverts if: job is not Funded, caller is not the Provider,
     *      the deadline has already passed, or deliverable is bytes32(0).
     * @param jobId       The job to submit a deliverable for.
     * @param deliverable Keccak256 hash of the submitted work product.
     */
    function submit(uint256 jobId, bytes32 deliverable) external jobMustExist(jobId) {
        // CHECKS
        if (deliverable == bytes32(0)) revert ZeroDeliverable(jobId);

        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Funded) revert InvalidJobStatus(jobId, job.status);
        if (msg.sender != job.provider) revert NotAuthorized(msg.sender, jobId, "provider");

        // Prevent submission after deadline — the client should call claimExpired() instead.
        // Using >, not >=, so a submission in the exact deadline block is still valid.
        if (block.timestamp > job.deadline) {
            revert DeadlinePassed(jobId, job.deadline, uint64(block.timestamp));
        }

        // EFFECTS (no token transfers — pure state transition)
        job.status = JobStatus.Submitted;
        job.deliverable = deliverable;

        emit JobSubmitted(jobId, deliverable);
    }

    /**
     * @notice Evaluator approves the deliverable — transitions job to Completed
     *         and releases payment to the Provider minus the protocol fee.
     * @dev CEI pattern strictly enforced:
     *      (1) Checks: status == Submitted, msg.sender == evaluator
     *      (2) Effects: status = Completed, budget = 0, compute fee split
     *      (3) Interactions: safeTransfer to provider, safeTransfer to feeRecipient,
     *          then optional call to ReputationBridge
     *      Fee calculation: fee = budget * feeRate / 10000
     *      Rounding: integer division truncates toward zero, so the fee is rounded DOWN.
     *      This means the Provider always receives at least (budget - theoreticalFee),
     *      favoring the Provider over the protocol on rounding edge cases.
     *      If feeRate == 0 or fee rounds to 0, no transfer to feeRecipient occurs.
     *      ReputationBridge call (FINDING-002 fix): if reputationBridge != address(0),
     *      calls IReputationBridge.recordJobOutcome() with completed=true AFTER all
     *      token transfers. The call is conditional — a zero bridge address is silently
     *      skipped. The call is NOT wrapped in try/catch here because ReputationBridge
     *      itself catches failures internally; if the bridge reverts unexpectedly the
     *      settlement should surface that error rather than hide it silently.
     * @param jobId  The job to mark as completed.
     * @param reason Keccak256 hash of the evaluation report (bytes32(0) if none).
     */
    function complete(uint256 jobId, bytes32 reason) external nonReentrant jobMustExist(jobId) {
        // CHECKS
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Submitted) revert InvalidJobStatus(jobId, job.status);
        if (msg.sender != job.evaluator) revert NotAuthorized(msg.sender, jobId, "evaluator");

        // EFFECTS — update all state before any external call
        // Capture values before zeroing budget (storage reads are cheap post-Berlin).
        address provider   = job.provider;
        address evaluator  = job.evaluator;
        address token      = job.token;
        uint256 budget     = job.budget;

        // Compute fee split BEFORE zeroing budget.
        // Multiply before dividing to avoid precision loss (Pattern 6 in security spec).
        // Rounding: fee is truncated (rounds down), payment gets the remainder.
        // This intentionally favors the Provider — the protocol takes no more than its share.
        uint256 fee     = budget * feeRate / 10_000;
        uint256 payment = budget - fee;

        job.status  = JobStatus.Completed;
        job.budget  = 0;  // Zero budget BEFORE transfers — defense-in-depth against reentrancy
        job.reason  = reason;

        // INTERACTIONS — transfers happen last, after all state is finalized
        IERC20(token).safeTransfer(provider, payment);

        // Only transfer fee if there is something to transfer.
        // feeRecipient is guaranteed non-zero by the constructor (FINDING-003).
        if (fee > 0) {
            IERC20(token).safeTransfer(feeRecipient, fee);
        }

        emit JobCompleted(jobId, provider, payment, fee);

        // FINDING-002 fix: forward the positive outcome to ReputationBridge if configured.
        // This call is placed AFTER token transfers and the event (all effects done) to
        // respect CEI. The bridge is an optional component — skip silently when not set.
        // FINDING-006 fix: wrapped in try/catch so that a buggy or malicious bridge contract
        // can never block settlement. Funds are always safe regardless of bridge state.
        address bridge = reputationBridge;
        if (bridge != address(0)) {
            try IReputationBridge(bridge).recordJobOutcome(jobId, provider, evaluator, true, reason) {}
            catch {}
        }
    }

    /**
     * @notice Rejects a job and registers a refund for the Client (Pull pattern).
     * @dev Valid (caller, state) combinations:
     *      - (Client, Open):      cancellation before funding — no funds to refund
     *      - (Evaluator, Funded): job cancelled before submission
     *      - (Evaluator, Submitted): submission rejected after evaluation
     *      All other combinations revert with NotAuthorized or InvalidJobStatus.
     *      For Funded and Submitted states, the budget is accumulated in pendingRefunds
     *      rather than pushed immediately — the Client calls claimRefund() to receive funds.
     *      FINDING-002 fix: if reputationBridge is configured, forwards a negative outcome
     *      to IReputationBridge.recordJobOutcome() when the job was Funded or Submitted
     *      (i.e. an evaluator was assigned and acted). Open rejections (Client cancel) do
     *      not generate a reputation signal as no evaluation took place.
     * @param jobId  The job to reject.
     * @param reason Keccak256 hash of the rejection rationale (bytes32(0) if none).
     */
    function reject(uint256 jobId, bytes32 reason) external nonReentrant jobMustExist(jobId) {
        // CHECKS
        Job storage job = jobs[jobId];
        JobStatus current = job.status;

        // Validate the (caller, state) combination according to the ERC-8183 state machine.
        if (current == JobStatus.Open) {
            // Only the Client can cancel an Open job (no funds at stake yet).
            if (msg.sender != job.client) revert NotAuthorized(msg.sender, jobId, "client");
        } else if (current == JobStatus.Funded || current == JobStatus.Submitted) {
            // Only the Evaluator can reject a Funded or Submitted job.
            if (msg.sender != job.evaluator) revert NotAuthorized(msg.sender, jobId, "evaluator");
        } else {
            // Any other state (Completed, Rejected, Expired) is an invalid transition.
            revert InvalidJobStatus(jobId, current);
        }

        // EFFECTS — update state before registering the refund
        // Minimize local variables to avoid stack-too-deep: read from job storage directly
        // when values are only needed once, and reuse the job reference for the bridge call.
        address client = job.client;
        address token  = job.token;
        uint256 budget = job.budget;
        // Capture whether an evaluator was involved BEFORE zeroing state.
        // An Open rejection has no evaluator verdict — no reputation signal should fire.
        bool evaluatorInvolved = (current == JobStatus.Funded || current == JobStatus.Submitted);

        job.status = JobStatus.Rejected;
        job.budget = 0;  // Zero budget before registering refund (CEI, defense-in-depth)
        job.reason = reason;

        // Register refund in the Pull-over-Push pattern.
        // For Open state, budget is 0 — no tokens to refund, but the event is still emitted.
        if (budget > 0) {
            pendingRefunds[client][token] += budget;
            emit RefundPending(client, token, budget);
        }

        emit JobRejected(jobId, client, reason);

        // FINDING-002 fix: forward the negative outcome to ReputationBridge if configured.
        // Only fires when the Evaluator was involved (Funded/Submitted states).
        // Open cancellations by the Client do not generate a reputation signal.
        // Read provider and evaluator from storage here (not captured earlier) to keep
        // the local variable count below the stack-too-deep threshold.
        // FINDING-006 fix: wrapped in try/catch so that a buggy or malicious bridge contract
        // can never block settlement. Funds are always safe regardless of bridge state.
        address bridge = reputationBridge;
        if (bridge != address(0) && evaluatorInvolved) {
            try IReputationBridge(bridge).recordJobOutcome(
                jobId,
                job.provider,   // read from storage — job ref is still valid
                job.evaluator,  // read from storage — job ref is still valid
                false,
                reason
            ) {} catch {}
        }
    }

    /**
     * @notice Client triggers expiration and registers a refund after the deadline.
     * @dev FINDING-004 fix: now accepts both Funded AND Submitted states.
     *      Previously, a job in Submitted state whose Evaluator disappeared after the
     *      deadline would have its budget permanently locked. The fix allows the Client
     *      to reclaim funds in both cases once block.timestamp > job.deadline.
     *
     *      Rationale for refunding the Client (not the Provider) on Submitted + Expired:
     *      The Provider submitted a deliverable, but without an Evaluator verdict
     *      the work cannot be considered accepted. The minimum safe behavior per
     *      ERC-8183 is to return funds to the Client. The Provider's recourse is
     *      to ensure a reliable Evaluator is selected at job creation.
     *
     *      Only callable when:
     *        - status == Funded OR status == Submitted
     *        - block.timestamp > job.deadline
     *        - msg.sender == job.client
     *      Transitions the job to Expired and registers the full budget as a
     *      pending refund (Pull over Push). The Client then calls claimRefund().
     * @param jobId The funded or submitted job whose deadline has passed.
     */
    function claimExpired(uint256 jobId) external nonReentrant jobMustExist(jobId) {
        // CHECKS
        Job storage job = jobs[jobId];

        // FINDING-004: accept Funded OR Submitted — both states hold funds in escrow
        // and must not be permanently locked if the Evaluator becomes unresponsive.
        if (job.status != JobStatus.Funded && job.status != JobStatus.Submitted) {
            revert InvalidJobStatus(jobId, job.status);
        }
        if (msg.sender != job.client) revert NotAuthorized(msg.sender, jobId, "client");

        // Deadline must have passed for expiration to be valid.
        if (block.timestamp <= job.deadline) {
            revert DeadlineNotPassed(jobId, job.deadline, uint64(block.timestamp));
        }

        // EFFECTS
        address client = job.client;
        address token  = job.token;
        uint256 budget = job.budget;

        job.status = JobStatus.Expired;
        job.budget = 0;  // Zero before registering refund (CEI)

        pendingRefunds[client][token] += budget;

        emit JobExpired(jobId, client);
        emit RefundPending(client, token, budget);
    }

    /**
     * @notice Client claims all pending refunds for a specific token.
     * @dev Aggregates all refunds across rejected and expired jobs for one (caller, token) pair.
     *      CEI: balance is zeroed before the safeTransfer to prevent reentrancy.
     *      Protected by ReentrancyGuard as a second layer of defense.
     * @param token ERC-20 token address for which to claim the pending refund.
     */
    function claimRefund(address token) external nonReentrant {
        // CHECKS
        uint256 amount = pendingRefunds[msg.sender][token];
        if (amount == 0) revert NothingToRefund();

        // EFFECTS — zero the balance BEFORE the transfer (CEI)
        pendingRefunds[msg.sender][token] = 0;

        // INTERACTIONS
        IERC20(token).safeTransfer(msg.sender, amount);

        emit RefundClaimed(msg.sender, token, amount);
    }

    // ─── Admin functions ─────────────────────────────────────────────────────

    /**
     * @notice Updates the protocol fee rate. Only callable by the owner.
     * @dev Fee rate is bounded by MAX_FEE_RATE (500 = 5%) to protect users.
     *      Changes take effect immediately for all future complete() calls.
     *      In-flight jobs (already Funded or Submitted) will use the new rate
     *      when complete() is eventually called — this is acceptable because the
     *      rate range is bounded and the change is a governed action.
     * @param newFeeRate New fee rate in basis points.
     */
    function setFeeRate(uint256 newFeeRate) external onlyOwner {
        if (newFeeRate > MAX_FEE_RATE) revert FeeRateExceedsMaximum(newFeeRate, MAX_FEE_RATE);
        feeRate = newFeeRate;
    }

    /**
     * @notice Sets the address that receives the protocol fee. Only callable by the owner.
     * @dev The constructor already validates the initial value is non-zero (FINDING-003).
     *      This setter allows governance rotation (e.g., upgrading the ProtocolToken)
     *      while preserving the invariant that feeRecipient is always valid.
     * @param newFeeRecipient The address to receive protocol fees. Must be non-zero.
     */
    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        if (newFeeRecipient == address(0)) revert ZeroAddress("feeRecipient");
        feeRecipient = newFeeRecipient;
    }

    /**
     * @notice Sets the ReputationBridge address for job outcome forwarding.
     * @dev FINDING-002 fix: connects AgentJobManager to ReputationBridge.
     *      address(0) is explicitly allowed to disable reputation forwarding
     *      (e.g., during bridge migration or emergency pause). When address(0),
     *      complete() and reject() skip the bridge call silently.
     *      Setting a non-zero value immediately activates forwarding for all
     *      future terminal job states.
     * @param _bridge Address of the deployed ReputationBridge, or address(0) to disable.
     */
    function setReputationBridge(address _bridge) external onlyOwner {
        // address(0) is intentionally allowed — disabling is a valid governance action.
        reputationBridge = _bridge;
        emit ReputationBridgeUpdated(_bridge);
    }

    // ─── View functions ───────────────────────────────────────────────────────

    /**
     * @notice Returns the full state of a Job.
     * @dev Returns a memory copy — the returned struct is a snapshot, not a live reference.
     * @param jobId The job to query.
     * @return The full Job struct at the time of the call.
     */
    function getJob(uint256 jobId) external view returns (Job memory) {
        if (!jobExists[jobId]) revert JobNotFound(jobId);
        return jobs[jobId];
    }

    /**
     * @notice Returns the current protocol fee rate in basis points.
     * @return Fee rate in basis points (100 = 1%, max 500 = 5%).
     */
    function getFeeRate() external view returns (uint256) {
        return feeRate;
    }

    /**
     * @notice Returns the pending refund balance for a given (client, token) pair.
     * @param client Address of the client whose balance to query.
     * @param token  ERC-20 token address to query the balance for.
     * @return Pending refund amount in the token's native decimals.
     */
    function getPendingRefund(address client, address token) external view returns (uint256) {
        return pendingRefunds[client][token];
    }
}
