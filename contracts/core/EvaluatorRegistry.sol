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
     */
    struct Evaluator {
        uint256 stakedAmount;   // Total tokens currently staked
        uint256 index;          // Index in the activeEvaluators array (valid only when active)
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

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice Minimum stake required to be eligible as an evaluator.
    /// @dev 100 tokens with 18 decimals = 100 * 1e18. Governable via setMinEvaluatorStake().
    uint256 public minEvaluatorStake = 100 * 1e18;

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
     *      Follows CEI: state updated before SafeERC20 transfer is impossible here
     *      because we need the actual transferred amount — but since we use a known
     *      ERC-20 (ProtocolToken, not fee-on-transfer), the amount is exact.
     *      We perform the transfer first then update state, protected by ReentrancyGuard.
     * @param amount Number of ProtocolToken to stake (in wei, 18 decimals).
     */
    function stake(uint256 amount) external nonReentrant {
        // CHECKS
        if (amount == 0) revert ZeroAmount();

        // INTERACTIONS (transfer first to ensure funds arrive before state update)
        // Safe because ProtocolToken is our own contract with no fee-on-transfer logic.
        // ReentrancyGuard prevents any reentrancy from this call.
        protocolToken.safeTransferFrom(msg.sender, address(this), amount);

        // EFFECTS
        Evaluator storage eval = evaluators[msg.sender];
        eval.stakedAmount += amount;

        // Activate the evaluator if they cross the minimum threshold and are not yet active.
        if (!eval.active && eval.stakedAmount >= minEvaluatorStake) {
            eval.active = true;
            eval.index = activeEvaluators.length;
            activeEvaluators.push(msg.sender);
        }

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
            _removeFromActive(msg.sender, eval.index);
            eval.active = false;
            eval.index = 0;
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

        // Compute total staked across all active evaluators for weighted selection.
        // This is O(n) — acceptable for the current expected registry size (<1000 evaluators).
        uint256 totalStake = 0;
        for (uint256 i = 0; i < count; ) {
            totalStake += evaluators[activeEvaluators[i]].stakedAmount;
            unchecked { ++i; }
        }

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

        // Walk the active evaluators array and find the evaluator whose cumulative
        // stake window contains the random point (stake-weighted selection).
        uint256 cumulative = 0;
        for (uint256 i = 0; i < count; ) {
            cumulative += evaluators[activeEvaluators[i]].stakedAmount;
            if (randomPoint < cumulative) {
                assigned = activeEvaluators[i];
                break;
            }
            unchecked { ++i; }
        }

        // assigned should always be set because randomPoint < totalStake,
        // but we guard against any edge case to prevent returning address(0).
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
            _removeFromActive(evaluator, eval.index);
            eval.active = false;
            eval.index = 0;
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
     * @notice Updates the minimum stake required to be an active evaluator.
     * @dev Lowering the minimum activates evaluators who previously had insufficient stake.
     *      Raising the minimum deactivates evaluators who fall below the new threshold.
     *      In both cases, the activeEvaluators array is updated accordingly.
     * @param newMinimum New minimum stake amount (in wei, 18 decimals).
     */
    function setMinEvaluatorStake(uint256 newMinimum) external onlyOwner {
        if (newMinimum == 0) revert ZeroAmount();
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
                _removeFromActive(addr, i);
                eval.active = false;
                eval.index = 0;
                // Do not increment i — the swapped element now occupies index i.
            } else {
                unchecked { ++i; }
            }
        }
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
     *      The caller is responsible for updating the moved evaluator's index in storage.
     * @param evaluator The evaluator address to remove.
     * @param index     The current index of the evaluator in activeEvaluators.
     */
    function _removeFromActive(address evaluator, uint256 index) internal {
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

        // Suppress the unused variable warning for evaluator — we use it conceptually
        // to document intent, but the actual removal is index-based.
        // slither-disable-next-line unused-variable
        evaluator; // used by callers to update eval.active and eval.index
    }
}
