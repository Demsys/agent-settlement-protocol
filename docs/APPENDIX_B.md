# ERC-8183 — Appendix B.x: Outcome Envelope Field Mapping and External Attestation References

> **Status:** Informative (non-normative). This section cross-references working implementations
> and companion specifications. It does not fix field names or impose requirements on ERC-8265 §11,
> which retains its reserved character.

---

## Overview

This appendix maps ERC-8183 on-chain job fields to the outcome envelope shape described in
ERC-8265 §11, and cross-references the external attestation layer (ERC-8263) that provides
cryptographic input integrity guarantees.

The outcome envelope is an off-chain structure produced at job settlement time. Its fields
correspond to on-chain state transitions in AgentJobManager.

---

## Field Mapping Table

| Outcome Envelope Field | ERC-8183 On-chain Field | Set at       | Description |
|------------------------|-------------------------|--------------|-------------|
| `status`               | `job.status`            | `complete()` / `reject()` | Terminal state: Completed, Rejected, or Expired |
| `commitmentRef`        | `job.reason`            | `complete()` (attested path) | keccak256 of the L4 manifest struct — input anchor |
| `deliverable`          | `job.deliverable`       | `submit()`   | Output hash submitted by the provider |
| `evaluator`            | `job.evaluator`         | `fund()`     | Address of the assigned evaluator |

> **Note on `commitmentRef`:** this field is only meaningful via the attested `complete()` overload
> (see §Attested Settlement below). The simple `complete(jobId, bytes32 reason)` path sets
> `job.reason` to the evaluator's verdict hash, which is not an input anchor.

---

## Cryptographic Binding

`commitmentRef` equals the `manifest_hash` from an L4 attestation (ERC-8263). The manifest
struct is defined in ERC-8263 and explicitly includes `inputHash` as a named field:

```
manifest_struct {
  inputHash               bytes32   // keccak256 of sanitized inputs — the WYRIWE anchor
  rawInputHash            bytes32   // keccak256 of raw inputs before sanitization
  sanitizationPipelineHash bytes32  // hash of the sanitization pipeline applied
  outputHash              bytes32   // keccak256 of agent outputs
  l4Signature             bytes     // attestor signature over the struct
}

manifest_hash = keccak256(abi.encode(manifest_struct))
```

The binding between the outcome envelope and the funded input is:

```
outcome.commitmentRef == manifest_hash
manifest_struct.inputHash == keccak256(sanitized_inputs_at_fund_time)
```

**This chain is independently verifiable.** Anyone holding the manifest struct can compute
`keccak256(manifest_struct)` and confirm it equals `commitmentRef` without trusting the
verifier's word. The verifier enforces the binding on-chain; the struct makes it auditable
off-chain.

### Separation from `deliverable`

`commitmentRef` and `deliverable` are committed at different lifecycle events and serve
distinct purposes:

- `commitmentRef` = input anchor, committed at `fund()` time, before agent execution
- `deliverable` = output claim, committed at `submit()` time, after agent execution

The separation is load-bearing: `commitmentRef` proves the outcome envelope refers to the
same input that was funded, independently of what the agent delivers.

---

## Attested Settlement Path

ERC-8183 exposes a second `complete()` overload for attested settlement:

```solidity
function complete(
    uint256 jobId,
    bytes32 attestationHash,  // = manifest_hash = commitmentRef
    address verifier,         // IAttestationVerifier implementation
    bytes calldata proof      // ABI-encoded manifest_struct + l4_signature
) external;
```

The verifier contract (implementing `IAttestationVerifier`) receives `attestationHash` and
`proof`, reconstructs the manifest struct from the proof, and verifies:

1. `keccak256(manifest_struct) == attestationHash`
2. `manifest_struct.l4Signature` is valid over the struct from a trusted attestor

On success, `attestationHash` is stored as `job.reason`, serving as `commitmentRef` in the
outcome envelope.

```
IAttestationVerifier.verify(attestationHash, proof) → bool
```

The verifier manages its own trusted attestor set. ERC-8183 is agnostic to the attestation
scheme — any IAttestationVerifier implementation satisfying the interface may be used.

---

## Producer-Loop Disposition

The `intent` enum governing producer-loop disposition (retry / abandon) is the implementing
wallet's specific mapping of its internal decision logic. ERC-8265 §11 reserves the shape for
this pattern without fixing field names. It is not represented in this outcome envelope and is
not defined by §11 itself.

---

## External References

These specifications are referenced by Ethereum Magicians thread URLs pending editor merge:

- **ERC-8263** (L4 attestation, manifest struct definition):
  https://ethereum-magicians.org/t/erc-8263-verifiable-agent-inference-attestation/28047
- **ERC-8274** (IProofVerifier interface, basis for IAttestationVerifier):
  https://ethereum-magicians.org/t/erc-8274-on-chain-proof-verifier-interface/28134
- **ERC-8265 §11** (outcome envelope reservation):
  https://ethereum-magicians.org/t/erc-8265-agentic-commerce-outcome-envelopes/27956

---

## Reference Implementation

- `contracts/interfaces/IAttestationVerifier.sol` — verifier interface
- `contracts/core/AgentJobManager.sol` — attested `complete()` overload
- `contracts/test/MockAttestationVerifier.sol` — test double
- Deployed on Base Sepolia: `0x27E64c0180b1c9D860561C423479492f25ff7bE3`
