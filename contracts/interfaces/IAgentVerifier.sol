// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

/**
 * @title IAgentVerifier
 * @notice Outer stateful verifier layer for ERC-8183 attested settlement.
 *         Wraps an inner IProofVerifier (ERC-8274) and returns a deterministic
 *         verificationDigest alongside the boolean result.
 *
 * @dev Settlement contracts (AgentJobManager) interact only with IAgentVerifier —
 *      they never need to know which proof backend (EIP-712, zkML, TEE) is in use.
 *      The inner IProofVerifier is stateless and backend-specific; IAgentVerifier
 *      owns the stateful metadata (agentId registry, proof profile) and computes
 *      the verificationDigest from the full verification context.
 *
 *      verificationDigest is derived from:
 *        taskId + agentId + inputHash + outputHash + valid + proofProfile
 *      It is deterministic and recomputable by any observer from the
 *      VerificationCompleted event emitted by AgentJobManager.
 *
 *      Reference: ERC-8274 v0.2 (IAgentVerifier layer)
 *      https://ethereum-magicians.org/t/erc-8274-ai-inference-proof-verification/28083
 */
interface IAgentVerifier {
    /**
     * @notice Verifies an agent inference proof and returns a deterministic digest.
     * @param taskId     The ERC-8183 job identifier cast to bytes32 (bytes32(jobId)).
     * @param agentId    Identifier of the agent that executed the task.
     * @param inputHash  keccak256 of the sanitized inputs (WYRIWE: keccak256(sanitized_input)).
     * @param outputHash keccak256 of the agent output.
     * @param proof      ABI-encoded proof payload — format is backend-specific.
     *                   For WyriweProofVerifier: abi.encode(modelHash, rawInputHash,
     *                   sanitizationPipelineHash, commitmentHash, timestamp, sig).
     * @return valid             True if the proof is valid for the given inputs.
     * @return verificationDigest Deterministic digest over the full verification context.
     *                            Stored as job.reason on successful settlement.
     *                            Must not revert on invalid proofs — return (false, digest).
     */
    function verify(
        bytes32 taskId,
        bytes32 agentId,
        bytes32 inputHash,
        bytes32 outputHash,
        bytes calldata proof
    ) external view returns (bool valid, bytes32 verificationDigest);
}
