// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

/**
 * @title IAttestationVerifier
 * @notice Verifies an on-chain attestation proof against an attestation hash.
 *         Used by the ERC-8183 `complete()` overload that accepts a structured
 *         proof (e.g. an EIP-712 L4 attestation conforming to ERC-8263).
 *
 * @dev Implementations manage their own trusted signer set. ERC-8183 is fully
 *      agnostic to the attestation scheme — verifiers may validate gateway
 *      signatures (ERC-8263 L4), zkML proofs, TEE attestations, or any other
 *      scheme.
 *
 *      The verifier is passed as a parameter at `complete()` time by the
 *      evaluator. ERC-8183 does not register or whitelist verifiers — the trust
 *      model is: the evaluator selects the verifier; if the verifier is
 *      compromised the evaluator bears the reputational and slashing risk.
 *
 *      Reference: ERC-8274 IProofVerifier (Magicians thread 28083).
 */
interface IAttestationVerifier {
    /**
     * @notice Verifies a proof against an attestation hash.
     * @param attestationHash keccak256 commitment over the attestation data.
     *                        For ERC-8263 attestations this is the manifest_hash
     *                        submitted by the provider at `submit()` time.
     * @param proof           ABI-encoded proof payload. Format is implementation-
     *                        specific. For ERC-8263: abi.encode(attestationStruct,
     *                        l4Signature) where attestationStruct contains the
     *                        EIP-712 typed fields and l4Signature is the gateway
     *                        attestor's signature over the EIP-712 digest.
     * @return True if the proof is valid and the attestation hash matches the
     *         expected commitment; false otherwise. Must not revert on invalid
     *         proofs — return false instead so the caller can emit a structured error.
     */
    function verify(
        bytes32 attestationHash,
        bytes calldata proof
    ) external view returns (bool);
}
