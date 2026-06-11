// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

/**
 * @title IAgentVerifiable
 * @notice Soft declaration interface for evaluator contracts that use an IAgentVerifier.
 *         Implemented by the evaluator at deployment time — the settlement contract
 *         reads getAgentVerifier() at complete() time to resolve the verifier.
 *
 * @dev EvaluatorRegistry is not aware of this interface. The declaration is a
 *      settlement-layer concern resolved by AgentJobManager at complete() time,
 *      not a staking-layer concern. This keeps EvaluatorRegistry narrow (staking,
 *      slashing, liveness) and allows verifier types to be added without registry upgrades.
 *
 *      An EOA evaluator cannot implement this interface. EOAs must use the
 *      simple complete(jobId, reason) or attested complete(jobId, attestationHash,
 *      verifier, proof) overloads instead.
 */
interface IAgentVerifiable {
    /**
     * @notice Returns the IAgentVerifier this evaluator uses for proof verification.
     * @return Address of the IAgentVerifier implementation. Must not return address(0).
     */
    function getAgentVerifier() external view returns (address);
}
