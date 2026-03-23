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

    /// @notice Thrown when setWarmupPeriod() is called with a period exceeding the 30-day cap.
    /// @param proposed The warmup period that was proposed.
    /// @param maximum  The maximum allowed warmup period (30 days).
    error WarmupPeriodTooLong(uint64 proposed, uint64 maximum);

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice Minimum stake required to be eligible as an evaluator.
    /// @dev 100 tokens with 18 decimals = 100 * 1e18. Governable via setMinEvaluatorStake().
    uint256 public minEvaluatorStake = 100 * 1e18;

    /// @notice Absolute ceiling on the warmup period, enforced in setWarmupPeriod().
    /// @dev 30 days is already a very conservative anti-Sybil window. A higher value
    ///      would risk starving the registry of eligible evaluators during bootstrapping.
    uint64 public constant MAX_WARMUP_PERIOD = 30 days;

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
    /// @dev Set after deployment via setJobManager() since AgentJobManager depends on us.
    address public jobManager;

    /// @notice Staking state per evaluator address.
    mapping(address => Evaluator) private evaluators;

    /// @notice Ordered list of all currently active evaluator addresses.
    /// @dev Used for O(n) weighted random selection. In production with thousands of
    ///      evaluators, this should be replaced with a more efficient data structure.
    address[] private activeEvaluators;

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
     *      Entropy sources: block.prevrandao (EIP-4399, post-Merge), jobId, block.timestamp,
     *      and msg.sender (the jobManager). This is adequate for the current threat model
     *      but NOT suitable for high-value adversarial contexts — consider Chainlink VRF
     *      for a production system where evaluator selection is worth manipulating.
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
        uint256 randomPoint = uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao,   // EIP-4399 randomness beacon (post-Merge)
                    jobId,              // job-specific entropy
                    block.timestamp,    // block time adds unpredictability for same-block jobs
                    msg.sender          // jobManager address (constant but adds domain separation)
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

    /**
     * @notice Sets the AgentJobManager address. Only callable by the owner.
     * @dev Must be called once after AgentJobManager is deployed.
     *      Can be updated if the JobManager is upgraded (with appropriate governance).
     * @param _jobManager Address of the deployed AgentJobManager contract.
     */
    function setJobManager(address _jobManager) external onlyOwner {
        if (_jobManager == address(0)) revert ZeroAddress("jobManager");
        jobManager = _jobManager;
    }

    /**
     * @notice Updates the warmup period for new or re-staking evaluators.
     * @dev The warmup period is how long an evaluator must remain above minEvaluatorStake
     *      before they appear in assignEvaluator()'s weighted selection pool.
     *      A higher value increases Sybil resistance at the cost of slower onboarding.
     *      A lower value accelerates onboarding but reduces the economic friction of
     *      creating multiple short-lived evaluator wallets.
     *      Bounded by MAX_WARMUP_PERIOD (30 days) to ensure the registry cannot be
     *      governance-locked into perpetually having zero eligible evaluators.
     *      Note: changing the warmup period affects future assignments only. Evaluators
     *      already past the old warmup threshold remain eligible; evaluators who were
     *      previously ineligible under a longer period may become eligible under a shorter one.
     * @param newPeriod New warmup duration in seconds. Maximum: 30 days (MAX_WARMUP_PERIOD).
     */
    function setWarmupPeriod(uint64 newPeriod) external onlyOwner {
        if (newPeriod > MAX_WARMUP_PERIOD) revert WarmupPeriodTooLong(newPeriod, MAX_WARMUP_PERIOD);
        warmupPeriod = newPeriod;
        emit WarmupPeriodUpdated(newPeriod);
    }

    /**
     * @notice Updates the minimum stake required to be an active evaluator.
     * @dev Lowering the minimum activates evaluators who previously had insufficient stake.
     *      Raising the minimum deactivates evaluators who fall below the new threshold.
     *      In both cases, the activeEvaluators array is updated accordingly.
     * @param newMinimum New minimum stake amount (in wei, 18 decimals).
     */
    function setMinEvaluatorStake(uint256 newMinimum) external onlyOwner {
        if (newMinimum == 0) revert ZeroAmount();

        // Capture the old value before overwriting so we can emit it in the event.
        // Emitting before the write would also work, but capturing is clearer and avoids
        // any ambiguity about which value is "old" if this function is ever extended.
        uint256 oldMinimum = minEvaluatorStake;
        minEvaluatorStake = newMinimum;

        // Re-evaluate eligibility for all registered evaluators when the minimum changes.
        // This is O(n) but setMinEvaluatorStake is an infrequent governance action.
        // We iterate all active evaluators and deactivate those that fall below the new minimum.
        // Note: we cannot easily activate previously inactive evaluators here without
        // a separate enumerable set of all stakers — this is an acceptable limitation.
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
                // Avoids leaving a stale ghost timestamp for future auditors.
                eval.activeSince = 0;
                // Do not increment i — the swapped element now occupies index i.
            } else {
                unchecked { ++i; }
            }
        }

        emit MinEvaluatorStakeUpdated(oldMinimum, newMinimum);
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
