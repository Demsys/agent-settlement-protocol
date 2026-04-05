/**
 * testJobWatcher.ts
 *
 * End-to-end test of the SDK JobWatcher using live Railway API.
 * Demonstrates the full ERC-8183 lifecycle driven by events.
 *
 * Usage:
 *   npx ts-node --esm scripts/testJobWatcher.ts
 *   (or: npx ts-node -e "require('./scripts/testJobWatcher.ts')")
 */

// Use local SDK build (avoids needing the npm package installed)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AgentClient } = require('../sdk/dist/index.js')

const BASE_URL = 'https://agent-settlement-protocol-production.up.railway.app'

// Replace with your own agent API keys (returned by POST /v1/agents)
const ALICE_API_KEY = process.env.ALICE_API_KEY ?? ''
const BOB_API_KEY   = process.env.BOB_API_KEY   ?? ''
const BOB_ADDRESS   = process.env.BOB_ADDRESS   ?? ''

async function main() {
  console.log('=== ASP SDK — JobWatcher end-to-end test ===\n')

  // Instantiate clients for Alice (client) and Bob (provider)
  const alice = new AgentClient({ apiKey: ALICE_API_KEY, baseUrl: BASE_URL })
  const bob   = new AgentClient({ apiKey: BOB_API_KEY,   baseUrl: BASE_URL })

  // ── Step 1: Create job ──────────────────────────────────────────────────
  console.log('1. Alice creates a job for Bob…')
  const job = await alice.createJob({
    providerAddress: BOB_ADDRESS,
    budget: '3',
    deadlineMinutes: 120,
  })
  console.log(`   ✓ Job #${job.jobId} — ${job.basescanUrl}\n`)

  // ── Step 2: Attach watcher BEFORE funding so we catch every transition ──
  console.log('2. Attaching JobWatcher…')
  const watcher = alice.watchJob(job.jobId, 4_000)

  const done = new Promise<void>((resolve, reject) => {
    watcher.on('update', (status: string) => {
      console.log(`   [watcher] status → ${status}`)
    })
    watcher.on('completed', (j: { jobId: string; txHash: string }) => {
      console.log(`\n✓ Job #${j.jobId} COMPLETED — tx: ${j.txHash}`)
      watcher.stop()
      resolve()
    })
    watcher.on('rejected', (j: { jobId: string }) => {
      console.error(`\n✗ Job #${j.jobId} REJECTED`)
      watcher.stop()
      reject(new Error('Job rejected'))
    })
    watcher.on('expired', (j: { jobId: string }) => {
      console.error(`\n✗ Job #${j.jobId} EXPIRED`)
      watcher.stop()
      reject(new Error('Job expired'))
    })
    watcher.on('error', (err: Error) => {
      console.warn(`   [watcher] polling error: ${err.message}`)
    })

    // Safety timeout — fail the test after 3 minutes
    setTimeout(() => {
      watcher.stop()
      reject(new Error('Test timed out after 3 minutes'))
    }, 3 * 60 * 1000)
  })

  // ── Step 3: Fund ────────────────────────────────────────────────────────
  console.log('3. Alice funds the job…')
  await alice.fundJob(job.jobId)
  console.log('   ✓ fund request sent (async — watcher will catch status change)\n')

  // Wait for funded before submitting
  await waitForStatus(ALICE_API_KEY, job.jobId, 'funded', 60_000)
  console.log('   ✓ on-chain funded confirmed\n')

  // ── Step 4: Bob submits deliverable ────────────────────────────────────
  console.log('4. Bob submits deliverable…')
  await bob.submitWork(job.jobId, 'Analysis complete: processed 1 200 records, anomaly rate 0.3%.')
  console.log('   ✓ submit request sent\n')

  await waitForStatus(ALICE_API_KEY, job.jobId, 'submitted', 60_000)
  console.log('   ✓ on-chain submitted confirmed\n')

  // ── Step 5: Evaluator completes the job ────────────────────────────────
  console.log('5. Alice (evaluator) completes the job…')
  await alice.completeJob(job.jobId, 'Deliverable reviewed and accepted.')
  console.log('   ✓ complete request sent\n')

  // ── Step 6: Wait for JobWatcher to fire 'completed' ────────────────────
  console.log('6. Waiting for JobWatcher completed event…')
  await done
}

/** Poll GET /v1/jobs/:id until the job reaches the expected status (or timeout). */
async function waitForStatus(
  apiKey: string,
  jobId: string,
  target: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/v1/jobs/${jobId}`, {
      headers: { 'x-api-key': apiKey },
    }).catch(() => null)
    if (res && res.ok) {
      const j = await res.json()
      if (j.status === target) return
    }
    await new Promise((r) => setTimeout(r, 4_000))
  }
  throw new Error(`Timed out waiting for job ${jobId} to reach status '${target}'`)
}

main().catch((e) => { console.error('\n✗', e.message); process.exitCode = 1 })
