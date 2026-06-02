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
| `commitmentRef`        | `job.reason`            | `complete()` (attested path) | Attestation commitment including `inputHash` — input anchor. Hash scheme defined by verifier. |
| `deliverable`          | `job.deliverable`       | `submit()`   | Output hash submitted by the provider |
| `evaluator`            | `job.evaluator`         | `fund()`     | Address of the assigned evaluator |

> **Note on `commitmentRef`:** this field is only meaningful via the attested `complete()` overload
> (see §Attested Settlement below). The simple `complete(jobId, bytes32 reason)` path sets
> `job.reason` to the evaluator's verdict hash, which is not an input anchor.

---

## Cryptographic Binding

`commitmentRef` is a bytes32 commitment to the agent input. ERC-8183 does not mandate the
specific hash scheme — the exact definition belongs to the attestation layer and is owned by
the verifier implementation (e.g. ERC-8263, OCP observation commitment, or other schemes).

The invariant ERC-8183 requires is:

> `commitmentRef` cryptographically includes `inputHash` — the keccak256 of the sanitized
> inputs at fund time. This is the WYRIWE anchor: it proves the outcome envelope refers to
> the same input that was funded, independently of what the agent delivers.

Both the ERC-8263 full-struct hash and the OCP observation commitment
(`keccak256(abi.encode(agentId, modelHash, inputHash, outputHash, timestamp))`) satisfy this
invariant since both include `inputHash` as an explicit named field.

**Independent verifiability:** anyone holding the attestation struct (in whichever scheme the
verifier uses) can recompute `commitmentRef` from its fields and confirm the binding without
trusting the verifier's word. The verifier enforces the binding on-chain; the struct makes it
auditable off-chain.

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
    bytes32 attestationHash,  // = commitmentRef — scheme defined by verifier
    address verifier,         // IAttestationVerifier implementation
    bytes calldata proof      // ABI-encoded attestation struct + signature
) external;
```

The verifier contract (implementing `IAttestationVerifier`) receives `attestationHash` and
`proof`, and verifies that the commitment is valid and includes `inputHash`. The exact
verification logic — full-struct hash, OCP commitment, or other — is internal to the verifier.

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

- **ERC-8263** (Onchain Proof Layer for AI Agents):
  https://ethereum-magicians.org/t/erc-8263-onchain-proof-layer-for-ai-agents/28577
- **ERC-8274** (AI Inference Proof Verification — IProofVerifier interface):
  https://ethereum-magicians.org/t/erc-8274-ai-inference-proof-verification/28083
- **ERC-8265 §11** (Prepared Transaction Envelope — Appendix B: Outcome Reporting, Non-normative):
  https://ethereum-magicians.org/t/erc-8265-prepared-transaction-envelope/28557

---

## Reference Implementation

- `contracts/interfaces/IAttestationVerifier.sol` — verifier interface
- `contracts/core/AgentJobManager.sol` — attested `complete()` overload
- `contracts/test/MockAttestationVerifier.sol` — test double
- Deployed on Base Sepolia: `0x27E64c0180b1c9D860561C423479492f25ff7bE3`

## External Implementations

| Implementation | Attestation Scheme | Deployed (Sepolia) | Source |
|---|---|---|---|
| `WyriweAttestationVerifier` (Ensub / ccip-router) | OCP observation commitment — `keccak256(abi.encode(agentId, modelHash, inputHash, outputHash, timestamp))` | `0x9515D6e53D2D45C1CFE6181943ca11C150C2bf61` | `npm ccip-router@0.1.1` |

`WyriweAttestationVerifier.verify()` recovers the signer from the EIP-712 signature over `WyriweAttestation`, recomputes `commitmentHash` from the decoded struct fields, and checks both against `attestationHash`. No external contract calls. Satisfies the §B.x invariant: `commitmentHash` includes `inputHash` as an explicit named field in the ABI encoding.
