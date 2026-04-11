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
    uint256 remainingStake,
    bytes32 reason
);
```

| Field | Type | Indexed | Description |
|---|---|---|---|
| `evaluator` | `address` | yes | Penalized evaluator wallet |
| `jobId` | `uint256` | yes | Job that triggered the slash |
| `amount` | `uint256` | no | Amount of VRT slashed |
| `remainingStake` | `uint256` | no | Evaluator's remaining stake post-slash |
| `reason` | `bytes32` | no | Encoded rationale for the slash |

**History:**
- `jobId` + `reason` added following forum discussion on ERC-8183 thread — aligns with ERC-8210 `fileClaim` pattern (cmayorga, PR #1653)
- `remainingStake` added during internal security review (2026-04-10) — allows downstream consumers to assess evaluator solvency post-slash without a separate registry call. Not part of the original forum agreement — flagged to cmayorga post-deployment.

**Event selector:** `keccak256("EvaluatorSlashed(address,uint256,uint256,uint256,bytes32)")`

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
function assignEvaluator(uint256 jobId, address provider, address client) external returns (address);
```

Called exclusively by `AgentJobManager.fund()`. Selects a stake-weighted eligible evaluator that is neither `provider` nor `client`. Maximum 5 re-draw attempts before reverting with `EvaluatorAssignmentFailed`.

#### `slash()`

```solidity
function slash(address evaluator, uint256 amount, uint256 jobId, bytes32 reason) external;
```

Called exclusively by `AgentJobManager`. Burns `amount` VRT from `evaluator`'s stake and emits `EvaluatorSlashed`.

#### `setMetadata()` / `getMetadata()`

```solidity
function setMetadata(string calldata metadata) external;
function getMetadata(address evaluator) external view returns (string memory);
```

`setMetadata` requires the caller to be an active evaluator past warmup. `getMetadata` returns `""` if the evaluator is inactive. Max length: 2048 characters.

---

## AgentJobManager

### Errors

#### `EvaluatorConflict`

```solidity
error EvaluatorConflict(uint256 jobId, address evaluator, string role);
```

Post-assignment safety check in `fund()`. Reverts if the assigned evaluator matches the provider or client despite the re-draw loop.

---

## Change process

1. Propose the interface change on the [ERC-8183 forum thread](https://ethereum-magicians.org/t/erc-8183-agentic-commerce/27902) and wait for feedback (minimum 24h).
2. Update this file in the same commit as the contract change.
3. Post the final deployed signature as a comment on relevant PRs (e.g. ethereum/ERCs#1653).
