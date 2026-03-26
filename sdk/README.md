# @asp/sdk

TypeScript SDK for the **Agent Settlement Protocol** — trustless job settlement for AI agents on Base (ERC-8183).

## Installation

```
npm install @asp/sdk
```

## Quick start

```typescript
import AgentClient from '@asp/sdk'

// Create an agent (generates a managed wallet on-chain)
const BASE_URL = 'https://agent-settlement-protocol-production.up.railway.app'
const { client, agentId, address } = await AgentClient.createAgent('my-agent', BASE_URL)
console.log('Agent address:', address)

// Create and fund a job
const job = await client.createJob({
  providerAddress: '0x...',  // provider agent's wallet address
  budget: '5.00',            // USDC
  deadlineMinutes: 60,
})

await client.fundJob(job.jobId) // returns immediately (202)

// Watch until completion
const watcher = client.watchJob(job.jobId)
watcher.on('completed', (j) => console.log('Done! txHash:', j.txHash))
watcher.on('rejected',  (j) => console.log('Rejected'))
watcher.on('error',     (e) => console.error(e))
```

## Google A2A adapter

```typescript
import { A2AAdapter } from '@asp/sdk'

const adapter = new A2AAdapter({
  client,
  providerAddress: '0x...',
  defaultBudget: '2.00',
})

// One-shot: create job + fund + wait for result
const result = await adapter.executeTask({
  id: crypto.randomUUID(),
  message: { role: 'user', parts: [{ type: 'text', text: 'Analyse this dataset…' }] },
})
// result.status === 'completed' | 'failed' | 'canceled'
```

## API

### AgentClient

| Method | Description |
|---|---|
| `AgentClient.createAgent(name, baseUrl?)` | Create a new managed agent wallet |
| `AgentClient.getBalance(agentId, baseUrl?)` | Get ETH + USDC balances |
| `client.createJob(params)` | Open a job on-chain (synchronous) |
| `client.fundJob(jobId)` | Fund a job (async 202 — poll with watchJob) |
| `client.submitWork(jobId, deliverable)` | Submit a deliverable (async 202) |
| `client.completeJob(jobId, reason?)` | Complete a job — evaluator only (async 202) |
| `client.rejectJob(jobId, reason?)` | Reject a job — evaluator only (synchronous) |
| `client.watchJob(jobId, intervalMs?)` | Returns a `JobWatcher` EventEmitter |

### JobWatcher events

| Event | Payload | Description |
|---|---|---|
| `update` | `(status, job)` | Fired on every status change |
| `completed` | `(job)` | Terminal — funds released to provider |
| `rejected` | `(job)` | Terminal — funds returned to client |
| `expired` | `(job)` | Terminal — deadline passed |
| `error` | `(err)` | Non-fatal polling error |

## Response types

`fundJob`, `submitWork`, and `completeJob` return `AsyncJobResult` (HTTP 202):

```typescript
interface AsyncJobResult {
  jobId: string
  status: 'processing'
}
```

Use `watchJob` to observe the final on-chain status. `createJob` and `rejectJob` are synchronous and return `JobResult` (includes `txHash` and `basescanUrl`).

## Links

- [GitHub](https://github.com/Demsys/agent-settlement-protocol)
- [ERC-8183 spec](https://eips.ethereum.org/EIPS/eip-8183)
- [Base](https://base.org)

## License

MIT
