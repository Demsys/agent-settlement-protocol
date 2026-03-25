// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockERC8004Registry
 * @notice Test double for the ERC-8004 reputation registry.
 *         Records all calls for inspection and supports a configurable revert mode
 *         so that ReputationBridge's try/catch path can be exercised deterministically.
 */
contract MockERC8004Registry {

    struct OutcomeCall {
        address agent;
        address counterpart;
        bool    positive;
        uint256 jobId;
        bytes32 reason;
    }

    OutcomeCall[] public calls;
    bool public shouldRevert;

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function recordOutcome(
        address agent,
        address counterpart,
        bool    positive,
        uint256 jobId,
        bytes32 reason
    ) external {
        if (shouldRevert) revert("MockERC8004Registry: always reverts");
        calls.push(OutcomeCall({
            agent:       agent,
            counterpart: counterpart,
            positive:    positive,
            jobId:       jobId,
            reason:      reason
        }));
    }

    function getCallCount() external view returns (uint256) {
        return calls.length;
    }

    function getCall(uint256 index) external view returns (OutcomeCall memory) {
        return calls[index];
    }
}
