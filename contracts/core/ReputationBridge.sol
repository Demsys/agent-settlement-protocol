// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─── OpenZeppelin imports ────────────────────────────────────────────────────
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IERC8004ReputationRegistry
 * @notice Minimal interface for the ERC-8004 Trustless Agents reputation registry.
 * @dev This interface is defined inline here because the ERC-8004 registry contract
 *      is not yet deployed and this bridge must be deployable independently.
 *      Source: ERC-8004 spec (Marco De Rossi, Davide Crapis, Jordan Ellis, Erik Reppel — Aug 2025).
 */
interface IERC8004ReputationRegistry {
    /**
     * @notice Records an outcome for an agent, updating their reputation score.
     * @param agent       The agent whose reputation is being updated.
     * @param counterpart The other agent involved in the interaction.
     * @param positive    True for a positive outcome (completed), false for negative (rejected).
     * @param jobId       On-chain job reference for auditability.
     * @param reason      Keccak256 hash of the evaluation report.
     */
    function recordOutcome(
        address agent,
        address counterpart,
        bool    positive,
        uint256 jobId,
        bytes32 reason
    ) external;
}

/**
 * @title ReputationBridge
 * @notice Bridges ERC-8183 job outcomes to the ERC-8004 reputation registry.
 *         Called by AgentJobManager on terminal job states (Completed or Rejected).
 * @dev This contract is intentionally stateless with respect to funds — it never
 *      holds or transfers any tokens. It is a pure write-forwarding contract.
 *
 *      Design decisions:
 *      - If the ERC-8004 registry address is address(0), all calls to recordJobOutcome()
 *        silently succeed without reverting. This allows the bridge to be deployed and
 *        connected to AgentJobManager before the ERC-8004 registry is available,
 *        without blocking job settlements.
 *      - Only the jobManager can call recordJobOutcome(), preventing anyone from
 *        injecting fraudulent reputation signals.
 *      - If the ERC-8004 registry call reverts (e.g., bad implementation), the bridge
 *        catches the failure and emits an event without reverting. This ensures that
 *        a broken reputation registry can never block job settlements.
 *
 *      Outcome signals emitted to ERC-8004:
 *      - JobCompleted: positive for Provider (delivered), positive for Evaluator (timely verdict)
 *      - JobRejected:  negative for Provider (failed to deliver), no signal for Evaluator
 *
 * @custom:security This contract has no funds. The only attack surface is unauthorized
 *                  calls to recordJobOutcome() — mitigated by the onlyJobManager restriction.
 */
contract ReputationBridge is Ownable {

    // ─── Events ───────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when a job outcome is successfully forwarded to the ERC-8004 registry.
     * @param jobId    The job that reached a terminal state.
     * @param agent    The agent whose reputation was updated.
     * @param positive Whether the outcome was positive (true) or negative (false).
     */
    event OutcomeRecorded(
        uint256 indexed jobId,
        address indexed agent,
        bool            positive
    );

    /**
     * @notice Emitted when the ERC-8004 registry call fails.
     * @dev This event is emitted instead of reverting so that a broken reputation
     *      registry cannot block job settlements. Monitor this event to detect
     *      registry compatibility issues.
     * @param jobId   The job for which the reputation update failed.
     * @param agent   The agent whose update failed.
     * @param reason  The low-level revert data returned by the registry call.
     */
    event ReputationUpdateFailed(
        uint256 indexed jobId,
        address indexed agent,
        bytes           reason
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    /// @notice Thrown when a function is called by an address that is not the jobManager.
    error OnlyJobManager(address caller);

    /// @notice Thrown when a required address is zero in an admin function.
    error ZeroAddress(string paramName);

    // ─── State variables ──────────────────────────────────────────────────────

    /// @notice Address of the AgentJobManager contract authorized to call this bridge.
    /// @dev Set via setJobManager() after deployment. Zero until set.
    address public jobManager;

    /// @notice Address of the ERC-8004 reputation registry.
    /// @dev May be address(0) if the registry is not yet deployed.
    ///      When address(0), all recordJobOutcome() calls succeed silently.
    address public reputationRegistry;

    // ─── Modifiers ────────────────────────────────────────────────────────────

    /**
     * @dev Restricts a function to the configured jobManager address.
     */
    modifier onlyJobManager() {
        if (msg.sender != jobManager) revert OnlyJobManager(msg.sender);
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @notice Deploys the ReputationBridge.
     * @dev Both jobManager and reputationRegistry start as address(0) and must
     *      be configured post-deployment via their respective setters.
     *      This allows independent deployment ordering — no circular dependencies.
     */
    constructor() Ownable(msg.sender) {}

    // ─── External functions ───────────────────────────────────────────────────

    /**
     * @notice Records a job outcome in the ERC-8004 reputation registry.
     * @dev RESTRICTED: only callable by the configured jobManager address.
     *      Signal logic:
     *      - completed == true:
     *          Provider receives a POSITIVE signal (delivered work as agreed)
     *          Evaluator receives a POSITIVE signal (provided timely, valid evaluation)
     *      - completed == false (rejected):
     *          Provider receives a NEGATIVE signal (failed to deliver or delivered out-of-spec)
     *          Evaluator receives NO signal (rejection is a valid outcome, not a failure)
     *      If reputationRegistry == address(0): silently succeeds (feature, not a bug).
     *      If the registry call reverts: emits ReputationUpdateFailed and continues.
     *      This contract never reverts due to a registry failure.
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
    ) external onlyJobManager {
        // If the ERC-8004 registry is not yet deployed, skip silently.
        // This is intentional: the bridge must not block job settlements.
        if (reputationRegistry == address(0)) return;

        IERC8004ReputationRegistry registry = IERC8004ReputationRegistry(reputationRegistry);

        if (completed) {
            // Positive outcome: both provider and evaluator get positive signals.
            _tryRecordOutcome(registry, jobId, provider, evaluator, true, reason);
            _tryRecordOutcome(registry, jobId, evaluator, provider, true, reason);
        } else {
            // Negative outcome (rejected): only the provider gets a negative signal.
            // The evaluator performed their role correctly by rejecting bad work.
            _tryRecordOutcome(registry, jobId, provider, evaluator, false, reason);
        }
    }

    // ─── Admin functions ─────────────────────────────────────────────────────

    /**
     * @notice Sets the AgentJobManager address. Only callable by the owner.
     * @param _jobManager Address of the deployed AgentJobManager contract.
     */
    function setJobManager(address _jobManager) external onlyOwner {
        if (_jobManager == address(0)) revert ZeroAddress("jobManager");
        jobManager = _jobManager;
    }

    /**
     * @notice Sets the ERC-8004 reputation registry address. Only callable by the owner.
     * @dev Can be set to address(0) to temporarily disable reputation forwarding
     *      (e.g., during a registry migration). All calls will succeed silently.
     * @param _reputationRegistry Address of the ERC-8004 registry, or address(0) to disable.
     */
    function setReputationRegistry(address _reputationRegistry) external onlyOwner {
        // address(0) is explicitly allowed here — it disables forwarding silently.
        reputationRegistry = _reputationRegistry;
    }

    // ─── Internal functions ───────────────────────────────────────────────────

    /**
     * @notice Attempts to call recordOutcome() on the ERC-8004 registry.
     * @dev Uses a low-level call wrapped in a try/catch equivalent pattern.
     *      If the call reverts for any reason (out of gas exception aside),
     *      we emit ReputationUpdateFailed and continue rather than propagating
     *      the revert. This prevents a malicious or broken registry from blocking
     *      the settlement flow.
     *
     *      Note on out-of-gas: if the registry call consumes all remaining gas,
     *      this function will also revert. The caller (recordJobOutcome, called by
     *      AgentJobManager) should ensure sufficient gas is forwarded. This is an
     *      acceptable edge case — transactions with insufficient gas revert regardless.
     * @param registry    The ERC-8004 registry to call.
     * @param jobId       Job reference for the outcome record.
     * @param agent       The agent to update.
     * @param counterpart The counterpart agent in the interaction.
     * @param positive    True for positive outcome, false for negative.
     * @param reason      Evaluation report hash.
     */
    function _tryRecordOutcome(
        IERC8004ReputationRegistry registry,
        uint256 jobId,
        address agent,
        address counterpart,
        bool    positive,
        bytes32 reason
    ) internal {
        // Use try/catch to gracefully handle registry failures without reverting.
        try registry.recordOutcome(agent, counterpart, positive, jobId, reason) {
            emit OutcomeRecorded(jobId, agent, positive);
        } catch (bytes memory revertData) {
            // Registry call failed — emit event for off-chain monitoring and continue.
            // This deliberately does NOT revert so that job settlement is never blocked
            // by a reputation registry failure.
            emit ReputationUpdateFailed(jobId, agent, revertData);
        }
    }
}
