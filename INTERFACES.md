# Public Interfaces

This document tracks all public interface changes that external implementers depend on — events, errors, and function signatures discussed with the ERC-8183 community.

**Any change to a signature listed here must be communicated on the ERC-8183 forum thread before deployment.**

---

## EvaluatorRegistry

### Events

#### `EvaluatorSlashed`

```solidity
event EvaluatorSlashed(
    address indexed evaluator,
    uint256 indexed jobId,
    uint256 amount,
    bytes32 reason
);
```

| Field | Type | Indexed | Description |
|---|---|---|---|
| `evaluator` | `address` | yes | Penalized evaluator wallet |
| `jobId` | `uint256` | yes | Job that triggered the slash |
| `amount` | `uint256` | no | Amount of VRT slashed |
| `reason` | `bytes32` | no | Encoded rationale for the slash |

**History:**
- `jobId` + `reason` added following forum discussion on ERC-8183 thread — aligns with ERC-8210 `fileClaim` pattern (cmayorga, PR #1653)
- `remainingStake` was added during internal security review (2026-04-10) without forum coordination — removed in next deployment following cmayorga's model-agnostic argument (2026-04-13). Use `EvaluatorStakeUpdated` to observe post-slash stake.

**Event selector:** `keccak256("EvaluatorSlashed(address,uint256,uint256,bytes32)")`
= `0xcb5d72742ee3621a5866ac2be4db3fe7e9c85d5856dc630981eb883b0d1b3063`

---

#### `EvaluatorStakeUpdated`

```solidity
event EvaluatorStakeUpdated(
    address indexed evaluator,
    uint256 oldBalance,
    uint256 newBalance
);
```

| Field | Type | Indexed | Description |
|---|---|---|---|
| `evaluator` | `address` | yes | Evaluator whose stake changed |
| `oldBalance` | `uint256` | no | Stake before the operation |
| `newBalance` | `uint256` | no | Stake after the operation |

Emitted on every stake change: slash, deposit, and withdrawal. Replaces `remainingStake` in `EvaluatorSlashed` as the canonical way to observe evaluator solvency without a separate registry call.

**History:**
- Added in next deployment (2026-04-13) — Option 1 agreed with cmayorga and ThoughtProof on ERC-8183 forum thread.

**Event selector:** `keccak256("EvaluatorStakeUpdated(address,uint256,uint256)")`
= `0x6cd48d420e9a3b8749169c664b2086d4ae959b0392e812d62955aac996f48d1a`

---

#### `EvaluatorMetadataUpdated`

```solidity
event EvaluatorMetadataUpdated(address indexed evaluator, string metadata);
```

| Field | Type | Indexed | Description |
|---|---|---|---|
| `evaluator` | `address` | yes | Evaluator that updated their metadata |
| `metadata` | `string` | no | Declared methodology (URL, IPFS CID, or JSON) |

---

### Errors

#### `EvaluatorAssignmentFailed`

```solidity
error EvaluatorAssignmentFailed(uint256 jobId, address provider, address client);
```

Reverts when `assignEvaluator()` cannot find an eligible evaluator that is neither the provider nor the client within `MAX_ASSIGNMENT_RETRIES` (5) attempts.

---

### Functions

#### `assignEvaluator()`

```solidity
function assignEvaluator(uint256 jobId, address provider, address client) external view returns (address);
```

Called exclusively by `AgentJobManager.fund()`. Selects a stake-weighted eligible evaluator that is neither `provider` nor `client`. Maximum 5 re-draw attempts before reverting with `EvaluatorAssignmentFailed`.

#### `slash()`

```solidity
function slash(address evaluator, uint256 amount, uint256 jobId, bytes32 reason) external;
```

Called exclusively by `AgentJobManager`. Burns `amount` VRT from `evaluator`'s stake and emits `EvaluatorSlashed` then `EvaluatorStakeUpdated`.

#### `setMetadata()` / `getMetadata()`

```solidity
function setMetadata(string calldata metadata) external;
function getMetadata(address evaluator) external view returns (string memory);
```

`setMetadata` requires the caller to be an active evaluator past warmup. `getMetadata` returns `""` if the evaluator is inactive. Max length: 2048 characters.

---

## AgentJobManager

### Constants

#### `EVALUATOR_SHARE_BPS`

```solidity
uint256 public constant EVALUATOR_SHARE_BPS = 8_000; // 80%
```

Share of the protocol fee paid to the assigned evaluator on `complete()`. The remaining 20% (`10_000 - EVALUATOR_SHARE_BPS`) is sent to `treasury`. Both shares are calculated from the gross fee (`budget * feeRate / 10_000`) — the provider's payment is unaffected.

**History:**
- Added 2026-04-26 alongside Treasury.sol and the 80/20 fee split.

---

### State variables

#### `evaluationFee`

```solidity
uint128 public evaluationFee;
```

Fixed fee per evaluation in token decimals. When `> 0`, replaces the proportional fee (`budget * feeRate / 10_000`) with a flat amount charged regardless of job budget. Capped at `budget` so the provider's refund never underflows. When `0` (default), proportional mode is active.

**Rationale:** Proportional fees produce near-zero evaluator income on small jobs (e.g. 1 USDC × 0.5% × 80% = 0.004 USDC — below Base L2 gas cost for the evaluate tx). A fixed fee (e.g. 0.50 USDC) guarantees gas coverage and reduces Sybil surface.

Governed via `proposeEvaluationFee()` / `executeEvaluationFee()` with `GOVERNANCE_DELAY` (2 days).

**History:**
- Added 2026-05-13 — pre-mainnet milestone.

---

#### `treasury` (replaces `feeRecipient`)

```solidity
address public treasury;
```

Address of the `Treasury` contract that receives the 20% protocol share on `complete()`. Replaces the former `feeRecipient` variable. Timelocked via `proposeTreasury()` / `executeTreasury()` (2-day `GOVERNANCE_DELAY`).

**History:**
- `feeRecipient` renamed to `treasury` on 2026-04-26 — semantic alignment with Treasury.sol. Associated events (`FeeRecipientProposed` → `TreasuryProposed`, `FeeRecipientUpdated` → `TreasuryUpdated`) and functions (`proposeFeeRecipient` → `proposeTreasury`, `executeFeeRecipient` → `executeTreasury`) renamed accordingly.

---

### Events

#### `EvaluatorAssigned`

```solidity
event EvaluatorAssigned(uint256 indexed jobId, address indexed evaluator);
```

Emitted by `AgentJobManager.fund()` when `evaluator = address(0)` (auto-assign path). Single source of truth for assignment events — daemon integrators watch AgentJobManager exclusively. Not emitted by `EvaluatorRegistry`.

**History:**
- Previous deployment (2026-04-10): emitted from `EvaluatorRegistry.assignEvaluator()` only — DX gap reported by pablocactus.
- Next deployment (2026-04-13): moved to `AgentJobManager.fund()`. `EvaluatorRegistry.assignEvaluator()` is now `view` — no state mutation, no event emission.

**Event selector:** `keccak256("EvaluatorAssigned(uint256,address)")`
= `0x50a93d710505e6f207121334c60e2a4c6312fdbae71f879f5abee6488e20b131`

---

#### `FeeDistributed`

```solidity
event FeeDistributed(
    uint256 indexed jobId,
    address indexed evaluator,
    uint256 evaluatorFee,
    uint256 treasuryFee
);
```

| Field | Type | Indexed | Description |
|---|---|---|---|
| `jobId` | `uint256` | yes | Job whose fee was distributed |
| `evaluator` | `address` | yes | Evaluator wallet that received `evaluatorFee` |
| `evaluatorFee` | `uint256` | no | Token units sent to the evaluator (80% of gross fee) |
| `treasuryFee` | `uint256` | no | Token units sent to `treasury` (20% of gross fee) |

Emitted in **both `complete()` and `reject()`** whenever the gross fee is non-zero. The evaluator is compensated for the evaluation work regardless of verdict — this prevents a perverse incentive to always call `complete()` in order to capture the fee share.

**Fee flow by terminal state:**

| State | Provider receives | Evaluator receives | Treasury receives | Client receives |
|---|---|---|---|---|
| `COMPLETED` | `budget - fee` | `fee * 80%` | `fee * 20%` | — |
| `REJECTED` | — | `fee * 80%` | `fee * 20%` | `budget - fee` |

`fee          = evaluationFee > 0 ? min(evaluationFee, budget) : budget * feeRate / 10_000`
`evaluatorFee = fee * EVALUATOR_SHARE_BPS / 10_000`
`treasuryFee  = fee - evaluatorFee`

Rounding: integer division truncates toward zero on `evaluatorFee`; the remainder goes to `treasuryFee` (favors the treasury by at most 1 token unit).

**History:**
- Added 2026-04-26 — emitted on both `complete()` and `reject()` to align evaluator incentives with verdict independence.

---

#### `EvaluationFeeProposed` / `EvaluationFeeUpdated`

```solidity
event EvaluationFeeProposed(uint128 oldFee, uint128 newFee, uint256 executableAt);
event EvaluationFeeUpdated(uint128 oldFee, uint128 newFee);
```

Emitted by `proposeEvaluationFee()` (step 1) and `executeEvaluationFee()` (step 2) respectively. Same 2-day governance pattern as `FeeRateProposed` / `FeeRateUpdated`.

**History:**
- Added 2026-05-13 alongside the `evaluationFee` state variable.

---

### Errors

#### `EvaluatorConflict`

```solidity
error EvaluatorConflict(uint256 jobId, address evaluator, string role);
```

Post-assignment safety check in `fund()`. Reverts if the assigned evaluator matches the provider or client despite the re-draw loop.

---

## Treasury

Deployed alongside `AgentJobManager`. Receives the 20% protocol share of every job fee in the payment token (e.g. USDC). Accumulates fees by token and exposes a governance-controlled buyback path that swaps accumulated tokens for VRT and burns them.

### Events

#### `BuybackQueued`

```solidity
event BuybackQueued(address indexed token, uint256 amount);
```

| Field | Type | Indexed | Description |
|---|---|---|---|
| `token` | `address` | yes | Payment token queued for buyback (e.g. MockUSDC) |
| `amount` | `uint256` | no | Token units queued |

Emitted by `buybackAndBurn()` on testnet (stub). On mainnet this will be replaced by `BuybackExecuted` once the DEX integration (Aerodrome on Base) is wired.

**History:**
- Added 2026-04-26 — stub for testnet. DEX integration deferred to pre-mainnet milestone.

---

#### `BuybackExecuted` *(mainnet — not yet implemented)*

```solidity
event BuybackExecuted(address indexed token, uint256 tokenSpent, uint256 vrtBurned);
```

Reserved signature for the mainnet buyback-and-burn. Documents the intended final shape so integrators can plan ahead. Will replace `BuybackQueued` once the Aerodrome integration is implemented.

---

### Functions

#### `buybackAndBurn()`

```solidity
function buybackAndBurn(address token, uint256 amount) external;
```

Owner-only. On testnet: emits `BuybackQueued` and does nothing else (stub). On mainnet: swaps `amount` of `token` for VRT via the configured DEX, then calls `ProtocolToken.burn()` on the received VRT.

---

## Change process

1. Update this file first — before touching any Solidity code.
2. Post the planned change on the [ERC-8183 forum thread](https://ethereum-magicians.org/t/erc-8183-agentic-commerce/27902) and wait for feedback (minimum 24h).
3. Implement in Solidity only after forum acknowledgement.
4. Deploy and post the final deployed selector as a comment on relevant PRs (e.g. ethereum/ERCs#1653).
