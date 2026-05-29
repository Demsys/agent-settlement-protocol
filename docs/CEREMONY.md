# Mainnet Deployment Ceremony

This document describes the deployment procedure for Agent Settlement Protocol on Base mainnet. It is the human-readable companion to `scripts/ceremony.ts`, which automates the steps below.

**Read this document in full before running the script.** The ceremony is a one-shot operation — addresses are permanent and role transfers are irreversible.

---

## Overview

The ceremony achieves two guarantees:

1. **Deterministic addresses** — all contracts are deployed via CREATE2, so their addresses can be computed and published publicly *before* any code is deployed. Anyone can verify them independently.
2. **4-EOA role separation** — ownership of each contract is transferred to a dedicated key at the end of the ceremony. No single key controls the entire protocol.

The pattern follows the approach documented by CardZero ([cardzero.ai/docs/reference/deployment-ceremony](https://cardzero.ai/docs/reference/deployment-ceremony)).

---

## Prerequisites

### 1. Audit complete

**Do not deploy to mainnet without a complete external audit.** The protocol holds user funds. Recommended auditors: Code4rena, Sherlock, Spearbit. Budget 6-10 weeks from submission to report.

### 2. Four hardware wallets prepared

| Role | Controls | Key name |
|---|---|---|
| Deployer | Runs the ceremony script, deploys all contracts | `DEPLOYER_KEY` |
| Registrar | Owns `EvaluatorRegistry` post-ceremony | `REGISTRAR_KEY` |
| Attestor | Owns `AgentJobManager` post-ceremony | `ATTESTOR_KEY` |
| Treasury | Owns `Treasury` post-ceremony | `TREASURY_KEY` |

All four addresses must be distinct. Use hardware wallets (Ledger/Trezor) for Registrar, Attestor, and Treasury — these are permanent operational keys.

### 3. ETH funded

Each EOA needs ≥ 0.01 ETH on Base mainnet to cover deployment gas. Base L2 gas costs are minimal (~$0.01/tx) but the ceremony involves ~15 transactions total.

Fund each role EOA from the Deployer in **three separate transactions** (one per recipient). The Deployer is the visible funding source for all three — this is a ceremony artifact, not a role-authority correlation. The role assignments (Step 4) are the authoritative trust boundary; funding-source linkage carries no protocol authority.

### 4. Salt chosen and published

Choose an `AGENT_SALT` string (e.g. `"asp-v1"`). The final CREATE2 salt is derived as:

```
finalSalt = keccak256(abi.encodePacked(deployer_address, AGENT_SALT))
```

**Publish the deployer address and salt string publicly before deploying** (e.g. on the ERC-8183 forum thread). This allows anyone to independently verify the predicted addresses match what was deployed.

### 5. Test coverage ≥ 95%

Run the full test suite and confirm all tests pass:

```bash
npx hardhat test
npx hardhat coverage
```

---

## Step-by-step

### Step 1 — Predict addresses (before deploying anything)

Run the script in dry-run mode to compute and log all predicted addresses:

```bash
DEPLOYER_KEY=0x... REGISTRAR_KEY=0x... ATTESTOR_KEY=0x... TREASURY_KEY=0x... \
AGENT_SALT=asp-v1 \
npx hardhat run scripts/ceremony.ts --network base
```

The script will abort before deploying if `CEREMONY_CONFIRMED` is not set. At this stage, copy the predicted addresses and publish them (forum post, GitHub issue, tweet — anything with a timestamp).

### Step 2 — Confirm and deploy

After publishing predicted addresses and waiting for acknowledgement (minimum 24h):

```bash
DEPLOYER_KEY=0x... REGISTRAR_KEY=0x... ATTESTOR_KEY=0x... TREASURY_KEY=0x... \
AGENT_SALT=asp-v1 \
CEREMONY_CONFIRMED=1 \
npx hardhat run scripts/ceremony.ts --network base
```

The script deploys in this order:

1. `ProtocolToken` (CREATE2)
2. `Treasury` (CREATE2)
3. `EvaluatorRegistry` (CREATE2, constructor arg: ProtocolToken address)
4. `AgentJobManager` (regular deploy — depends on Registry + Treasury addresses)
5. `ReputationBridge` (CREATE2)

After each deployment the script verifies the deployed address matches the prediction. If any address mismatches, the script aborts.

### Step 3 — Wire contracts (governance proposals)

The script automatically submits the governance proposals:

- `EvaluatorRegistry.proposeJobManager(AgentJobManager)`
- `AgentJobManager.proposeReputationBridge(ReputationBridge)`
- `ReputationBridge.setJobManager(AgentJobManager)`

The first two proposals are subject to a **2-day `GOVERNANCE_DELAY`**. Note the `executableAt` timestamps logged by the script.

### Step 4 — Role transfers (one tx per role)

The script transfers ownership immediately after wiring:

| Contract | New owner | Role |
|---|---|---|
| `EvaluatorRegistry` | `REGISTRAR_KEY` | Registrar |
| `AgentJobManager` | `ATTESTOR_KEY` | Attestor |
| `Treasury` | `TREASURY_KEY` | Treasury EOA |
| `ProtocolToken` | Deployer (retained) | Until Governor is deployed |

**Each transfer is a separate transaction.** After each one, verify the new owner on Basescan before proceeding:

```
https://basescan.org/address/<CONTRACT_ADDRESS>#readContract → owner()
```

`ProtocolToken` ownership stays with the Deployer until an OpenZeppelin Governor contract is deployed and verified. This is a known limitation of the current deployment — it will be resolved in the governance milestone.

### Step 5 — Execute governance (after 2-day delay)

Two days after the ceremony, run:

```bash
ATTESTOR_KEY=0x... REGISTRAR_KEY=0x... \
npx hardhat run scripts/executeGovernance.ts --network base
```

This executes the pending governance proposals:
- `EvaluatorRegistry.executeJobManager(AgentJobManager)`
- `AgentJobManager.executeReputationBridge(ReputationBridge)`

### Step 6 — Post-ceremony checklist

- [ ] Verify all 5 contracts on Basescan (`npx hardhat verify --network base <address> [args]`)
- [ ] Confirm `owner()` on each contract returns the expected EOA
- [ ] Confirm `EvaluatorRegistry.jobManager()` returns `AgentJobManager`
- [ ] Confirm `AgentJobManager.reputationBridge()` returns `ReputationBridge`
- [ ] Whitelist the payment token (USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) via `AgentJobManager.allowToken()`
- [ ] Set initial `evaluationFee` via `proposeEvaluationFee()` / `executeEvaluationFee()` (recommended: 0.50 USDC = `500_000`)
- [ ] Publish the ceremony manifest (`deployments/base-ceremony.json`) publicly
- [ ] Post deployed addresses + tx hashes on the ERC-8183 forum thread

---

## Manifest

The ceremony script saves a `deployments/base-ceremony.json` manifest with all addresses, tx hashes, the salt used, and the role EOA addresses. This file is the canonical deployment record. Commit it to the repository.

---

## Security notes

- The `GOVERNANCE_DELAY` (2 days) means governance proposals cannot take effect before stakeholders have time to react. Even if the Attestor key is compromised, no parameter change takes effect for 48 hours.
- `evaluationFee` and `feeRate` are both timelocked. `allowToken` / `disallowToken` are not — they are maintenance operations, not financial parameters.
- If you detect a compromise during the ceremony, the safest recovery is to redeploy entirely with a new Deployer key and new salt. Do not attempt to patch a partially-transferred contract stack.
- `ProtocolToken` minting is permanently disabled after construction (no `mint()` function). Total supply is fixed at deployment.
