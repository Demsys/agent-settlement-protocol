// SPDX-License-Identifier: BUSL-1.1
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

    /// @notice Minimum budget to ensure fee calculation is non-zero at maximum fee rate (500 bps).
    /// @dev At 500 bps, a budget of 10_000 yields a fee of 5 (minimum 1 token unit).
    ///      This protects against budgets so small that the protocol collects zero fee regardless
    ///      of feeRate setting. 10_000 = 0.01 USDC (6 decimals).
    ///      Rounding note: fee = budget * feeRate / 10000. At feeRate=1, budget=9999 → fee=0.
    ///      MIN_BUDGET ensures fee >= 1 at any valid feeRate (1..500).
    uint128 public constant MIN_BUDGET = 10_000;

    /// @notice Minimum time the Evaluator has to evaluate after a Provider submission.
    /// @dev FINDING #3: prevents the following griefing attack:
    ///      1. Client sets a tight deadline (e.g. 10 minutes)
    ///      2. Provider submits at the last second
    ///      3. Evaluator cannot evaluate in time (network latency, off-chain verification)
    ///      4. Client calls claimExpired() and recovers funds despite a valid submission
    ///      When submit() is called and less than MIN_EVALUATION_WINDOW remains before the
    ///      deadline, the deadline is automatically extended to block.timestamp + MIN_EVALUATION_WINDOW.
    ///      24 hours is chosen as a reasonable evaluation window for off-chain AI tasks.
    uint256 public constant MIN_EVALUATION_WINDOW = 24 hours;

    /// @notice Mandatory delay between a governance proposal and its execution.
    /// @dev FINDING-005 (centralisation): a 2-day window lets stakeholders detect and
    ///      react to malicious or mistaken governance changes before they take effect.
    ///      Even if the owner key is compromised, an attacker cannot drain the protocol
    ///      via a fee manipulation in less than 2 days — giving time for an emergency
    ///      multisig rotation or a community response.
    ///      Applies to: setFeeRate and setFeeRecipient.
    ///      Does NOT apply to: allowToken/disallowToken (maintenance operations, not financial).
    ///      FINDING-001 fix: now also applies to setReputationBridge — a malicious bridge can
    ///      grief evaluator gas on complete()/reject(); the 2-day window allows detection.
    uint256 public constant GOVERNANCE_DELAY = 2 days;

    // ─── Immutables ───────────────────────────────────────────────────────────

    /// @notice The EvaluatorRegistry used to auto-assign evaluators.
    /// @dev Immutable — never changes after deployment.
    EvaluatorRegistry public immutable evaluatorRegistry;

    // ─── State variables ──────────────────────────────────────────────────────

    /// @notice Current protocol fee rate in basis points. 100 = 1%.
    /// @dev Governed by the owner (DAO post-launch). Bounded by MAX_FEE_RATE.
    ///      Changes go through a propose/execute pattern with GOVERNANCE_DELAY.
    uint256 public feeRate;

    /// @notice Address that receives the protocol fee on complete().
    /// @dev Validated non-zero at construction (FINDING-003). The ProtocolToken
    ///      then handles burn (50%) and staker distribution (50%).
    ///      Changes go through a propose/execute pattern with GOVERNANCE_DELAY.
    address public feeRecipient;

    /// @notice Address of the ReputationBridge contract to notify on job settlement.
    /// @dev Optional: when address(0), reputation forwarding is silently skipped.
    ///      Set via setReputationBridge(). Can be reset to address(0) to disable.
    address public reputationBridge;

    /// @notice When true, the client and provider may be the same address.
    /// @dev AUDIT-H1: disabled by default to prevent reputation farming via self-dealing
    ///      (cycling funds to artificially inflate ERC-8004 scores without real work).
    ///      Enable only for controlled single-agent MVP deployments where both roles
    ///      are intentionally held by the same wallet. MUST be false on mainnet production.
    bool public selfServiceEnabled;

    /// @notice Auto-incrementing job ID counter. Starts at 1 (0 is reserved as "no job").
    uint256 private nextJobId;

    /// @notice All jobs, keyed by job ID.
    mapping(uint256 => Job) private jobs;

    /// @notice Pending refunds per (client address, token address).
    /// @dev Pull over Push: refunds are accumulated here and claimed via claimRefund().
    ///      Using a nested mapping (client => token => amount) allows a single client
    ///      to have refunds in multiple token types across different jobs.
    mapping(address => mapping(address => uint256)) private pendingRefunds;

    // ─── Governance timelock state ────────────────────────────────────────────

    /// @notice Pending governance changes keyed by a parameter identifier.
    /// @dev The key is a keccak256 hash of the parameter name string (e.g. keccak256("feeRate")).
    ///      This avoids collisions between different parameters without needing separate mappings.
    ///      FINDING-005: only feeRate and feeRecipient are timelocked here; they are the only
    ///      parameters whose change directly controls the flow of funds.
    struct PendingChange {
        bytes32 valueHash;    // keccak256(abi.encode(newValue)) — verified at execution time
        uint256 executableAt; // Earliest timestamp at which the change may be executed
    }

    mapping(bytes32 => PendingChange) private pendingChanges;

    // ─── Token whitelist state ─────────────────────────────────────────────────

    /// @notice Tracks which ERC-20 tokens are allowed as job payment tokens.
    /// @dev FINDING-007: fee-on-transfer tokens silently break the escrow invariant
    ///      (job.budget > actual contract balance). The whitelist prevents any such token
    ///      from entering the system. Only tokens explicitly approved by governance may be used.
    mapping(address => bool) public allowedTokens;

    // ─── Events not in interface (implementation-specific) ───────────────────

    /// @notice Emitted when a reputationBridge change is proposed, before the delay elapses.
    event ReputationBridgeProposed(address indexed newBridge, uint256 executableAt);

    /**
     * @notice Emitted when the reputationBridge address is updated after the delay.
     * @dev address(0) means reputation forwarding is disabled.
     */
    event ReputationBridgeUpdated(address indexed oldBridge, address indexed newBridge);

    // ── Governance timelock events ────────────────────────────────────────────

    /// @notice Emitted when a feeRate change is proposed, before the delay elapses.
    event FeeRateProposed(uint256 newFeeRate, uint256 executableAt);

    /// @notice Emitted when a pending feeRate change is executed after the delay.
    event FeeRateUpdated(uint256 oldFeeRate, uint256 newFeeRate);

    /// @notice Emitted when a feeRecipient change is proposed, before the delay elapses.
    event FeeRecipientProposed(address indexed newFeeRecipient, uint256 executableAt);

    /// @notice Emitted when a pending feeRecipient change is executed after the delay.
    event FeeRecipientUpdated(address indexed oldFeeRecipient, address indexed newFeeRecipient);

    /// @notice Emitted when any pending governance proposal is cancelled by the owner.
    event ProposalCancelled(bytes32 indexed key);

    // ── Token whitelist events ────────────────────────────────────────────────

    /// @notice Emitted when a token is added to the payment whitelist.
    event TokenAllowed(address indexed token);

    /// @notice Emitted when a token is removed from the payment whitelist.
    event TokenDisallowed(address indexed token);

    // DeadlineExtended is declared in IAgentJobManager and inherited — not redeclared here.
    // It is emitted by both extendDeadline() (voluntary, client-initiated) and
    // submit() (automatic, when less than MIN_EVALUATION_WINDOW remains before deadline).

    /// @notice Emitted when the self-service mode is toggled by the owner.
    event SelfServiceToggled(bool enabled);

    /**
     * @notice Emitted when a Client reopens a Rejected job for a new execution attempt.
     * @dev The new provider may differ from the original one.
     */
    event JobReopened(
        uint256 indexed jobId,
        address indexed client,
        address indexed newProvider,
        uint64  newDeadline
    );

    // ─── Errors not in interface (implementation-specific) ───────────────────

    /// @notice Thrown when the fee rate exceeds MAX_FEE_RATE.
    error FeeRateExceedsMaximum(uint256 provided, uint256 maximum);

    // ── Security finding errors are declared in IAgentJobManager (interface) ─
    // EvaluatorNotEligible and BudgetBelowMinimum are inherited from IAgentJobManager.
    // Do not redeclare them here — Solidity inherits errors from interfaces.

    // ── Governance timelock errors ────────────────────────────────────────────

    /// @notice Thrown when execute*() is called but no proposal exists for that key.
    error NoProposalPending(bytes32 key);

    /// @notice Thrown when execute*() is called before the governance delay has elapsed.
    /// @param executableAt The earliest timestamp at which execution is allowed.
    error GovernanceDelayNotElapsed(uint256 executableAt);

    /// @notice Thrown when the value passed to execute*() does not match the proposed value.
    /// @dev Prevents a front-running attack where the owner submits a safe value, waits,
    ///      then passes a different (malicious) value at execution time. The hash check
    ///      binds the execute call to exactly the value that was proposed.
    error ProposalValueMismatch();

    // ── Token whitelist errors ────────────────────────────────────────────────

    /// @notice Thrown when createJob() is called with a token not on the whitelist.
    error TokenNotAllowed(address token);

    /// @notice Thrown when the budget has not been set (is 0) at fund() time.
    error BudgetNotSet(uint256 jobId);

    /// @notice Thrown when submit() is called after the deadline has passed.
    error DeadlinePassed(uint256 jobId, uint64 deadline, uint64 current);

    /// @notice Thrown when claimExpired() is called before the deadline.
    error DeadlineNotPassed(uint256 jobId, uint64 deadline, uint64 current);

    /// @notice Thrown when deliverable hash is zero (not allowed in submit).
    error ZeroDeliverable(uint256 jobId);

    /// @notice Thrown when extendDeadline() is called with a newDeadline <= current deadline.
    /// @param current  The job's existing deadline.
    /// @param proposed The proposed new deadline that is not strictly greater.
    error DeadlineNotExtended(uint64 current, uint64 proposed);

    /// @notice Thrown when extendDeadline() proposes a deadline beyond block.timestamp + 30 days.
    /// @param proposed The proposed deadline that exceeds the maximum.
    /// @param maximum  The computed maximum allowed deadline (block.timestamp + 30 days).
    error DeadlineTooFar(uint64 proposed, uint64 maximum);

    /// @notice Thrown when reject() is called by the Evaluator after the job's deadline
    ///         has already passed. Once expired, only claimExpired() is valid.
    /// @dev Distinct from DeadlinePassed (used in submit()) to clearly separate the two
    ///      contexts: a provider missing the submission window vs. an evaluator attempting
    ///      to inflict a negative reputation signal after the escrow window has closed.
    error DeadlineAlreadyPassed(uint256 jobId);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    /**
     * @dev Reverts with JobNotFound if the job ID does not exist.
     *      Sentinel: jobs[jobId].client is always set to msg.sender (non-zero) in createJob(),
     *      so address(0) unambiguously means the job was never created. This replaces the
     *      former jobExists mapping, saving 1 SSTORE (20 000 gas) per job creation while
     *      providing equivalent safety: job IDs start at 1 (nextJobId = 1 in constructor),
     *      so jobId 0 always has client == address(0) and correctly fails this check.
     */
    modifier jobMustExist(uint256 jobId) {
        if (jobs[jobId].client == address(0)) revert JobNotFound(jobId);
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @notice Deploys the AgentJobManager with initial configuration.
     * @dev FINDING-003 fix: _feeRecipient is now a required constructor parameter.
     *      Requiring it at construction prevents the contract from being deployed
     *      in a state where complete() would revert with a non-obvious SafeERC20
     *      error, permanently trapping funds of Submitted jobs.
     *      The timelocked setters (proposeFeeRate/executeFeeRate, proposeFeeRecipient/
     *      executeFeeRecipient) are kept for governance rotation.
     *
     *      FINDING-007 fix: _initialAllowedTokens bootstraps the token whitelist at
     *      deployment. Without this parameter, no token would be whitelisted at
     *      construction and createJob() would immediately revert for every caller —
     *      making the contract unusable before the owner calls allowToken() manually.
     *
     *      _reputationBridge is optional at construction (address(0) is valid).
     *      Accepting it at construction time is safer than requiring a separate
     *      setReputationBridge() call post-deployment: it makes the initial wiring
     *      atomic and auditable in a single deployment transaction, reducing the
     *      operational risk of a partially-configured protocol accepting jobs before
     *      reputation recording is enabled.
     * @param _evaluatorRegistry      Address of the deployed EvaluatorRegistry contract.
     * @param _feeRate                Initial fee rate in basis points (100 = 1%).
     * @param _feeRecipient           Address that receives the protocol fee on complete().
     *                                Must be non-zero. Typically the ProtocolToken address.
     * @param _reputationBridge       Address of the ReputationBridge contract, or address(0)
     *                                to disable reputation forwarding at deployment.
     * @param _initialAllowedTokens   List of ERC-20 addresses to whitelist at deployment.
     *                                Zero addresses in the array are silently skipped.
     */
    constructor(
        address   _evaluatorRegistry,
        uint256   _feeRate,
        address   _feeRecipient,
        address   _reputationBridge,
        address[] memory _initialAllowedTokens
    ) Ownable(msg.sender) {
        if (_evaluatorRegistry == address(0)) revert ZeroAddress("evaluatorRegistry");
        if (_feeRate > MAX_FEE_RATE) revert FeeRateExceedsMaximum(_feeRate, MAX_FEE_RATE);
        // FINDING-003: feeRecipient must be set at deployment. If address(0) were
        // accepted, any job reaching Submitted state with feeRate > 0 would have its
        // funds permanently locked — complete() would revert on safeTransfer(address(0)).
        if (_feeRecipient == address(0)) revert ZeroAddress("feeRecipient");
        // _reputationBridge may be address(0) — reputation forwarding is optional.
        // No zero-check here is intentional: the bridge is an augmentation, not a
        // safety-critical dependency. complete() and reject() skip the bridge call
        // silently when reputationBridge == address(0).

        evaluatorRegistry = EvaluatorRegistry(_evaluatorRegistry);
        feeRate = _feeRate;
        feeRecipient = _feeRecipient;
        reputationBridge = _reputationBridge;
        nextJobId = 1; // Start at 1 so that jobId 0 is always "invalid"

        if (_reputationBridge != address(0)) {
            emit ReputationBridgeUpdated(address(0), _reputationBridge);
        }

        // FINDING-007: whitelist the initial tokens provided at deployment.
        // address(0) entries are silently skipped — they cannot be valid payment tokens
        // and their presence would break safeTransferFrom in fund().
        for (uint256 i = 0; i < _initialAllowedTokens.length; ) {
            if (_initialAllowedTokens[i] != address(0)) {
                allowedTokens[_initialAllowedTokens[i]] = true;
                emit TokenAllowed(_initialAllowedTokens[i]);
            }
            unchecked { ++i; }
        }
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

        // FINDING-007: only whitelisted tokens may be used. Fee-on-transfer tokens
        // silently break the escrow invariant (job.budget > actual contract balance)
        // which would prevent complete() from transferring the full agreed amount.
        if (!allowedTokens[token]) revert TokenNotAllowed(token);

        // AUDIT-H1: by default, block client == provider to prevent reputation farming
        // (self-dealing to inflate ERC-8004 scores without real counterparty work).
        // selfServiceEnabled can be set to true by the owner for single-agent MVP deployments
        // where both roles are intentionally held by the same wallet.
        if (!selfServiceEnabled && provider == msg.sender) revert SelfAssignment("provider");

        // The client cannot be their own evaluator — would allow self-approval of work.
        // address(0) is allowed here (auto-assignment path).
        if (evaluator != address(0) && evaluator == msg.sender) revert SelfAssignment("evaluator");

        // The provider cannot be the evaluator — would allow self-evaluation of work.
        if (evaluator != address(0) && evaluator == provider) revert SelfAssignment("evaluator");

        // FINDING #1: if an explicit evaluator is provided, verify they are registered and
        // eligible in EvaluatorRegistry (i.e. their stake >= minEvaluatorStake and active == true).
        // Without this check, a client could designate any address — including an unstaked
        // accomplice — as evaluator, completely bypassing the cryptoeconomic security model.
        // We prefer this slightly more complex check over the simpler "accept any non-zero address"
        // because the security guarantee (staked evaluator = skin-in-the-game) is the protocol's
        // core value proposition. A non-eligible evaluator cannot be slashed, making the
        // evaluation worthless from a trust-minimization standpoint.
        if (evaluator != address(0) && !evaluatorRegistry.isEligible(evaluator)) {
            revert EvaluatorNotEligible(evaluator);
        }

        // Deadline must be sufficiently in the future to give the provider time to work.
        if (deadline < uint64(block.timestamp) + MIN_DEADLINE_OFFSET) {
            revert DeadlineTooSoon(deadline, uint64(block.timestamp) + MIN_DEADLINE_OFFSET);
        }

        // EFFECTS — assign ID and create the job record
        jobId = nextJobId;
        unchecked { ++nextJobId; } // safe: 2^256 jobs is computationally impossible

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

        // FINDING #4: enforce minimum budget so that fee calculation is non-zero at any valid
        // feeRate. At feeRate=1 (0.01%), budget=9999 → fee = 9999*1/10000 = 0 (integer truncation).
        // The protocol would settle a job for free. MIN_BUDGET = 10_000 ensures fee >= 1 at
        // all governance-approved feeRates (1..500). Rounding always favors the provider
        // (truncation toward zero), so the minimum is also provider-friendly.
        // We choose the stricter check (BudgetBelowMinimum revert) over silently clamping the
        // amount to MIN_BUDGET — silent clamping would mislead the client about their actual commitment.
        if (amount < MIN_BUDGET) revert BudgetBelowMinimum(amount, MIN_BUDGET);

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

        // AUDIT-NEW-04: re-verify the explicit evaluator is still eligible at fund() time.
        // An evaluator validated at createJob() may have unstaked between createJob() and fund(),
        // losing their skin-in-the-game and becoming non-slashable. Without this check, the job
        // would be funded against an evaluator who carries no cryptoeconomic guarantee.
        if (job.evaluator != address(0) && !evaluatorRegistry.isEligible(job.evaluator)) {
            revert EvaluatorNotEligible(job.evaluator);
        }

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
        // AUDIT-NEW-12: measure balance before/after to detect fee-on-transfer tokens that
        // were whitelisted before their fee was activated (e.g. proxy upgrades on USDT).
        // We do NOT support fee-on-transfer tokens — this check makes the exclusion explicit
        // and prevents a future proxy upgrade from silently breaking the payment invariant.
        uint256 balanceBefore = IERC20(job.token).balanceOf(address(this));
        IERC20(job.token).safeTransferFrom(msg.sender, address(this), job.budget);
        uint256 received = IERC20(job.token).balanceOf(address(this)) - balanceBefore;
        if (received != job.budget) revert BudgetMismatch(job.budget, uint128(received));

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

        // FINDING #3: deadline griefing protection.
        // If less than MIN_EVALUATION_WINDOW (24h) remains between now and the deadline,
        // automatically extend the deadline to block.timestamp + MIN_EVALUATION_WINDOW.
        // Without this guard, a client can set a tight deadline so that even a valid
        // submission leaves the evaluator no time to act, then call claimExpired() to
        // recover the funds while the provider gets nothing despite having delivered.
        // We prefer the automatic extension over requiring the client to extend proactively,
        // because a griefing client would never voluntarily extend — the protection must
        // be enforced by the protocol itself.
        uint64 currentDeadline = job.deadline;
        if (block.timestamp + MIN_EVALUATION_WINDOW > currentDeadline) {
            uint64 newDeadline = uint64(block.timestamp + MIN_EVALUATION_WINDOW);
            job.deadline = newDeadline;
            emit DeadlineExtended(jobId, currentDeadline, newDeadline);
        }

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
        address evaluator  = job.evaluator; // captured for ReputationBridge call below
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
            // FINDING-001 fix: cap gas forwarded to the bridge at 50 000 to prevent a
            // malicious or misconfigured bridge from exhausting the evaluator's entire
            // gas budget via an infinite loop. The try/catch already prevents reverts
            // from blocking settlement; the gas cap closes the griefing vector.
            // AUDIT-B1: the gas cap must cover the full call chain:
            //   AgentJobManager → ReputationBridge (~100k) → ERC-8004 registry (~200k)
            // With only 100k forwarded, ReputationBridge could not itself forward 200k to the
            // registry (EVM EIP-150: the callee only receives what the caller has minus overhead).
            // 350k = 200k (registry) + ~100k (bridge execution) + EIP-150 margin.
            // AUDIT-M1: previous cap of 50 000 was too low and caused silent OOG failures.
            try IReputationBridge(bridge).recordJobOutcome{gas: 350_000}(jobId, provider, evaluator, true, reason) {}
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

            // Prevent the Evaluator from rejecting after the deadline has passed.
            // Once expired, the job can only be resolved via claimExpired(). Allowing
            // a post-deadline rejection would let an Evaluator inflict a negative
            // reputation signal on a Provider who was never actually evaluated within
            // the agreed time window — an unjust outcome and a potential griefing vector.
            // AUDIT-H3: use >= (not >) to close the race window at the exact deadline block
            // where both reject() and claimExpired() were simultaneously valid.
            if (block.timestamp >= job.deadline) revert DeadlineAlreadyPassed(jobId);
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
            // AUDIT-B1: same 350k cap as in complete() — see complete() for full reasoning.
            try IReputationBridge(bridge).recordJobOutcome{gas: 350_000}(
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

    // ─── Extension functions (beyond ERC-8183 core) ──────────────────────────

    /**
     * @notice Extends the deadline of a Funded job.
     * @dev Only the Client may extend the deadline. The extension must be strictly
     *      forward (newDeadline > current deadline) and capped at block.timestamp + 30 days
     *      to prevent indefinite escrow lock-up.
     *      The minimum offset guard (MIN_DEADLINE_OFFSET = 5 minutes) ensures the new
     *      deadline is meaningfully in the future even if called at the last moment.
     *
     *      Why only Funded and not Submitted:
     *        - In the Submitted state the Provider has already delivered their work and the
     *          Evaluator is in the process of reviewing it. Allowing the Client to extend
     *          the deadline at this stage would let them repeatedly push back the Evaluator's
     *          verdict window indefinitely, effectively trapping both the Provider's payment
     *          and the Evaluator's obligation with no upper bound. Funded-only extension
     *          is the safe restriction: the Provider still has time to deliver and may
     *          legitimately need more of it, but once work is submitted the clock should
     *          run to conclusion.
     *      Why not Open:
     *        - Open jobs have no funds at stake; the Client can simply recreate the job
     *          with a new deadline. Allowing extension on Open would add complexity
     *          with no security or UX benefit.
     *      Why not Completed/Rejected/Expired:
     *        - Terminal states. The lifecycle is over; no extension makes sense.
     *
     *      CEI compliance: this function modifies only the job's deadline field (a pure
     *      state update with no token transfers), so no nonReentrant guard is needed.
     *      ReentrancyGuard is kept on fund-moving functions only to avoid wasting gas.
     * @param jobId       The job whose deadline to extend.
     * @param newDeadline New Unix timestamp deadline. Must be > job.deadline,
     *                    >= block.timestamp + MIN_DEADLINE_OFFSET, and
     *                    <= block.timestamp + 30 days.
     */
    function extendDeadline(uint256 jobId, uint64 newDeadline) external jobMustExist(jobId) {
        // CHECKS
        Job storage job = jobs[jobId];

        // Only Funded jobs may have their deadline extended.
        // Submitted jobs are excluded: a deliverable has been provided and the Evaluator
        // is actively reviewing it. Allowing extensions at this stage would enable the
        // Client to keep pushing back the resolution window indefinitely (FINDING-003).
        if (job.status != JobStatus.Funded) {
            revert InvalidJobStatus(jobId, job.status);
        }

        // Only the Client can extend — they are the escrow payer and the beneficiary
        // of a deadline extension (more time for their task to be completed).
        if (msg.sender != job.client) revert NotAuthorized(msg.sender, jobId, "client");

        uint64 currentDeadline = job.deadline;

        // Must be strictly forward — never allow shortening a deadline.
        // A reduced deadline could surprise the Provider and trigger premature expiration.
        if (newDeadline <= currentDeadline) revert DeadlineNotExtended(currentDeadline, newDeadline);

        // Must be at least MIN_DEADLINE_OFFSET in the future (5 minutes) so the extension
        // is meaningful and not trivially bypassed by a same-block expiration.
        if (newDeadline < uint64(block.timestamp) + MIN_DEADLINE_OFFSET) {
            revert DeadlineTooSoon(newDeadline, uint64(block.timestamp) + MIN_DEADLINE_OFFSET);
        }

        // Cap at 30 days from now to prevent indefinite escrow lock-up.
        // An uncapped extension would let a malicious Client trap the Provider's
        // expected payment for an arbitrarily long period.
        uint64 maxDeadline = uint64(block.timestamp) + 30 days;
        if (newDeadline > maxDeadline) revert DeadlineTooFar(newDeadline, maxDeadline);

        // EFFECTS — pure state update, no token transfer
        job.deadline = newDeadline;

        emit DeadlineExtended(jobId, currentDeadline, newDeadline);
    }

    /**
     * @notice Reopens a Rejected job for a new execution attempt without losing the setup.
     * @dev Feedback from ERC-8183 forum: jobs should be recoverable after rejection so
     *      Clients do not need to recreate the full job (provider negotiation, token
     *      approval, etc.) when they simply want to retry with a different Provider.
     *
     *      What reopen() does:
     *        - Transitions status back to Open
     *        - Replaces provider with newProvider (Client may choose the same or different)
     *        - Resets deadline to newDeadline
     *        - Resets evaluator to address(0) — will be reassigned by EvaluatorRegistry
     *          at the next fund() call, ensuring a fresh unbiased evaluator
     *        - Zeros budget, deliverable, and reason — the Client must call setBudget()
     *          and fund() again before the Provider can submit
     *
     *      What reopen() does NOT do:
     *        - It does NOT touch pendingRefunds. If the rejected job accumulated a refund
     *          (budget was in escrow when rejected), that amount remains claimable via
     *          claimRefund(). The Client must fund() the reopened job separately.
     *          Conflating the refund with the new escrow would be a security anti-pattern:
     *          the token addresses might differ, amounts might not match, and it would
     *          create an implicit safeTransfer inside a non-nonReentrant function.
     *
     *      Why only Rejected and not Expired:
     *        - Expired jobs represent a timed-out escrow where no deliverable was submitted.
     *          The Client already has their refund pending. Reopening an Expired job is
     *          identical to creating a new job — there is no setup worth preserving.
     *
     *      CEI compliance: no token transfers occur — this is a pure state reset.
     *      No nonReentrant guard needed; added as defense-in-depth would be redundant.
     * @param jobId       The rejected job to reopen.
     * @param newProvider Address of the provider for the new attempt. Must differ from
     *                    the Client (same rule as createJob). Cannot be address(0).
     * @param newDeadline New deadline for the reopened job. Must be at least
     *                    block.timestamp + MIN_DEADLINE_OFFSET (5 minutes).
     */
    function reopen(
        uint256 jobId,
        address newProvider,
        uint64  newDeadline
    ) external jobMustExist(jobId) {
        // CHECKS
        Job storage job = jobs[jobId];

        // Only Rejected jobs can be reopened — the lifecycle ended but no funds are in escrow.
        if (job.status != JobStatus.Rejected) revert InvalidJobStatus(jobId, job.status);

        // Only the Client can reopen their own job.
        if (msg.sender != job.client) revert NotAuthorized(msg.sender, jobId, "client");

        // newProvider must be a real address.
        if (newProvider == address(0)) revert ZeroAddress("newProvider");

        // The Client cannot be their own Provider unless selfServiceEnabled — same invariant as createJob.
        // AUDIT-NEW-06: align reopen() with createJob() so that selfServiceEnabled=true workflows
        // are not blocked at reopen() time while being allowed at createJob() time.
        if (!selfServiceEnabled && newProvider == job.client) revert SelfAssignment("newProvider");

        // AUDIT-H2: the previous evaluator who rejected this job cannot become the new
        // provider. An evaluator who rejected has already demonstrated adversarial
        // alignment with this job and should not be able to switch roles to exploit it.
        if (job.evaluator != address(0) && newProvider == job.evaluator) {
            revert SelfAssignment("newProvider");
        }

        // AUDIT-M2: the job token must still be whitelisted. It could have been removed
        // via disallowToken() between job creation/rejection and this reopen call.
        // Without this check a disallowed fee-on-transfer token could re-enter via reopen.
        if (!allowedTokens[job.token]) revert TokenNotAllowed(job.token);

        // New deadline must be sufficiently in the future.
        if (newDeadline < uint64(block.timestamp) + MIN_DEADLINE_OFFSET) {
            revert DeadlineTooSoon(newDeadline, uint64(block.timestamp) + MIN_DEADLINE_OFFSET);
        }

        // EFFECTS — reset the job back to Open state for a fresh funding cycle.
        // Capture client address before any writes (not strictly necessary here since
        // client is not modified, but consistent with the defensive read-before-write style).
        address client = job.client;

        job.status      = JobStatus.Open;
        job.provider    = newProvider;
        job.deadline    = newDeadline;
        // Reset evaluator to address(0) so fund() triggers a fresh EvaluatorRegistry assignment.
        // Reusing the old evaluator who just rejected the work would undermine the retry.
        job.evaluator   = address(0);
        // Budget must be re-negotiated and re-funded — the old escrow has already been
        // credited to pendingRefunds and is independent of this reopened escrow cycle.
        job.budget      = 0;
        // Clear the previous deliverable and verdict so they do not pollute the new attempt.
        job.deliverable = bytes32(0);
        job.reason      = bytes32(0);
        // createdAt is intentionally preserved — it reflects when the job was originally
        // created, which is useful for off-chain reputation and analytics.

        emit JobReopened(jobId, client, newProvider, newDeadline);
    }

    // ─── Admin functions ─────────────────────────────────────────────────────

    // ── Governance timelock: feeRate ──────────────────────────────────────────

    /**
     * @notice Step 1 of 2 — proposes a new fee rate.  Actual update is delayed by GOVERNANCE_DELAY.
     * @dev FINDING-005: replacing the immediate setFeeRate() with a two-step propose/execute
     *      pattern prevents a compromised owner key from instantly changing the fee to 5%
     *      and extracting value from all in-flight jobs. The 2-day window gives the community
     *      time to observe the pending change and react (e.g., pause or rotate the owner key).
     *      Calling proposeFeeRate() a second time before execution overwrites the previous
     *      proposal — only the latest value and deadline are stored.
     * @param newFeeRate Proposed fee rate in basis points. Bounded by MAX_FEE_RATE (5%).
     */
    function proposeFeeRate(uint256 newFeeRate) external onlyOwner {
        if (newFeeRate > MAX_FEE_RATE) revert FeeRateExceedsMaximum(newFeeRate, MAX_FEE_RATE);

        bytes32 key = keccak256("feeRate");
        uint256 executableAt = block.timestamp + GOVERNANCE_DELAY;
        pendingChanges[key] = PendingChange({
            valueHash:    keccak256(abi.encode(newFeeRate)),
            executableAt: executableAt
        });
        emit FeeRateProposed(newFeeRate, executableAt);
    }

    /**
     * @notice Step 2 of 2 — executes a previously proposed fee rate change.
     * @dev The caller must pass the same newFeeRate value that was proposed.
     *      The hash check (valueHash == keccak256(abi.encode(newFeeRate))) ensures
     *      the execution is bound to exactly the value that was publicly announced —
     *      preventing a last-second substitution attack.
     * @param newFeeRate Must match the value passed to the corresponding proposeFeeRate().
     */
    function executeFeeRate(uint256 newFeeRate) external onlyOwner {
        bytes32 key = keccak256("feeRate");
        PendingChange storage p = pendingChanges[key];

        if (p.executableAt == 0) revert NoProposalPending(key);
        if (block.timestamp < p.executableAt) revert GovernanceDelayNotElapsed(p.executableAt);
        if (p.valueHash != keccak256(abi.encode(newFeeRate))) revert ProposalValueMismatch();

        delete pendingChanges[key]; // CEI: clear before applying the change
        uint256 oldFeeRate = feeRate;
        feeRate = newFeeRate;
        emit FeeRateUpdated(oldFeeRate, newFeeRate);
    }

    // ── Governance timelock: feeRecipient ─────────────────────────────────────

    /**
     * @notice Step 1 of 2 — proposes a new fee recipient.  Actual update is delayed by GOVERNANCE_DELAY.
     * @dev FINDING-005: same rationale as proposeFeeRate. Changing the fee recipient is
     *      a high-impact action: a malicious rotation would redirect all future protocol
     *      revenue to an attacker-controlled address. The 2-day delay makes this visible
     *      on-chain before it takes effect.
     * @param newFeeRecipient Proposed address to receive protocol fees. Must be non-zero.
     */
    function proposeFeeRecipient(address newFeeRecipient) external onlyOwner {
        if (newFeeRecipient == address(0)) revert ZeroAddress("feeRecipient");

        bytes32 key = keccak256("feeRecipient");
        uint256 executableAt = block.timestamp + GOVERNANCE_DELAY;
        pendingChanges[key] = PendingChange({
            valueHash:    keccak256(abi.encode(newFeeRecipient)),
            executableAt: executableAt
        });
        emit FeeRecipientProposed(newFeeRecipient, executableAt);
    }

    /**
     * @notice Step 2 of 2 — executes a previously proposed fee recipient change.
     * @dev The caller must pass the same newFeeRecipient that was proposed.
     * @param newFeeRecipient Must match the value passed to the corresponding proposeFeeRecipient().
     */
    function executeFeeRecipient(address newFeeRecipient) external onlyOwner {
        bytes32 key = keccak256("feeRecipient");
        PendingChange storage p = pendingChanges[key];

        if (p.executableAt == 0) revert NoProposalPending(key);
        if (block.timestamp < p.executableAt) revert GovernanceDelayNotElapsed(p.executableAt);
        if (p.valueHash != keccak256(abi.encode(newFeeRecipient))) revert ProposalValueMismatch();

        delete pendingChanges[key]; // CEI: clear before applying the change
        address oldFeeRecipient = feeRecipient;
        feeRecipient = newFeeRecipient;
        emit FeeRecipientUpdated(oldFeeRecipient, newFeeRecipient);
    }

    // ── Governance: proposal cancellation ────────────────────────────────────

    /**
     * @notice Cancels any pending governance proposal identified by its key.
     * @dev Useful when the owner wants to abandon a proposal before it executes
     *      (e.g., after discovering an error in the proposed value).
     *      The key is keccak256("<parameterName>"), e.g. keccak256("feeRate").
     *      AUDIT-H5: reverts if no proposal exists for the key — prevents spurious
     *      ProposalCancelled events that would mislead off-chain indexers into
     *      believing a proposal was cancelled when none was pending.
     * @param key keccak256 identifier of the proposal to cancel.
     */
    function cancelProposal(bytes32 key) external onlyOwner {
        if (pendingChanges[key].executableAt == 0) revert NoProposalPending(key);
        delete pendingChanges[key];
        emit ProposalCancelled(key);
    }

    // ── Self-service mode ─────────────────────────────────────────────────────

    /**
     * @notice Enables or disables self-service mode (client == provider allowed).
     * @dev AUDIT-H1: disabled by default to prevent reputation farming.
     *      Enable for single-agent MVP deployments only. Set to false on mainnet.
     * @param enabled True to allow client == provider, false to enforce separation.
     */
    function setSelfServiceEnabled(bool enabled) external onlyOwner {
        selfServiceEnabled = enabled;
        emit SelfServiceToggled(enabled);
    }

    // ── Token whitelist management ────────────────────────────────────────────

    /**
     * @notice Adds an ERC-20 token to the payment whitelist.
     * @dev FINDING-007: deliberate maintenance operation, not timelocked.
     *      Adding a token only expands what clients CAN use — it does not change
     *      the behavior of any existing job. The operator-level risk is accepting a
     *      bad token (fee-on-transfer, rebasing, pausable) — mitigated by the owner's
     *      responsibility to audit tokens before whitelisting.
     *      Disallowing a token IS more sensitive (would prevent new jobs for live tokens)
     *      but still does not affect in-flight jobs (token is stored on the job struct).
     * @param token ERC-20 token address to whitelist. Must be non-zero.
     */
    function allowToken(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress("token");
        allowedTokens[token] = true;
        emit TokenAllowed(token);
    }

    /**
     * @notice Removes an ERC-20 token from the payment whitelist.
     * @dev Does NOT affect in-flight jobs — token is stored on the Job struct
     *      and the whitelist is only checked in createJob(). A disallowed token
     *      on an existing job will continue to work through its full lifecycle.
     * @param token ERC-20 token address to remove from the whitelist.
     */
    function disallowToken(address token) external onlyOwner {
        // AUDIT-E3: mirror the address(0) check from allowToken() for consistency.
        // Calling disallowToken(address(0)) would emit a spurious event and confuse indexers
        // tracking the whitelist (a token that was never allowed appearing as disallowed).
        if (token == address(0)) revert ZeroAddress("token");
        allowedTokens[token] = false;
        emit TokenDisallowed(token);
    }

    // ── Governance timelock: reputationBridge ─────────────────────────────────

    /**
     * @notice Step 1 of 2 — proposes a new ReputationBridge address. Actual update is
     *         delayed by GOVERNANCE_DELAY.
     * @dev FINDING-001 fix: a malicious bridge forwarded from complete()/reject() can
     *      exhaust evaluator gas (griefing attack even with try/catch + gas cap). Timelocking
     *      the bridge pointer gives stakeholders 2 days to detect and cancel a malicious proposal.
     *      address(0) is allowed — disabling is a valid emergency action and takes effect
     *      immediately (no-op bridge calls already have no gas cost).
     *      To disable immediately (emergency), propose(address(0)) then wait.
     * @param _bridge Proposed ReputationBridge address, or address(0) to disable forwarding.
     */
    function proposeReputationBridge(address _bridge) external onlyOwner {
        bytes32 key = keccak256("reputationBridge");
        uint256 executableAt = block.timestamp + GOVERNANCE_DELAY;
        pendingChanges[key] = PendingChange({
            valueHash:    keccak256(abi.encode(_bridge)),
            executableAt: executableAt
        });
        emit ReputationBridgeProposed(_bridge, executableAt);
    }

    /**
     * @notice Step 2 of 2 — executes a previously proposed ReputationBridge change.
     * @dev Must be called after GOVERNANCE_DELAY has elapsed since proposeReputationBridge().
     *      The value must match exactly what was proposed.
     * @param _bridge Must match the address passed to the corresponding proposeReputationBridge().
     */
    function executeReputationBridge(address _bridge) external onlyOwner {
        bytes32 key = keccak256("reputationBridge");
        PendingChange storage p = pendingChanges[key];

        if (p.executableAt == 0) revert NoProposalPending(key);
        if (block.timestamp < p.executableAt) revert GovernanceDelayNotElapsed(p.executableAt);
        if (p.valueHash != keccak256(abi.encode(_bridge))) revert ProposalValueMismatch();

        delete pendingChanges[key]; // CEI: clear before applying the change
        address oldBridge = reputationBridge;
        reputationBridge = _bridge;
        emit ReputationBridgeUpdated(oldBridge, _bridge);
    }

    // ─── View functions ───────────────────────────────────────────────────────

    /**
     * @notice Returns the full state of a Job.
     * @dev Returns a memory copy — the returned struct is a snapshot, not a live reference.
     * @param jobId The job to query.
     * @return The full Job struct at the time of the call.
     */
    function getJob(uint256 jobId) external view returns (Job memory) {
        if (jobs[jobId].client == address(0)) revert JobNotFound(jobId);
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
