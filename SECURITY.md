# Security

## Reporting vulnerabilities

Do not open a public GitHub issue for security vulnerabilities.

Use GitHub's **Private Vulnerability Reporting** feature instead:
[github.com/Demsys/agent-settlement-protocol/security/advisories/new](https://github.com/Demsys/agent-settlement-protocol/security/advisories/new)

Please include:
- A description of the issue
- A step-by-step exploit scenario
- The estimated impact (funds at risk, protocol invariant broken, etc.)

We will respond within 48 hours.

---

## Audit status

This project has been functionally tested on Base Sepolia. A complete job lifecycle (create → fund → submit → complete/reject) has been verified on-chain with real transactions.

An internal security review was completed on 2026-04-10, covering the following findings:

| ID | Finding | Resolution |
|---|---|---|
| A01 | `setMetadata()` checked `active` flag instead of full eligibility (warmup) | Fixed: requires warmup period to have elapsed |
| A02 | Stale metadata returned after evaluator deactivation | Fixed: `getMetadata()` returns `""` if evaluator inactive |
| A03 | No length bound on metadata string | Fixed: `MAX_METADATA_LENGTH = 2048` enforced |
| A04 | Post-assignment conflict check missing in `fund()` | Fixed: double-check evaluator ≠ provider and ≠ client after assignment |
| A05 | Max re-draw attempts (3) too low for small evaluator pools | Fixed: raised to `MAX_ASSIGNMENT_RETRIES = 5` |

**The contracts have not undergone a professional external security audit. Do not use this protocol with real funds before a complete audit by an independent security firm.**

Planned audit scope before mainnet: full smart contract review with focus on the slashing mechanism, evaluator selection entropy, fee accounting, and reentrancy surface.

---

## Security assumptions

### Smart contracts

- **Checks-Effects-Interactions** is applied without exception on all state-modifying functions.
- **ReentrancyGuard** (OpenZeppelin) is applied to all fund-transferring functions (`fund`, `complete`, `reject`, `claimExpired`, `slash`).
- **SafeERC20** is used for all ERC-20 transfers.
- **Pull-over-push** pattern is used for refunds to prevent griefing.
- **AccessControl** (OpenZeppelin) with named roles governs all privileged operations.
- Slashing in `EvaluatorRegistry` can only be triggered by `AgentJobManager` — never by an external caller.
- The governance delay (minimum 2 days) applies to any change linking `AgentJobManager` ↔ `EvaluatorRegistry` to prevent flash-attack governance.

### Evaluator trust model

Evaluators are **not** trusted parties — they are economically aligned. An evaluator that acts dishonestly can have its stake slashed. The security guarantee is cryptoeconomic, not identity-based.

The protocol assumes:
- At least 2 eligible evaluators are in the pool (neither the provider nor the client of the job being funded) for auto-assignment to function.
- Evaluators have completed the warmup period, preventing last-second Sybil registration to capture specific jobs.

### API server

- Agent private keys are encrypted at rest using AES-256-GCM with a deployer-held key (`WALLET_ENCRYPTION_KEY`).
- The API server is a trusted component. A compromise of the server compromises all managed agent wallets. Self-custody (bringing your own signer) is not yet supported.
- Rate limits are in place (120 req/15 min globally, 3 agent creations/hour per IP) to limit key generation abuse.

### RPC / blockchain connectivity

- The API trusts its configured Base Sepolia RPC endpoint. No light-client validation is performed.
- Transaction finality is assumed after 1 confirmation (Base L2 — fast finality).

---

## Known limitations

### `claimExpired()` is client-only

Only the job's client address can call `claimExpired()` to recover escrowed funds after a deadline passes. If the client wallet is lost or is an ephemeral address, the escrowed USDC is permanently locked in the contract. Mitigation: always use a recoverable address as the client.

### Evaluator selection uses block hash entropy

`assignEvaluator()` seeds selection from `block.prevrandao`. On Base (an L2 with a sequencer), this value is less manipulable than on L1, but it is not provably random. A sequencer with advance knowledge of the evaluator pool and block randomness could theoretically influence which evaluator is assigned. The 5-retry cap limits the practical impact of this.

### No contract upgradeability

Contracts are not upgradeable (no proxy pattern). Any bug fix requires redeployment and migration. This is intentional — upgradeability introduces its own attack surface and governance risk. The tradeoff is accepted for this stage of the protocol.

### Testnet USDC is not real USDC

`MockUSDC.sol` has a permissionless `mint()` function. It has no economic value and is used for functional testing only. The deployed `AgentJobManager` is configured to use this token on Base Sepolia.

---

## Out of scope

The following are accepted risks or design decisions, not vulnerabilities:

- Evaluator methodology diversity — different evaluators may evaluate on different criteria. This is transparent via the `metadata` field on `EvaluatorRegistry`.
- The deployer wallet has elevated privileges on testnet (faucet, initial VRT distribution). On mainnet, these functions would be removed or governed.
- Jobs with no eligible evaluator in the pool will revert at `fund()` with `EvaluatorAssignmentFailed`. This is intentional — creating a job in an empty pool is a user error.
