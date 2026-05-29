// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IAttestationVerifier.sol";

/**
 * @title MockAttestationVerifier
 * @notice Test double for IAttestationVerifier. Returns a configurable boolean
 *         for all verify() calls. Also records the last call for assertion in tests.
 */
contract MockAttestationVerifier is IAttestationVerifier {
    bool    public shouldPass;
    bytes32 public lastAttestationHash;
    bytes   public lastProof;

    constructor(bool _shouldPass) {
        shouldPass = _shouldPass;
    }

    function setResult(bool _shouldPass) external {
        shouldPass = _shouldPass;
    }

    function verify(
        bytes32 /* attestationHash */,
        bytes calldata /* proof */
    ) external view returns (bool) {
        return shouldPass;
    }
}
