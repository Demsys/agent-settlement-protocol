// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IAgentVerifier.sol";
import "../interfaces/IAgentVerifiable.sol";

interface IMockRegistry {
    function stake(uint256 amount) external;
}

interface IMockManager {
    function complete(
        uint256 jobId,
        bytes32 agentId,
        bytes32 inputHash,
        bytes32 outputHash,
        bytes calldata proof
    ) external;
}

/**
 * @title MockAgentVerifier
 * @notice Test double implementing both IAgentVerifier and IAgentVerifiable.
 *         Configurable pass/fail via setResult(). Returns a deterministic
 *         verificationDigest computed from the input parameters.
 *         Includes helpers to act as a contract evaluator in unit tests.
 * @dev Used exclusively in unit tests — never deploy to mainnet.
 */
contract MockAgentVerifier is IAgentVerifier, IAgentVerifiable {

    bool private shouldPass = true;

    function setResult(bool _shouldPass) external {
        shouldPass = _shouldPass;
    }

    /// @inheritdoc IAgentVerifier
    function verify(
        bytes32 taskId,
        bytes32 agentId,
        bytes32 inputHash,
        bytes32 outputHash,
        bytes calldata /* proof */
    ) external view returns (bool valid, bytes32 verificationDigest) {
        verificationDigest = keccak256(abi.encode(taskId, agentId, inputHash, outputHash, shouldPass));
        return (shouldPass, verificationDigest);
    }

    /// @inheritdoc IAgentVerifiable
    function getAgentVerifier() external view returns (address) {
        return address(this);
    }

    /**
     * @notice Approve + stake VRT in EvaluatorRegistry so this contract
     *         can be registered as an eligible evaluator in tests.
     */
    function stakeInRegistry(address token, address registry, uint256 amount) external {
        IERC20(token).approve(registry, amount);
        IMockRegistry(registry).stake(amount);
    }

    /**
     * @notice Call AgentJobManager's IAgentVerifier complete() overload as
     *         msg.sender == address(this) (required: job.evaluator == address(this)).
     */
    function callComplete(
        address manager,
        uint256 jobId,
        bytes32 agentId,
        bytes32 inputHash,
        bytes32 outputHash,
        bytes calldata proof
    ) external {
        IMockManager(manager).complete(jobId, agentId, inputHash, outputHash, proof);
    }
}
