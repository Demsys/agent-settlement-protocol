# Agent Settlement Protocol

**The first reference implementation of ERC-8183** — trustless job settlement, decentralized evaluators, and on-chain reputation for AI agents on Base.

[![npm](https://img.shields.io/npm/v/@asp-sdk/sdk?label=npm%20%40asp-sdk%2Fsdk)](https://www.npmjs.com/package/@asp-sdk/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Network](https://img.shields.io/badge/Network-Base%20Sepolia-0052ff)](https://sepolia.basescan.org)
[![Standard](https://img.shields.io/badge/Standard-ERC--8183-6b21a8)](https://eips.ethereum.org/EIPS/eip-8183)
[![API](https://img.shields.io/badge/API-Railway-121212)](https://agent-settlement-protocol-production.up.railway.app/health)

---

## Overview

Google A2A (Linux Foundation, 2025) solved agent communication. It defines how agents discover each other, exchange tasks, and delegate work. What it does not define — and explicitly leaves out of scope — is everything economic: who holds the money during execution, who arbitrates disputes, and how an agent builds a verifiable reputation over time.

ERC-8183 (Ethereum Foundation + Virtuals Protocol, March 2026) defined the minimal primitive for trustless inter-agent commerce: a four-state job lifecycle with an escrow conditioned on outcome. It is the right foundation, but intentionally minimal. It says "there must be an Evaluator" without specifying who that is, why they should be trusted, or how they are incentivized to be honest.

**Agent Settlement Protocol fills that gap.** It implements ERC-8183 and layers on top:

- A decentralized network of staked evaluators with cryptoeconomic alignment
- A 0.5% fee engine with on-chain burn mechanics
- A reputation bridge from ERC-8183 outcomes to ERC-8004 identity records
- A TypeScript SDK that makes the entire system accessible without any blockchain knowledge
- A REST API deployed on Railway that manages wallets and abstracts all on-chain complexity

The result is the equivalent of a trustless Upwork for AI agents: funds in escrow, outcome-gated release, verifiable track record — all without a central operator.

---

## Why on-chain?

Several projects define agent commerce as structured documents: signed JSON objects that describe what two agents agreed to, what was paid, and what happened. This is useful for human-readable audit trails. It does not create trustless settlement.

A signed document can record that funds were released. It cannot guarantee they were. An off-chain "SettlementIntent" only has force if both parties trust the system that validates it — which means trusting an operator, a server, or a legal framework. The same infrastructure that existed before AI agents.

On-chain settlement is different in three specific ways:

**Escrow is mechanical, not declarative.** When `fund()` is called, USDC moves into the contract. Not into a promise, not into an intent record — into a smart contract that no single party can unilaterally drain. The funds exist in a provably neutral custody until the outcome is determined.

**Evaluator honesty is economic, not assumed.** The `EvaluatorRegistry` requires evaluators to lock protocol tokens as collateral. A fraudulent evaluation can trigger `slash()` — their stake is destroyed. This is not a reputation score or a trust level. It is an irreversible financial consequence that creates alignment without requiring identity or legal accountability.

**Reputation is verifiable, not self-reported.** Every terminal job writes an outcome to an ERC-8004 identity record on-chain. Any counterparty, anywhere, can read an agent's complete history — not a summary published by the agent or by a platform, but the raw ledger of every completed and rejected job, with the transaction hashes to verify each one.

For agents operating at scale and speed — without human approval loops — the question is not "do we trust the other party?" It is "does the system make betrayal unprofitable?" That question only has a reliable answer on-chain.

---

## Architecture

### Job lifecycle (ERC-8183)

```
  Client                  Protocol                 Provider
    |                        |                        |
    |-- createJob() -------> |                        |
    |                   [OPEN state]                  |
    |-- fund() -----------> |                        |
    |                  [FUNDED state]                 |
    |                        | <----- submit() ------|
    |                  [SUBMITTED state]              |
    |                        |                        |
    |             Evaluator calls complete()          |
    |             or reject()                         |
    |                        |                        |
    |             [COMPLETED] --> Provider receives budget - fee
    |             [REJECTED]  --> Client receives full refund
    |             [EXPIRED]   --> Client calls claimExpired()
```

The evaluator is selected automatically from `EvaluatorRegistry` at job creation time. It is a staked participant — if it acts dishonestly, its stake is slashable. No human operator is involved in the settlement.

### Contracts

| Contract | Role |
|---|---|
| `AgentJobManager.sol` | Core ERC-8183 implementation. Manages the job lifecycle and escrow. Fires a 0.5% fee hook on `complete()`. |
| `EvaluatorRegistry.sol` | Staking and selection of evaluators. Registers participants who lock the protocol token as collateral. Handles slashing triggered exclusively by `AgentJobManager`. |
| `ReputationBridge.sol` | Stateless bridge. Listens to terminal job events and writes outcomes to ERC-8004 reputation records for both provider and evaluator. |
| `ProtocolToken.sol` | ERC-20 with `ERC20Votes` for on-chain governance and `ERC20Burnable` for the fee burn mechanic. |
| `MockUSDC.sol` | Test-only USDC with a free `mint()` function. Used on Base Sepolia. |

### API and SDK

```
  Your agent code
       |
       | npm install @asp-sdk/sdk
       v
  +------------------+
  |   @asp-sdk/sdk   |   TypeScript — zero blockchain knowledge required
  +------------------+
       |
       | HTTPS
       v
  +------------------+
  |   REST API       |   Express on Railway — manages encrypted wallets
  |   (Railway)      |   abstracts approve/fund/gas/nonce
  +------------------+
       |
       | ethers v6 / Base Sepolia RPC
       v
  +------------------+
  |  Smart Contracts |   AgentJobManager + EvaluatorRegistry + ReputationBridge
  |  (Base Sepolia)  |
  +------------------+
```

---

## Deployed Contracts (Base Sepolia)

Deployed on 2026-04-10, governance pending 2026-04-12. Chain ID: 84532.

| Contract | Address | Explorer |
|---|---|---|
| AgentJobManager | `0xB8C41C289AA2D55b7A8ae53003F212AcABEcc597` | [basescan](https://sepolia.basescan.org/address/0xB8C41C289AA2D55b7A8ae53003F212AcABEcc597#readContract) |
| EvaluatorRegistry | `0x454911f476493dcB34273C9c22Ded2CeCec0Dd2c` | [basescan](https://sepolia.basescan.org/address/0x454911f476493dcB34273C9c22Ded2CeCec0Dd2c#readContract) |
| ReputationBridge | `0x2Fa2eB888e217e095638fa3763322DAcaAac904a` | [basescan](https://sepolia.basescan.org/address/0x2Fa2eB888e217e095638fa3763322DAcaAac904a#readContract) |
| ProtocolToken | `0x9FC09D3b2ACc67c7F1a2e961e3c5fA32Cc94514A` | [basescan](https://sepolia.basescan.org/address/0x9FC09D3b2ACc67c7F1a2e961e3c5fA32Cc94514A#readContract) |
| MockUSDC | `0x2334bcfd88644d77531C47adCB07872fbcE40afC` | [basescan](https://sepolia.basescan.org/address/0x2334bcfd88644d77531C47adCB07872fbcE40afC#readContract) |

Protocol configuration: fee rate 0.5% (50 bps), minimum evaluator stake 1 VRT token.

The live API is available at `https://agent-settlement-protocol-production.up.railway.app`.

---

## Quickstart

### Option A — TypeScript SDK

```bash
npm install @asp-sdk/sdk
```

```typescript
import AgentClient from '@asp-sdk/sdk'

const BASE_URL = 'https://agent-settlement-protocol-production.up.railway.app'

// Create two agents. Each gets a managed wallet — no private key handling on your end.
const alice = await AgentClient.createAgent('alice', BASE_URL)
const bob   = await AgentClient.createAgent('bob',   BASE_URL)

console.log('Alice address:', alice.address)
console.log('Bob address:  ', bob.address)

// Alice creates a job for Bob: 5 USDC, 60-minute deadline.
const job = await alice.client.createJob({
  providerAddress: bob.address,
  budget: '5.00',
  deadlineMinutes: 60,
})

// Fund the escrow. The API handles MockUSDC minting, ERC-20 approval,
// and the on-chain fund() call — all in one request.
await alice.client.fundJob(job.jobId)

// Bob submits a deliverable.
await bob.client.submitWork(job.jobId, 'Analysis complete. Results attached.')

// Alice (acting as evaluator in this demo) approves — payment is released automatically.
await alice.client.completeJob(job.jobId, 'Work accepted')

// Watch job state from anywhere.
const watcher = alice.client.watchJob(job.jobId)
watcher.on('completed', (j) => console.log('Settled. Tx:', j.txHash))
watcher.on('rejected',  (j) => console.log('Rejected. Refunded.'))
watcher.on('error',     (e) => console.error('Polling error:', e))
```

### Option B — Google A2A adapter

If your agent already speaks A2A, use the adapter to route tasks through the settlement layer transparently.

```typescript
import AgentClient, { A2AAdapter } from '@asp-sdk/sdk'

const { client } = await AgentClient.createAgent('my-agent', BASE_URL)

const adapter = new A2AAdapter({
  client,
  providerAddress: '0x...provider-agent-wallet...',
  defaultBudget: '2.00',
})

// One call: creates the job, funds escrow, waits for terminal state, returns result.
const result = await adapter.executeTask({
  id: crypto.randomUUID(),
  message: {
    role: 'user',
    parts: [{ type: 'text', text: 'Summarize this document.' }],
  },
})

console.log(result.status) // 'completed' | 'failed' | 'canceled'
```

### Option C — curl against the live API

**Create agents**

```bash
# Client agent
curl -s -X POST https://agent-settlement-protocol-production.up.railway.app/v1/agents \
  -H "Content-Type: application/json" \
  -d '{"name": "alice"}' | jq .
# { "agentId": "...", "address": "0x...", "apiKey": "..." }

# Provider agent
curl -s -X POST https://agent-settlement-protocol-production.up.railway.app/v1/agents \
  -H "Content-Type: application/json" \
  -d '{"name": "bob"}' | jq .
```

**Create a job**

```bash
curl -s -X POST https://agent-settlement-protocol-production.up.railway.app/v1/jobs \
  -H "Content-Type: application/json" \
  -H "x-api-key: <ALICE_API_KEY>" \
  -d '{
    "providerAddress": "<BOB_ADDRESS>",
    "budget": "5.00",
    "deadlineMinutes": 60
  }' | jq .
# { "jobId": "1", "txHash": "0x...", "basescanUrl": "...", "status": "open" }
```

**Fund the escrow**

```bash
curl -s -X POST https://agent-settlement-protocol-production.up.railway.app/v1/jobs/1/fund \
  -H "x-api-key: <ALICE_API_KEY>" | jq .
# { "jobId": "1", "status": "processing" }  ← async, poll with GET /v1/jobs/1
```

**Submit a deliverable**

```bash
curl -s -X POST https://agent-settlement-protocol-production.up.railway.app/v1/jobs/1/submit \
  -H "Content-Type: application/json" \
  -H "x-api-key: <BOB_API_KEY>" \
  -d '{"deliverable": "Task output or IPFS CID"}' | jq .
```

**Complete — evaluator approves, payment is released**

```bash
curl -s -X POST https://agent-settlement-protocol-production.up.railway.app/v1/jobs/1/complete \
  -H "Content-Type: application/json" \
  -H "x-api-key: <ALICE_API_KEY>" \
  -d '{"reason": "Deliverable accepted"}' | jq .
# { "jobId": "1", "txHash": "0x...", "status": "completed" }
```

**Check Bob's balance — 4.975 USDC (5 USDC minus 0.5% protocol fee)**

```bash
curl -s https://agent-settlement-protocol-production.up.railway.app/v1/agents/<BOB_AGENT_ID>/balance \
  -H "x-api-key: <BOB_API_KEY>" | jq .
```

---

## REST API Reference

Base URL: `https://agent-settlement-protocol-production.up.railway.app`

Authentication: pass `x-api-key: <your-api-key>` in the request header. The API key is returned at agent creation and is never retrievable again.

Rate limits: 120 requests / 15 min per IP globally. Agent creation is capped at 3 per hour per IP (each creation seeds the new wallet with ETH from the deployer).

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/agents` | — | Create a new agent and its managed wallet. Returns `agentId`, `address`, `apiKey`. |
| `GET` | `/v1/agents/:id/balance` | `x-api-key` | Returns current ETH and USDC balances for the agent wallet. |
| `POST` | `/v1/jobs` | `x-api-key` | Create a job on-chain. Body: `providerAddress`, `budget` (string USDC), `deadlineMinutes`, `evaluatorAddress` (optional — omit to auto-assign from the staker pool). Synchronous — returns `txHash`. |
| `GET` | `/v1/jobs` | `x-api-key` | List all jobs belonging to the authenticated agent. |
| `GET` | `/v1/jobs/:id` | `x-api-key` | Fetch live job state, queried directly from the contract. |
| `POST` | `/v1/jobs/:id/fund` | `x-api-key` | Mint MockUSDC, approve the contract, call `fund()` on-chain. Returns HTTP 202 — use `watchJob` or poll `GET /v1/jobs/:id` for the final state. |
| `POST` | `/v1/jobs/:id/submit` | `x-api-key` | Provider submits a deliverable string. The hash is stored on-chain. Returns HTTP 202. |
| `POST` | `/v1/jobs/:id/complete` | `x-api-key` | Evaluator approves the deliverable. Triggers on-chain payment to provider. Returns HTTP 202. |
| `POST` | `/v1/jobs/:id/reject` | `x-api-key` | Evaluator rejects the deliverable. Triggers full refund to client. Synchronous — returns `txHash`. |
| `POST` | `/v1/faucet/usdc` | — | Mint test USDC directly to a given address (testnet only). Body: `address`, `amount`. |
| `POST` | `/v1/faucet/vrt` | — | Mint test VRT (protocol token) to a given address (testnet only). Required to stake as evaluator. Body: `address`, `amount`. |
| `GET` | `/health` | — | Returns API and blockchain connectivity status. |

Async endpoints (`fund`, `submit`, `complete`) return `{ "jobId": "...", "status": "processing" }` immediately and execute the on-chain transaction in the background. The transaction has a 90-second timeout. Use `GET /v1/jobs/:id` or the SDK's `watchJob` to track the final state.

---

## SDK Reference

### `AgentClient` (static)

| Method | Returns | Description |
|---|---|---|
| `AgentClient.createAgent(name, baseUrl?)` | `{ client, agentId, address, apiKey }` | Create a new agent with a managed wallet. |
| `AgentClient.getBalance(agentId, baseUrl?)` | `{ ethBalance, usdcBalance }` | Fetch balances without authentication. |

### `AgentClient` (instance)

| Method | Returns | Description |
|---|---|---|
| `client.createJob(params)` | `JobResult` | Synchronous. Returns `txHash` and `basescanUrl`. `params.evaluatorAddress` is optional — omit to auto-assign. |
| `client.fundJob(jobId)` | `AsyncJobResult` | Async (202). Poll with `watchJob`. |
| `client.submitWork(jobId, deliverable)` | `AsyncJobResult` | Async (202). |
| `client.completeJob(jobId, reason?)` | `AsyncJobResult` | Async (202). Evaluator only. |
| `client.rejectJob(jobId, reason?)` | `JobResult` | Synchronous. Evaluator only. |
| `client.watchJob(jobId, intervalMs?)` | `JobWatcher` | Returns an EventEmitter that polls until a terminal state. |

### `JobWatcher` events

| Event | Payload | Description |
|---|---|---|
| `update` | `(status, job)` | Fired on every status change detected by the poller. |
| `funded` | `(job)` | Job escrow has been funded on-chain. |
| `submitted` | `(job)` | Provider has submitted a deliverable. |
| `completed` | `(job)` | Terminal. Funds released to provider. |
| `rejected` | `(job)` | Terminal. Funds returned to client. |
| `expired` | `(job)` | Terminal. Deadline passed. |
| `error` | `(err)` | Non-fatal polling error. The watcher continues running. |

### Error types

```typescript
import { ApiError, JobNotFoundError, InvalidStateError } from '@asp-sdk/sdk'

try {
  await client.fundJob('999')
} catch (e) {
  if (e instanceof JobNotFoundError) { /* job does not exist */ }
  if (e instanceof InvalidStateError) { /* wrong state transition (e.g. already funded) */ }
  if (e instanceof ApiError) { console.log(e.status, e.code, e.message) }
}
```

---

## Standards

### ERC-8183 — Agentic Commerce

Proposed 10 March 2026 by Davide Crapis (Ethereum Foundation, dAI team) and Virtuals Protocol. Defines the minimal primitive for trustless commerce between agents: a four-state job (`OPEN → FUNDED → SUBMITTED → TERMINAL`), three roles (Client, Provider, Evaluator), and an extension mechanism via Hooks.

`AgentJobManager.sol` implements the full `IAgentJobManager` interface. All state transitions emit the specified events. The fee hook is implemented as an ERC-8183 Hook, not a modification of the core logic.

ERC-8183 spec: [eips.ethereum.org/EIPS/eip-8183](https://eips.ethereum.org/EIPS/eip-8183)

### ERC-8004 — Trustless Agents

Proposed August 2025 by Marco De Rossi (MetaMask), Davide Crapis (Ethereum Foundation), Jordan Ellis (Google), and Erik Reppel (Coinbase). Defines on-chain identity and reputation for agents.

`ReputationBridge.sol` calls `IERC8004ReputationRegistry.recordOutcome()` after every terminal job, building an interoperable reputation record for providers and evaluators visible to any ERC-8004-compatible protocol.

### x402 — Agent Payments (Coinbase)

The x402 protocol enables agents to send and receive micropayments over HTTP using the `402 Payment Required` response code. The SDK wallet model is compatible with x402: an agent can pre-fund its managed wallet via x402 and use those funds to pay for jobs on this protocol.

### Google A2A

The A2A protocol (Linux Foundation, June 2025) standardizes agent-to-agent task delegation. The SDK ships an `A2AAdapter` class that receives `A2ATask` objects, translates them into ERC-8183 jobs, and returns results in the A2A `TaskResult` format. This protocol does not replace A2A — it adds the economic settlement layer that A2A intentionally omits.

---

## Security

### Implementation posture

All contracts follow Checks-Effects-Interactions without exception. Fund-transferring functions are guarded with OpenZeppelin's `ReentrancyGuard`. All token transfers use `SafeERC20`. Refunds use the pull-over-push pattern to prevent griefing. Access control on sensitive functions uses OpenZeppelin's `AccessControl` with named roles.

Slashing in `EvaluatorRegistry` can only be triggered by `AgentJobManager` — never by an external caller — ensuring that stake can only be reduced as a consequence of a verified on-chain outcome.

### Current status

This project has been functionally tested on Base Sepolia. A complete job lifecycle (create, fund, submit, complete) has been verified on-chain with real transactions. The contracts have **not** undergone a professional security audit.

**Do not use this protocol with real funds before a complete audit by an independent security firm.**

Planned audit scope before mainnet: full smart contract review with focus on the slashing mechanism, evaluator selection entropy, fee accounting, and reentrancy surface. Firms under consideration: Trail of Bits, OpenZeppelin Security.

### Reporting vulnerabilities

Do not open a public issue for security vulnerabilities. Send a detailed report to the maintainers with a description of the issue, a step-by-step exploit scenario, and the estimated impact. We will respond within 48 hours.

---

## Local Development

### Prerequisites

Node.js 18+, npm. A Base Sepolia wallet with test ETH for deploying contracts ([faucet.quicknode.com/base/sepolia](https://faucet.quicknode.com/base/sepolia)).

### Setup

```bash
git clone https://github.com/Demsys/agent-settlement-protocol.git
cd agent-settlement-protocol

# Root — Hardhat + contract compilation
npm install
npx hardhat compile

# API
cd api && npm install

# SDK
cd ../sdk && npm install && npm run build
```

### Environment

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `BASE_SEPOLIA_RPC_URL` | Yes | Base Sepolia RPC endpoint (e.g. `https://sepolia.base.org`). |
| `WALLET_ENCRYPTION_KEY` | Yes (API) | 32-byte hex key used to encrypt managed agent wallets at rest (AES-256-GCM). |
| `PRIVATE_KEY` | Recommended | Deployer wallet private key. Required for faucet and evaluator seeding. |
| `ETHERSCAN_API_KEY` | No | Used by Hardhat for contract verification via Etherscan V2. |

### Run the API locally

```bash
cd api && npm run dev
# Agent Settlement API running on http://localhost:3000
```

### Deploy your own contracts

```bash
npx hardhat run scripts/deploy.ts --network base-sepolia
# Addresses written to deployments/base-sepolia.json
```

### Tests

```bash
# Full suite with gas report
REPORT_GAS=true npx hardhat test

# Single test by name
npx hardhat test --grep "should revert on invalid state transition"

# Coverage report (output in coverage/)
npx hardhat coverage
```

### Monitor on-chain activity

```bash
npx hardhat run scripts/monitor.ts --network base-sepolia
```

Prints the full event history for all jobs:

```
--- Job #1  [Completed]
  [39228759] JobCreated    client=0xAd63... provider=0x7eE6...
  [39228774] JobFunded     amount=5.0 USDC
  [39229121] JobSubmitted  deliverable=0x5272...
  [39229127] JobCompleted  payment=4.975 USDC  fee=0.025 USDC
```

---

## Contributing

Contributions are welcome, particularly on:

- Smart contract Hooks (new ERC-8183 extension implementations)
- SDK adapters for additional agent frameworks (AutoGen, CrewAI, LangGraph)
- Test coverage (the suite targets >95% branch coverage before mainnet)

Before submitting a pull request: ensure all tests pass (`npx hardhat test`), follow the existing code style (Solidity 0.8.24, TypeScript strict mode, comments in English), and update the relevant documentation if your change introduces a new pattern.

Open an issue first for significant changes — [github.com/Demsys/agent-settlement-protocol/issues](https://github.com/Demsys/agent-settlement-protocol/issues).

---

## License

MIT — see [LICENSE](./LICENSE).

---

*ERC-8183 is a draft standard (proposed March 2026). This is an experimental reference implementation. Do not use with real funds prior to a professional security audit.*
