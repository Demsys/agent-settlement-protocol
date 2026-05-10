# Evaluator Integration Guide

## Overview

In ERC-8183, an evaluator is a third-party address that arbitrates job outcomes. When a client funds a job, the protocol selects an evaluator automatically via stake-weighted random draw. The evaluator is neither the client nor the provider. Once the provider submits a deliverable, the evaluator calls `complete()` or `reject()` on `AgentJobManager`. A correct evaluation earns the protocol fee share; a disputed or missed evaluation exposes the evaluator's stake to slashing.

This guide covers everything needed to run an evaluator daemon against the Base Sepolia testnet.

---

## Prerequisites

- **VRT minimum stake:** 100 VRT (the current `minEvaluatorStake` on testnet — verify on-chain before staking)
- **ETH for gas:** Base Sepolia ETH, available from the [Base Sepolia faucet](https://docs.base.org/docs/tools/network-faucets)
- **Node.js 18+** and `ethers` v6

---

## Contract Addresses (Base Sepolia)

Deployed 2026-05-04.

| Contract | Address |
|---|---|
| AgentJobManager | `0xC07CE789206CBEEC3A41D5CedBdA93B1024aaDdd` |
| EvaluatorRegistry | `0x4F4aa58A715B6a5357da0EA067C405803f489BD1` |
| Treasury | `0x3CB5FB6C2b986e9Aa545da958E77b847C6FF677D` |
| ProtocolToken (VRT) | `0x4c4468567eE753d1b27Cf02b5896b4af71c40719` |
| MockUSDC | `0xC87bde7b470e23Db5558fb4eE4073908dA21Bb0B` |
| ReputationBridge | `0x8CEbEF8f552bC8fDB48FBB8ad9B21CE1e3E03bfd` |

---

## Step 1 — Staking

Staking registers your wallet as an eligible evaluator and signals your participation commitment via locked VRT.

**Sequence:**

1. Check `EvaluatorRegistry.isEligible(yourAddress)` — if `true`, skip to Step 2.
2. Read `EvaluatorRegistry.minEvaluatorStake()` to get the minimum amount required.
3. Call `ProtocolToken.approve(EvaluatorRegistry, amount)` and wait for confirmation.
4. Call `EvaluatorRegistry.stake(amount)` and wait for confirmation.

**Warmup period:** After staking, your wallet enters a warmup period before `isEligible()` returns `true`. During warmup the protocol will not assign jobs to your address. The current warmup period is set to **24 hours on testnet** (contract default is 7 days — reduced by governance for testnet bootstrapping). Check `EvaluatorRegistry.warmupPeriod()` for the live value.

```typescript
const minStake = await registry.minEvaluatorStake()
await (await token.approve(CONTRACTS.EvaluatorRegistry, minStake)).wait(1)
await (await registry.stake(minStake)).wait(1)
```

---

## Step 2 — Monitoring Assignments

### Event source

`EvaluatorAssigned` is emitted exclusively by `AgentJobManager.fund()`. It is **not** emitted by `EvaluatorRegistry`.

This is a deliberate protocol design: `EvaluatorRegistry.assignEvaluator()` is a `view` function since the 2026-04-13 deployment — it performs no state mutation and emits no events. `AgentJobManager.fund()` calls it, then emits `EvaluatorAssigned` itself. Daemon integrators must watch `AgentJobManager`, not `EvaluatorRegistry`.

**Event signature:**

```solidity
event EvaluatorAssigned(uint256 indexed jobId, address indexed evaluator);
```

**Event selector:** `0x50a93d710505e6f207121334c60e2a4c6312fdbae71f879f5abee6488e20b131`

Because `evaluator` is the second indexed topic, you can filter `eth_getLogs` directly on your wallet address as `topics[2]`, avoiding the need to fetch and parse all assignment events.

### getLogs pagination

Base Sepolia enforces a maximum of **9000 blocks per `eth_getLogs` request**. Requests spanning more blocks are rejected with an RPC error. Paginate in chunks:

```typescript
const CHUNK_SIZE = 9_000n

for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
  const end = start + CHUNK_SIZE - 1n < toBlock ? start + CHUNK_SIZE - 1n : toBlock
  const logs = await provider.getLogs({ address, topics, fromBlock: Number(start), toBlock: Number(end) })
  // process logs
}
```

### Fallback via eth_getTransactionReceipt

On freshly deployed contracts, the RPC node's log index may lag by several blocks — `eth_getLogs` can return 0 results even when events were emitted. If your daemon detects 0 results over the last 9000 blocks and you have known `fund()` transaction hashes available (e.g. from a client you control or from monitoring the mempool), you can retrieve the receipt directly:

```typescript
const receipt = await provider.getTransactionReceipt(txHash)
for (const log of receipt.logs) {
  if (log.topics[0] === EVENT_SELECTOR && log.topics[2] === paddedEvaluatorAddress) {
    // parse the assignment
  }
}
```

This is a recovery path, not the primary strategy. In steady state, paginated `getLogs` is sufficient.

---

## Step 3 — Submitting a Deliverable (Provider)

Once a job is in `FUNDED` state and you are the designated provider, call `submit()` with a keccak256 hash of your deliverable before the deadline.

```solidity
function submit(uint256 jobId, bytes32 deliverable) external;
```

The deliverable content is communicated off-chain (via A2A or any agreed channel); only the commitment hash is stored on-chain for the evaluator to verify.

```typescript
// Hash of whatever you are delivering — IPFS CID, URL, JSON blob, etc.
const deliverable = ethers.keccak256(ethers.toUtf8Bytes('ipfs://Qm...'))
const tx = await jobManager.submit(jobId, deliverable)
await tx.wait(1)
```

**Important constraints:**
- Only the address set as `provider` at job creation can call `submit()`.
- The job must be in `FUNDED` state — calling on `OPEN` or `SUBMITTED` reverts.
- `block.timestamp` must be ≤ `job.deadline`. If the deadline has passed, the client can call `claimExpired()` instead — `submit()` will revert.
- `deliverable` must not be `bytes32(0)`.

**Auto-extension of the deadline:** If less than `MIN_EVALUATION_WINDOW` (48 hours) remains when `submit()` is called, the contract automatically extends the deadline to `block.timestamp + MIN_EVALUATION_WINDOW`. A `DeadlineExtended` event is emitted. This protects the provider from a last-second submission being immediately expired before the evaluator can act.

---

## Step 4 — Evaluating a Job

### Job lifecycle

```
OPEN → FUNDED → SUBMITTED → COMPLETED
                          → REJECTED
                          → EXPIRED
```

- `FUNDED`: `fund()` was called by the client, payment is escrowed, evaluator is assigned.
- `SUBMITTED`: the provider called `submit()` with their deliverable. The evaluator must now act.
- Terminal states: `complete()` moves to `COMPLETED`, `reject()` to `REJECTED`, inaction past the deadline to `EXPIRED`.

### Calling complete() or reject()

Once you observe a job in `SUBMITTED` state (monitor `JobSubmitted` events or poll `getJob()`), call one of:

```solidity
function complete(uint256 jobId, bytes32 reason) external;
function reject(uint256 jobId, bytes32 reason)   external;
```

The `reason` parameter is a `bytes32` hash. Use the keccak256 hash of an attestation CID or other immutable reference to your evaluation report. For short human-readable strings (max 31 characters), `ethers.encodeBytes32String('ok')` works as a placeholder during development.

```typescript
const reason = ethers.keccak256(ethers.toUtf8Bytes(`job-${jobId}-accepted`))
const tx = await jobManager.complete(jobId, reason)
await tx.wait(1)
```

Only the assigned evaluator for a job can call `complete()` or `reject()` on that job. Any other address will revert.

---

## Step 5 — Observing Stake Changes

`EvaluatorRegistry` emits `EvaluatorStakeUpdated` on every stake change: staking, unstaking, and slashing.

```solidity
event EvaluatorStakeUpdated(
    address indexed evaluator,
    uint256 oldBalance,
    uint256 newBalance
);
```

This event replaces the former `remainingStake` field that was removed from `EvaluatorSlashed` in the 2026-04-13 deployment. Use it to track your own solvency without an additional `eth_call` after each operation.

A `newBalance` of `0` after a slash means your stake has been fully burned and `isEligible()` will return `false`. You must re-stake to receive new assignments.

---

## Events Reference

| Event | Contract | Selector |
|---|---|---|
| `EvaluatorAssigned(uint256 indexed jobId, address indexed evaluator)` | AgentJobManager | `0x50a93d710505e6f207121334c60e2a4c6312fdbae71f879f5abee6488e20b131` |
| `EvaluatorSlashed(address indexed evaluator, uint256 indexed jobId, uint256 amount, bytes32 reason)` | EvaluatorRegistry | `0xcb5d72742ee3621a5866ac2be4db3fe7e9c85d5856dc630981eb883b0d1b3063` |
| `EvaluatorStakeUpdated(address indexed evaluator, uint256 oldBalance, uint256 newBalance)` | EvaluatorRegistry | `0x6cd48d420e9a3b8749169c664b2086d4ae959b0392e812d62955aac996f48d1a` |
| `EvaluatorMetadataUpdated(address indexed evaluator, string metadata)` | EvaluatorRegistry | — |

---

## Errors Reference

| Error | Contract | Description |
|---|---|---|
| `EvaluatorAssignmentFailed(uint256 jobId, address provider, address client)` | EvaluatorRegistry | `assignEvaluator()` could not find an eligible evaluator that is neither provider nor client within 5 attempts. Reverts `fund()`. |
| `EvaluatorConflict(uint256 jobId, address evaluator, string role)` | AgentJobManager | Post-assignment safety check: the drawn evaluator matches the provider or client. Reverts `fund()`. |
