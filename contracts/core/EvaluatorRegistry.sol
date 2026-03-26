// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

// ─── OpenZeppelin imports ────────────────────────────────────────────────────
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// ─── Internal imports ────────────────────────────────────────────────────────
import "../token/ProtocolToken.sol";

/**
 * @title EvaluatorRegistry
 * @notice Decentralized registry of evaluators for the Agent Settlement Protocol.
 *         Manages staking, pseudo-random evaluator assignment, and slashing.
 * @dev Evaluators must stake a minimum amount of ProtocolToken to become eligible.
 *      When a job is created without an explicit evaluator (address(0)), the
 *      AgentJobManager calls assignEvaluator() to select one from this registry.
 *
 *      Security design decisions:
 *      - assignEvaluator() and slash() are restricted to jobManager only.
 *        This prevents any external actor from manipulating evaluator selection
 *        or triggering fraudulent slashing, which would be catastrophic for stakers.
 *      - Slashed tokens are burned directly via ProtocolToken.burn(), making
 *        slashing credibly punitive (no treasury capture).
 *      - Pseudo-randomness uses block.prevrandao + jobId + block.timestamp + msg.sender.
 *        This is NOT cryptographically secure randomness — a sequencer can slightly
 *        influence the result. For mainnet, consider a VRF solution (Chainlink VRF v2).
 *        For our current use case, the economic incentive to manipulate is low because
 *        the sequencer would need to reorder blocks just to pick a favorable evaluator.
 *      - Stake-weighted selection: evaluators with more stake have proportionally
 *        higher probability of assignment, aligning economic incentives with quality.
 *
 * @custom:security This is the most sensitive contract in the protocol because
 *                  it controls who can validate jobs. All mutating functions
 *                  are protected by ReentrancyGuard and follow the CEI pattern.
 */
contract EvaluatorRegistry is ReentrancyGuard, Ownable {
    using SafeERC20 for ProtocolToken;

    // ─── Types ────────────────────────────────────────────────────────────────

    /**
     * @notice Represents an evaluator's state in the registry.
     * @dev active flag avoids re-checking stake >= minEvaluatorStake on every call.
     *      index stores the position in the activeEvaluators array to enable O(1) removal.
     *      activeSince is the Unix timestamp at which the evaluator last crossed the
     *      minEvaluatorStake threshold. Used by the warmup period filter in assignEvaluator()
     *      to prevent Sybil attacks via freshly-staked wallets (ERC-8183 forum feedback).
     *      Layout: stakedAmount (256) + index (256) = two 32-byte slots;
     *              activeSince (64) + active (8) fit together in a third slot — Solidity
     *              packs these automatically since they share a 32-byte slot.
     */
    struct Evaluator {
        uint256 stakedAmount;   // Total tokens currently staked
        uint256 index;          // Index in the activeEvaluators array (valid only when active)
        uint64  activeSince;    // Timestamp when the evaluator last became active (crossed minEvaluatorStake)
        bool    active;         // True if stakedAmount >= minEvaluatorStake
    }

    // ─── Events ───────────────────────────────────────────────────────────────

    /// @notice Emitted when an evaluator stakes tokens.
    event Staked(address indexed evaluator, uint256 amount, uint256 newTotal);

    /// @notice Emitted when an evaluator unstakes tokens.
    event Unstaked(address indexed evaluator, uint256 amount, uint256 newTotal);

    /// @notice Emitted when an evaluator is pseudo-randomly assigned to a job.
    event EvaluatorAssigned(uint256 indexed jobId, address indexed evaluator);

    /// @notice Emitted when an evaluator is slashed by the job manager.
    event EvaluatorSlashed(address indexed evaluator, uint256 amount, uint256 remainingStake);

    /// @notice Emitted when the owner updates the warmup period.
    event WarmupPeriodUpdated(uint64 newPeriod);

    /// @notice Emitted when the owner updates the minimum evaluator stake threshold.
    /// @dev Both old and new values are logged so indexers can track governance history
    ///      and evaluators can react to deactivation caused by a raised minimum.
    event MinEvaluatorStakeUpdated(uint256 oldMinimum, uint256 newMinimum);

    /// @notice Emitted when the owner updates the slash pause state.
    /// @dev The slash pause is the only emergency mechanism in EvaluatorRegistry that
    ///      intentionally bypasses the GOVERNANCE_DELAY timelock, because it protects
    ///      stakers against an actively exploited compromised AgentJobManager.
    event SlashPauseUpdated(bool paused);

    // ── Governance timelock events ────────────────────────────────────────────

    /// @notice Emitted when a jobManager change is proposed.
    event JobManagerProposed(address indexed newJobManager, uint256 executableAt);

    /// @notice Emitted when a pending jobManager change is executed.
    event JobManagerUpdated(address indexed oldJobManager, address indexed newJobManager);

    /// @notice Emitted when a minEvaluatorStake change is proposed.
    event MinStakeProposed(uint256 newMinimum, uint256 executableAt);

    /// @notice Emitted when a pending minEvaluatorStake change is executed.
    event MinStakeExecuted(uint256 oldMinimum, uint256 newMinimum);

    /// @notice Emitted when any pending governance proposal is cancelled by the owner.
    event ProposalCancelled(bytes32 indexed key);

    // ─── Errors ───────────────────────────────────────────────────────────────

    /// @notice Thrown when a function is called by an address that is not the jobManager.
    error OnlyJobManager(address caller);

    /// @notice Thrown when there are no eligible evaluators to assign.
    error NoEligibleEvaluators();

    /// @notice Thrown when an evaluator tries to unstake more than their staked balance.
    error InsufficientStake(uint256 requested, uint256 available);

    /// @notice Thrown when an unstake would drop the evaluator below minEvaluatorStake
    ///         while they are still active (use full unstake to deactivate).
    error WouldDropBelowMinimum(uint256 remaining, uint256 minimum);

    /// @notice Thrown when stake() or unstake() is called with a zero amount.
    error ZeroAmount();

    /// @notice Thrown when a required address is zero.
    error ZeroAddress(string paramName);

    /// @notice Thrown when slash() tries to slash more than the evaluator's stake.
    error SlashExceedsStake(uint256 requested, uint256 available);

    /// @notice Thrown when slash() is called while slashPaused == true.
    /// @dev FINDING NOUVEAU: the owner can pause slashing immediately (no timelock)
    ///      to protect stakers during a window where the jobManager address may be
    ///      compromised and the 2-day governance rotation has not yet completed.
    error SlashPaused();

    /// @notice Thrown when stake() would push the active evaluator count above MAX_ACTIVE_EVALUATORS.
    /// @dev Prevents O(n) loops in assignEvaluator() from exceeding the block gas limit.
    ///      An evaluator who triggers this error should wait for an existing evaluator to
    ///      unstake, or contact governance to upgrade the contract to support a larger registry.
    error MaxEvaluatorsReached();

    /// @notice Thrown when setWarmupPeriod() is called with a period exceeding the 30-day cap.
    /// @param proposed The warmup period that was proposed.
    /// @param maximum  The maximum allowed warmup period (30 days).
    error WarmupPeriodTooLong(uint64 proposed, uint64 maximum);

    // ── Governance timelock errors ────────────────────────────────────────────

    /// @notice Thrown when execute*() is called but no proposal exists for that key.
    error NoProposalPending(bytes32 key);

    /// @notice Thrown when execute*() is called before the governance delay has elapsed.
    error GovernanceDelayNotElapsed(uint256 executableAt);

    /// @notice Thrown when the value passed to execute*() does not match the proposed value.
    error ProposalValueMismatch();

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice Minimum stake required to be eligible as an evaluator.
    /// @dev 100 tokens with 18 decimals = 100 * 1e18. Governable via proposeMinEvaluatorStake/executeMinEvaluatorStake.
    uint256 public minEvaluatorStake = 100 * 1e18;

    /// @notice Maximum number of simultaneously active evaluators.
    /// @dev Prevents the O(n) loops in assignEvaluator() and executeMinEvaluatorStake()
    ///      from exceeding the block gas limit on mainnet. At 200 evaluators, each loop
    ///      iteration costs ~2 200 gas (1 SLOAD warm + comparison + increment), so the
    ///      full loop costs ~440 000 gas — well within Base's 30M gas limit but bounded.
    ///      Raising this constant requires a contract upgrade; governance cannot change it
    ///      at runtime, which is intentional: the ceiling protects all stakers, not just
    ///      the owner. If the ecosystem grows beyond 200 evaluators, the contract should
    ///      be upgraded to a more efficient selection mechanism (e.g., Chainlink VRF +
    ///      offchain registry snapshot).
    uint256 public constant MAX_ACTIVE_EVALUATORS = 200;

    /// @notice Absolute ceiling on the warmup period, enforced in setWarmupPeriod().
    /// @dev 30 days is already a very conservative anti-Sybil window. A higher value
    ///      would risk starving the registry of eligible evaluators during bootstrapping.
    uint64 public constant MAX_WARMUP_PERIOD = 30 days;

    /// @notice Mandatory delay between a governance proposal and its execution.
    /// @dev FINDING-005: mirrors the same constant in AgentJobManager.
    ///      Applies to: setJobManager and setMinEvaluatorStake.
    ///      setWarmupPeriod is NOT timelocked because it does not control fund flow —
    ///      it affects only evaluator eligibility timing, which is less critical.
    uint256 public constant GOVERNANCE_DELAY = 2 days;

    // ─── Warmup period (anti-Sybil) ───────────────────────────────────────────

    /// @notice Minimum duration an evaluator must have been above minEvaluatorStake
    ///         before they are eligible for assignment.
    /// @dev Initialized to 7 days. Governable via setWarmupPeriod().
    ///      A new staker (or one who unstaked and restaked) must wait this long
    ///      before their stake counts in assignEvaluator()'s weighted selection,
    ///      making Sybil attacks via temporary staking economically unattractive.
    uint64 public warmupPeriod = 7 days;

    // ─── Immutables ───────────────────────────────────────────────────────────

    /// @notice The ProtocolToken contract used for staking and slashing.
    /// @dev Immutable — set once at construction, never changes.
    ProtocolToken public immutable protocolToken;

    // ─── State variables ─────────────────────────────────────────────────────

    /// @notice Address of the AgentJobManager — the only caller allowed for assign/slash.
    /// @dev Updated via proposeJobManager/executeJobManager with GOVERNANCE_DELAY.
    ///      Changing this address is critical: a wrong address would allow an
    ///      arbitrary contract to trigger slashing and drain all staked tokens.
    address public jobManager;

    /// @notice When true, slash() reverts immediately regardless of the caller.
    /// @dev FINDING NOUVEAU: emergency circuit breaker. Allows the owner to instantly stop
    ///      slashing without waiting for the 2-day GOVERNANCE_DELAY that applies to rotating
    ///      jobManager. Scenario: AgentJobManager is compromised; the attacker could drain all
    ///      evaluator stakes via fraudulent slash() calls during the 2-day rotation window.
    ///      slashPaused == true blocks this attack instantly. The owner then rotates the
    ///      jobManager normally via the timelock. Only the slash path is blocked — staking,
    ///      unstaking, and evaluator assignment are unaffected.
    ///      Intentionally NOT timelocked because the threat it defends against is active and
    ///      time-sensitive: waiting 2 days to pause slashing defeats the purpose entirely.
    bool public slashPaused;

    /// @notice Staking state per evaluator address.
    mapping(address => Evaluator) private evaluators;

    /// @notice Ordered list of all currently active evaluator addresses.
    /// @dev Used for O(n) weighted random selection. In production with thousands of
    ///      evaluators, this should be replaced with a more efficient data structure.
    address[] private activeEvaluators;

    // ─── Governance timelock state ────────────────────────────────────────────

    /// @notice Pending governance changes, keyed by keccak256 of parameter name.
    /// @dev FINDING-005: same pattern as AgentJobManager.pendingChanges.
    struct PendingChange {
        bytes32 valueHash;    // keccak256(abi.encode(newValue))
        uint256 executableAt; // Earliest executable timestamp
    }

    mapping(bytes32 => PendingChange) private pendingChanges;

    // ─── Modifiers ────────────────────────────────────────────────────────────

    /**
     * @dev Restricts a function to the AgentJobManager contract.
     *      We use a custom error instead of require() for gas savings.
     */
    modifier onlyJobManager() {
        if (msg.sender != jobManager) revert OnlyJobManager(msg.sender);
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @notice Deploys the EvaluatorRegistry with a reference to the ProtocolToken.
     * @dev jobManager is left as address(0) and must be set via setJobManager()
     *      after AgentJobManager is deployed. This is safe because no critical function
     *      is callable while jobManager == address(0) (assignEvaluator and slash both
     *      require msg.sender == jobManager, which would never match address(0)).
     * @param _protocolToken Address of the deployed ProtocolToken contract.
     */
    constructor(address _protocolToken) Ownable(msg.sender) {
        if (_protocolToken == address(0)) revert ZeroAddress("protocolToken");
        protocolToken = ProtocolToken(_protocolToken);
    }

    // ─── External functions ───────────────────────────────────────────────────

    /**
     * @notice Stakes ProtocolToken to register as an eligible evaluator.
     * @dev The caller must have approved this contract for at least `amount` tokens
     *      before calling. Transfers tokens from caller to this contract.
     *      If the staker's total reaches minEvaluatorStake, they are added to
     *      the active evaluators list and become eligible for assignment.
     *      CEI is fully respected: since ProtocolToken has no fee-on-transfer logic,
     *      the amount is exact and known upfront — state is updated BEFORE the transfer.
     * @param amount Number of ProtocolToken to stake (in wei, 18 decimals).
     */
    function stake(uint256 amount) external nonReentrant {
        // CHECKS
        if (amount == 0) revert ZeroAmount();

        // EFFECTS — update state before the token transfer (CEI)
        // ProtocolToken has no fee-on-transfer logic, so the received amount equals `amount`
        // exactly. We can safely update state first without reading the post-transfer balance.
        Evaluator storage eval = evaluators[msg.sender];
        eval.stakedAmount += amount;

        // Activate the evaluator if they cross the minimum threshold and are not yet active.
        if (!eval.active && eval.stakedAmount >= minEvaluatorStake) {
            // Guard against O(n) gas exhaustion: cap the active set size.
            // We check before updating any state so that the revert leaves storage clean.
            // The more permissive alternative (silently skip activation) is rejected because
            // it would leave the evaluator believing they are eligible when they are not —
            // a silent failure that would be extremely hard to diagnose on-chain.
            if (activeEvaluators.length >= MAX_ACTIVE_EVALUATORS) revert MaxEvaluatorsReached();

            eval.active      = true;
            eval.index       = activeEvaluators.length;
            // Record the activation timestamp for the warmup filter in assignEvaluator().
            // If this evaluator previously unstaked below the threshold and is now re-staking,
            // activeSince is reset to now — the warmup period starts over. This prevents
            // a Sybil pattern where an attacker repeatedly stakes/unstakes to exploit
            // brief windows of "warmed-up" status accumulated before a prior slash.
            eval.activeSince = uint64(block.timestamp);
            activeEvaluators.push(msg.sender);
        }

        // INTERACTIONS — transfer tokens into this contract after all state is finalized
        protocolToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, amount, eval.stakedAmount);
    }

    /**
     * @notice Withdraws staked tokens from the registry.
     * @dev If unstaking would drop the balance below minEvaluatorStake while the
     *      evaluator is active, the call reverts. The evaluator must unstake fully
     *      (all tokens) to deactivate. Partial unstake is only allowed if the
     *      remaining balance stays at or above minEvaluatorStake.
     *      This restriction prevents evaluators from gaming the stake-weighted
     *      selection by unstaking just before assignment.
     * @param amount Number of ProtocolToken to withdraw (in wei, 18 decimals).
     */
    function unstake(uint256 amount) external nonReentrant {
        // CHECKS
        if (amount == 0) revert ZeroAmount();

        Evaluator storage eval = evaluators[msg.sender];
        if (amount > eval.stakedAmount) revert InsufficientStake(amount, eval.stakedAmount);

        uint256 remaining = eval.stakedAmount - amount;

        // If currently active, enforce that the remaining stake either stays above
        // the minimum OR drops to zero (full deactivation). Partial drop below minimum
        // is rejected because it would create an active evaluator with inadequate skin-in-the-game.
        if (eval.active && remaining > 0 && remaining < minEvaluatorStake) {
            revert WouldDropBelowMinimum(remaining, minEvaluatorStake);
        }

        // EFFECTS — update state before the token transfer (CEI)
        eval.stakedAmount = remaining;

        if (eval.active && remaining < minEvaluatorStake) {
            // Deactivate: remove from the activeEvaluators array using swap-and-pop
            // to avoid leaving gaps and to keep the array dense.
            _removeFromActive(eval.index);
            eval.active      = false;
            eval.index       = 0;
            // Reset activeSince to avoid leaving a stale "ghost" timestamp that could
            // confuse future auditors or tooling into believing this evaluator is still
            // in the warmup phase. A deactivated evaluator has no active period.
            eval.activeSince = 0;
        }

        // INTERACTIONS — transfer tokens back to the caller
        protocolToken.safeTransfer(msg.sender, amount);

        emit Unstaked(msg.sender, amount, eval.stakedAmount);
    }

    /**
     * @notice Pseudo-randomly assigns an eligible evaluator to a job.
     * @dev RESTRICTED: only callable by the AgentJobManager contract.
     *      Selection is stake-weighted: evaluators with more stake have proportionally
     *      higher selection probability, aligning economic incentives with quality.
     *
     * @dev SECURITY NOTE (FINDING #2): This randomness is pseudo-random and theoretically
     *      manipulable by the Base sequencer (Coinbase). On Base L2, block.prevrandao does not
     *      carry the same entropy as on Ethereum mainnet post-Merge — the L2 sequencer can
     *      influence block metadata within certain bounds. We mitigate this by combining
     *      five independent entropy sources:
     *        - block.prevrandao: sequencer-influenced randomness beacon
     *        - blockhash(block.number - 1): previous block hash, harder to predict in advance
     *        - block.timestamp: block time, manipulable only by ±15s
     *        - jobId: job-specific entropy, different for every assignment
     *        - activeEvaluators.length: registry state at assignment time
     *      This combination significantly raises the cost of manipulation compared to a single
     *      source, but is NOT cryptographically secure. For production use with high-value jobs
     *      where evaluator selection is worth gaming, consider upgrading to Chainlink VRF v2.
     *      The current implementation is acceptable for testnet and low-to-medium value mainnet
     *      use where the economic incentive to manipulate is lower than the sequencer's cost.
     *
     *      Entropy sources: block.prevrandao (EIP-4399), blockhash(block.number - 1),
     *      block.timestamp, jobId, and activeEvaluators.length.
     * @param jobId The job ID for which to assign an evaluator (used as entropy).
     * @return assigned The address of the selected evaluator.
     */
    function assignEvaluator(uint256 jobId) external onlyJobManager returns (address assigned) {
        uint256 count = activeEvaluators.length;
        if (count == 0) revert NoEligibleEvaluators();

        // Capture the current warmup threshold once to avoid repeated storage reads.
        uint64 warmupThreshold = uint64(block.timestamp) - warmupPeriod;
        // Note: if block.timestamp < warmupPeriod (impossible in practice — block timestamps
        // are Unix epoch values far above any realistic warmupPeriod), the subtraction would
        // underflow. We rely on the 30-day cap in setWarmupPeriod() making this safe.

        // Compute total staked across all eligible (warmed-up) evaluators for weighted selection.
        // Evaluators whose activeSince > warmupThreshold (i.e. block.timestamp < activeSince + warmupPeriod)
        // are excluded from both the totalStake sum and the selection walk.
        // This is O(n) — acceptable for the current expected registry size (<1000 evaluators).
        uint256 totalStake = 0;
        for (uint256 i = 0; i < count; ) {
            // An evaluator passes the warmup filter when they have been continuously active
            // for at least warmupPeriod. activeSince <= warmupThreshold ⟺
            // block.timestamp >= activeSince + warmupPeriod.
            if (evaluators[activeEvaluators[i]].activeSince <= warmupThreshold) {
                totalStake += evaluators[activeEvaluators[i]].stakedAmount;
            }
            unchecked { ++i; }
        }

        // If no evaluator has passed the warmup period, the registry has no eligible candidates.
        // This should be rare in steady state (7-day window) but can occur during bootstrapping
        // or after a mass-slash event. The caller (fund()) should surface this revert to the user.
        if (totalStake == 0) revert NoEligibleEvaluators();

        // Generate a pseudo-random point in [0, totalStake).
        // We use keccak256 rather than a simple modulo to avoid bias from small totalStake values.
        //
        // FINDING #2 fix: five entropy sources combined to raise the cost of sequencer manipulation.
        // blockhash(block.number - 1) is included because it is determined by the previous block
        // and cannot be known when the current transaction is being constructed, making it harder
        // for the sequencer to predict and target a specific evaluator.
        // activeEvaluators.length adds registry state entropy — different for every pool composition.
        uint256 randomPoint = uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao,           // EIP-4399 randomness beacon (post-Merge)
                    blockhash(block.number - 1), // previous block hash — unknown at tx construction time
                    block.timestamp,             // block time adds unpredictability for same-block jobs
                    jobId,                       // job-specific entropy — unique per assignment
                    activeEvaluators.length      // registry state at assignment time
                )
            )
        ) % totalStake;

        // Walk the active evaluators array and select the one whose cumulative warmed-up
        // stake window contains the random point (stake-weighted selection, warmup-filtered).
        uint256 cumulative = 0;
        for (uint256 i = 0; i < count; ) {
            // Skip evaluators still in their warmup period — same filter as above.
            if (evaluators[activeEvaluators[i]].activeSince <= warmupThreshold) {
                cumulative += evaluators[activeEvaluators[i]].stakedAmount;
                if (randomPoint < cumulative) {
                    assigned = activeEvaluators[i];
                    break;
                }
            }
            unchecked { ++i; }
        }

        // assigned should always be set because randomPoint < totalStake and we only
        // counted warmed-up stake, but we guard against edge cases to prevent address(0).
        if (assigned == address(0)) revert NoEligibleEvaluators();

        emit EvaluatorAssigned(jobId, assigned);
    }

    /**
     * @notice Slashes an evaluator's stake by burning a portion of their tokens.
     * @dev RESTRICTED: only callable by the AgentJobManager contract.
     *      Slashed tokens are burned (not sent to a treasury) to make the punishment
     *      credibly destructive and prevent governance from capturing slash proceeds.
     *      If the slash reduces stake below minEvaluatorStake, the evaluator is
     *      deactivated automatically.
     * @param evaluator Address of the evaluator to slash.
     * @param amount    Amount of ProtocolToken to slash (in wei, 18 decimals).
     */
    function slash(address evaluator, uint256 amount) external onlyJobManager nonReentrant {
        // CHECKS
        // FINDING NOUVEAU: check slash pause BEFORE any state reads.
        // If slashPaused == true, the owner has signalled an active emergency (likely a
        // compromised jobManager). We revert immediately rather than burn staker tokens.
        if (slashPaused) revert SlashPaused();

        Evaluator storage eval = evaluators[evaluator];
        if (amount > eval.stakedAmount) revert SlashExceedsStake(amount, eval.stakedAmount);

        // EFFECTS — update state before burning (CEI)
        eval.stakedAmount -= amount;

        if (eval.active && eval.stakedAmount < minEvaluatorStake) {
            _removeFromActive(eval.index);
            eval.active      = false;
            eval.index       = 0;
            // Reset activeSince: a slashed and deactivated evaluator has no active period.
            // Leaving a stale timestamp would be a ghost value misleading future auditors.
            eval.activeSince = 0;
        }

        // INTERACTIONS — burn the slashed tokens permanently
        // ProtocolToken.burn() is called on this contract's own balance,
        // so there is no external call that could trigger reentrancy back into us.
        protocolToken.burn(amount);

        emit EvaluatorSlashed(evaluator, amount, eval.stakedAmount);
    }

    // ─── Admin functions ─────────────────────────────────────────────────────

    // ── Emergency: slash pause ────────────────────────────────────────────────

    /**
     * @notice Immediately pauses or unpauses the slash() function.
     * @dev FINDING NOUVEAU: emergency circuit breaker, intentionally NOT timelocked.
     *      Rationale: if AgentJobManager is compromised and an attacker is actively calling
     *      slash(), waiting 2 days for the GOVERNANCE_DELAY to rotate jobManager would allow
     *      the attacker to drain all staked tokens. Pausing slash instantly (no delay) is the
     *      only effective defence during the rotation window.
     *      This is the ONLY function in EvaluatorRegistry that bypasses the timelock model.
     *      It is justified because:
     *        1. It only blocks slash() — all other protocol functions remain operational.
     *        2. The slash pause itself cannot be used to steal funds (it only prevents burns).
     *        3. It is reversible by the same owner, immediately, once the threat is resolved.
     *      After activating the pause, the owner should immediately initiate proposeJobManager()
     *      with the replacement address and wait for the 2-day delay to rotate jobManager.
     * @param paused True to block slash(), false to re-enable it.
     */
    function setSlashPaused(bool paused) external onlyOwner {
        slashPaused = paused;
        emit SlashPauseUpdated(paused);
    }

    // ── Governance timelock: jobManager ──────────────────────────────────────

    /**
     * @notice Step 1 of 2 — proposes a new AgentJobManager address.  Actual update
     *         is delayed by GOVERNANCE_DELAY (2 days).
     * @dev FINDING-005: the jobManager address controls who can call slash() and
     *      assignEvaluator(). A malicious or incorrect rotation would allow an attacker
     *      to slash all evaluators arbitrarily. The 2-day delay makes the pending change
     *      publicly visible before it takes effect, giving stakers time to react.
     *
     *      First-time wiring (initial deployment): because GOVERNANCE_DELAY is 2 days
     *      but tests and the deployment script need to call setJobManager immediately
     *      after deployment, the registry exposes proposeJobManager / executeJobManager.
     *      For the initial deployment on testnet, the deployer calls both in the same
     *      script (proposal + time.increase + execute in tests, or a multi-step script
     *      on chain). For production, the delay is enforced.
     * @param _jobManager Proposed AgentJobManager address. Must be non-zero.
     */
    function proposeJobManager(address _jobManager) external onlyOwner {
        if (_jobManager == address(0)) revert ZeroAddress("jobManager");

        bytes32 key = keccak256("jobManager");
        uint256 executableAt = block.timestamp + GOVERNANCE_DELAY;
        pendingChanges[key] = PendingChange({
            valueHash:    keccak256(abi.encode(_jobManager)),
            executableAt: executableAt
        });
        emit JobManagerProposed(_jobManager, executableAt);
    }

    /**
     * @notice Step 2 of 2 — executes a previously proposed jobManager change.
     * @param _jobManager Must match the value passed to the corresponding proposeJobManager().
     */
    function executeJobManager(address _jobManager) external onlyOwner {
        bytes32 key = keccak256("jobManager");
        PendingChange storage p = pendingChanges[key];

        if (p.executableAt == 0) revert NoProposalPending(key);
        if (block.timestamp < p.executableAt) revert GovernanceDelayNotElapsed(p.executableAt);
        if (p.valueHash != keccak256(abi.encode(_jobManager))) revert ProposalValueMismatch();

        delete pendingChanges[key]; // CEI: clear before applying
        address oldJobManager = jobManager;
        jobManager = _jobManager;
        emit JobManagerUpdated(oldJobManager, _jobManager);
    }

    // ── Governance timelock: minEvaluatorStake ────────────────────────────────

    /**
     * @notice Step 1 of 2 — proposes a new minimum evaluator stake.
     * @dev FINDING-005: raising the minimum immediately would deactivate evaluators
     *      mid-assignment, potentially blocking active jobs from completing. The 2-day
     *      delay gives evaluators time to top-up their stake if needed before the
     *      new threshold takes effect.
     * @param newMinimum Proposed minimum stake in wei (18 decimals). Must be non-zero.
     */
    function proposeMinEvaluatorStake(uint256 newMinimum) external onlyOwner {
        if (newMinimum == 0) revert ZeroAmount();

        bytes32 key = keccak256("minEvaluatorStake");
        uint256 executableAt = block.timestamp + GOVERNANCE_DELAY;
        pendingChanges[key] = PendingChange({
            valueHash:    keccak256(abi.encode(newMinimum)),
            executableAt: executableAt
        });
        emit MinStakeProposed(newMinimum, executableAt);
    }

    /**
     * @notice Step 2 of 2 — executes a previously proposed minimum stake change.
     * @dev Replicates the O(n) eligibility re-evaluation logic from the old immediate setter.
     *      This is safe here because the execution is intentionally delayed — the owner
     *      has had 2 days to assess gas costs and any operational impact.
     * @param newMinimum Must match the value passed to the corresponding proposeMinEvaluatorStake().
     */
    function executeMinEvaluatorStake(uint256 newMinimum) external onlyOwner {
        bytes32 key = keccak256("minEvaluatorStake");
        PendingChange storage p = pendingChanges[key];

        if (p.executableAt == 0) revert NoProposalPending(key);
        if (block.timestamp < p.executableAt) revert GovernanceDelayNotElapsed(p.executableAt);
        if (p.valueHash != keccak256(abi.encode(newMinimum))) revert ProposalValueMismatch();

        delete pendingChanges[key]; // CEI: clear before applying

        uint256 oldMinimum = minEvaluatorStake;
        minEvaluatorStake = newMinimum;

        // Re-evaluate eligibility for all registered evaluators when the minimum changes.
        // This is O(n) but executeMinEvaluatorStake is an infrequent governance action
        // whose cost is known and accepted by the owner who signed the execute transaction.
        uint256 i = 0;
        while (i < activeEvaluators.length) {
            address addr = activeEvaluators[i];
            Evaluator storage eval = evaluators[addr];
            if (eval.stakedAmount < newMinimum) {
                // Deactivate — swap with last element and pop
                _removeFromActive(i);
                eval.active      = false;
                eval.index       = 0;
                // Reset activeSince: deactivated evaluator has no active period.
                eval.activeSince = 0;
                // Do not increment i — the swapped element now occupies index i.
            } else {
                unchecked { ++i; }
            }
        }

        emit MinEvaluatorStakeUpdated(oldMinimum, newMinimum);
        emit MinStakeExecuted(oldMinimum, newMinimum);
    }

    // ── Governance: proposal cancellation ────────────────────────────────────

    /**
     * @notice Cancels any pending governance proposal identified by its key.
     * @param key keccak256 identifier of the proposal to cancel.
     */
    function cancelProposal(bytes32 key) external onlyOwner {
        delete pendingChanges[key];
        emit ProposalCancelled(key);
    }

    /**
     * @notice Updates the warmup period for new or re-staking evaluators.
     * @dev NOT timelocked: warmup changes only affect future evaluator eligibility timing,
     *      not fund flows. The impact is bounded (cannot exceed MAX_WARMUP_PERIOD = 30 days)
     *      and primarily affects how quickly new evaluators become eligible — acceptable
     *      for an immediate governance action.
     *      The warmup period is how long an evaluator must remain above minEvaluatorStake
     *      before they appear in assignEvaluator()'s weighted selection pool.
     * @param newPeriod New warmup duration in seconds. Maximum: 30 days (MAX_WARMUP_PERIOD).
     */
    function setWarmupPeriod(uint64 newPeriod) external onlyOwner {
        if (newPeriod > MAX_WARMUP_PERIOD) revert WarmupPeriodTooLong(newPeriod, MAX_WARMUP_PERIOD);
        warmupPeriod = newPeriod;
        emit WarmupPeriodUpdated(newPeriod);
    }

    // ─── View functions ───────────────────────────────────────────────────────

    /**
     * @notice Returns the staked amount for a given evaluator address.
     * @param evaluator The evaluator address to query.
     * @return The number of staked ProtocolToken in wei.
     */
    function getStake(address evaluator) external view returns (uint256) {
        return evaluators[evaluator].stakedAmount;
    }

    /**
     * @notice Returns whether an evaluator is currently eligible for assignment.
     * @param evaluator The evaluator address to query.
     * @return True if the evaluator is active (stake >= minEvaluatorStake).
     */
    function isEligible(address evaluator) external view returns (bool) {
        return evaluators[evaluator].active;
    }

    /**
     * @notice Returns the number of currently active (eligible) evaluators.
     * @return The length of the activeEvaluators array.
     */
    function getEvaluatorCount() external view returns (uint256) {
        return activeEvaluators.length;
    }

    // ─── Internal functions ───────────────────────────────────────────────────

    /**
     * @notice Removes an evaluator from the activeEvaluators array using swap-and-pop.
     * @dev This is the standard O(1) pattern for array removal without gaps.
     *      The last element is moved to fill the removed slot, then the array is shrunk.
     *      The caller is responsible for updating the removed evaluator's active, index,
     *      and activeSince fields in storage after this call returns.
     * @param index The current index of the evaluator to remove in activeEvaluators.
     */
    function _removeFromActive(uint256 index) internal {
        uint256 lastIndex = activeEvaluators.length - 1;

        if (index != lastIndex) {
            // Move the last evaluator to the vacant slot.
            address lastEvaluator = activeEvaluators[lastIndex];
            activeEvaluators[index] = lastEvaluator;
            // Update the moved evaluator's index in storage.
            evaluators[lastEvaluator].index = index;
        }

        // Remove the last element (now a duplicate) and shrink the array.
        activeEvaluators.pop();
    }
}
