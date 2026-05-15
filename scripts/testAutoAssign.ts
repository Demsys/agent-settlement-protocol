/**
 * testAutoAssign.ts
 *
 * Smoke test for the auto-assign path:
 *   createJob(provider, address(0), MockUSDC, deadline)
 *   → setBudget → fund
 *   → EvaluatorRegistry.assignEvaluator fires → evaluator drawn from pool
 *
 * Prerequisites:
 *   - executeGovernance.ts completed (EvaluatorRegistry.jobManager set)
 *   - ThoughtProof (0x118B…c0C2) and pablocactus (0x35ee…d7BC) staked and past warmup
 *   - Deployer holds enough MockUSDC (budget amount)
 *
 * Usage:
 *   npx hardhat run scripts/testAutoAssign.ts --network base-sepolia
 */

import { ethers } from 'hardhat'
import * as fs from 'fs'
import * as path from 'path'

// ThoughtProof wallet — used as provider so deployer (client) ≠ provider.
// ThoughtProof is also an evaluator, so the registry will skip them during
// the draw and assign pablocactus (or another eligible evaluator).
const PROVIDER = '0x118B1E5A47658D20046bC874cB34E469d472c0C2'

const BUDGET     = ethers.parseUnits('1', 6)   // 1 USDC (6 decimals)
const DEADLINE   = Math.floor(Date.now() / 1000) + 5 * 24 * 60 * 60  // 5 days from now

async function main() {
  const [deployer] = await ethers.getSigners()
  const manifestPath = path.resolve(__dirname, '..', 'deployments', 'base-sepolia.json')
  const manifest     = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

  const usdc     = await ethers.getContractAt('MockUSDC',          manifest.contracts.MockUSDC.address,          deployer)
  const manager  = await ethers.getContractAt('AgentJobManager',   manifest.contracts.AgentJobManager.address,   deployer)
  const registry = await ethers.getContractAt('EvaluatorRegistry', manifest.contracts.EvaluatorRegistry.address, deployer)

  console.log('\n=== Auto-assign smoke test ===')
  console.log(`  Client    : ${deployer.address}`)
  console.log(`  Provider  : ${PROVIDER}`)
  console.log(`  JobManager: ${manifest.contracts.AgentJobManager.address}`)
  console.log(`  Registry  : ${manifest.contracts.EvaluatorRegistry.address}`)

  // ── Pre-flight checks ──────────────────────────────────────────────────────
  const currentJobManager = await registry.jobManager()
  if (currentJobManager.toLowerCase() !== manifest.contracts.AgentJobManager.address.toLowerCase()) {
    throw new Error(
      `EvaluatorRegistry.jobManager = ${currentJobManager}\n` +
      `Expected ${manifest.contracts.AgentJobManager.address}. Run scripts/executeGovernance.ts first.`
    )
  }
  console.log(`\n  ✓ EvaluatorRegistry.jobManager wired`)
  console.log(`  ✓ AgentJobManager.reputationBridge = ${await manager.reputationBridge()}`)

  const evaluatorCount = await registry.getEvaluatorCount()
  console.log(`  ✓ Evaluators in pool: ${evaluatorCount}`)
  if (evaluatorCount < 1n) throw new Error('No eligible evaluators in pool.')

  const usdcAllowed = await manager.allowedTokens(manifest.contracts.MockUSDC.address)
  if (!usdcAllowed) throw new Error(`MockUSDC (${manifest.contracts.MockUSDC.address}) is not in allowedTokens`)
  console.log(`  ✓ MockUSDC whitelisted`)

  const balance = await usdc.balanceOf(deployer.address)
  console.log(`  Deployer USDC balance: ${ethers.formatUnits(balance, 6)} USDC`)
  if (balance < BUDGET) throw new Error(`Insufficient USDC: need ${ethers.formatUnits(BUDGET, 6)}, have ${ethers.formatUnits(balance, 6)}`)

  // Nonce helper — avoids "replacement transaction underpriced" when sending
  // sequential txs on Base Sepolia (RPC doesn't always flush pending nonce immediately).
  let nonce = await ethers.provider.getTransactionCount(deployer.address, 'pending')
  const nextNonce = () => nonce++

  // ── Step 1: createJob ─────────────────────────────────────────────────────
  // provider = ThoughtProof (≠ deployer/client), evaluator = address(0) for auto-assign
  console.log('\n  Step 1 — createJob…')
  const createTx = await manager.createJob(
    PROVIDER,                            // provider
    ethers.ZeroAddress,                  // evaluator = 0 → auto-assign in fund()
    manifest.contracts.MockUSDC.address, // token
    BigInt(DEADLINE),                    // deadline (uint64)
    { nonce: nextNonce() }
  )
  const createRec = await createTx.wait(1)
  console.log(`  ✓ createJob tx: ${createTx.hash}`)

  // Parse JobCreated to get jobId
  const jobCreatedAbi   = ['event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, address token, uint64 deadline)']
  const jobCreatedIface = new ethers.Interface(jobCreatedAbi)
  let jobId: bigint | undefined
  for (const log of createRec?.logs ?? []) {
    try {
      const parsed = jobCreatedIface.parseLog({ topics: log.topics as string[], data: log.data })
      if (parsed?.name === 'JobCreated') { jobId = parsed.args.jobId; break }
    } catch { /* skip */ }
  }
  if (jobId === undefined) throw new Error('JobCreated event not found in receipt')
  console.log(`  ✓ Job ID: ${jobId}`)

  // ── Step 2: setBudget ─────────────────────────────────────────────────────
  console.log('\n  Step 2 — setBudget…')
  const budgetTx = await manager.setBudget(jobId, BUDGET, { nonce: nextNonce() })
  await budgetTx.wait(1)
  console.log(`  ✓ setBudget tx: ${budgetTx.hash}  (budget = ${ethers.formatUnits(BUDGET, 6)} USDC)`)

  // ── Step 3: approve + fund ────────────────────────────────────────────────
  console.log('\n  Step 3 — USDC approve + fund…')
  const approveTx = await usdc.approve(manifest.contracts.AgentJobManager.address, BUDGET, { nonce: nextNonce() })
  await approveTx.wait(1)
  console.log(`  ✓ USDC approved`)

  const fundTx  = await manager.fund(jobId, BUDGET, { nonce: nextNonce() })
  const fundRec = await fundTx.wait(1)
  console.log(`  ✓ fund() tx: ${fundTx.hash}`)

  // ── Parse EvaluatorAssigned event ─────────────────────────────────────────
  const assignedAbi   = ['event EvaluatorAssigned(uint256 indexed jobId, address indexed evaluator)']
  const assignedIface = new ethers.Interface(assignedAbi)
  let assignedEvaluator: string | undefined
  for (const log of fundRec?.logs ?? []) {
    try {
      const parsed = assignedIface.parseLog({ topics: log.topics as string[], data: log.data })
      if (parsed?.name === 'EvaluatorAssigned') { assignedEvaluator = parsed.args.evaluator; break }
    } catch { /* skip */ }
  }

  if (assignedEvaluator) {
    console.log(`\n  ✓ AUTO-ASSIGN SUCCESS — evaluator drawn: ${assignedEvaluator}`)
  } else {
    console.log('\n  ⚠  EvaluatorAssigned event not found in fund() logs')
    console.log(`     Total logs in receipt: ${fundRec?.logs.length}`)
  }

  // ── Final state ────────────────────────────────────────────────────────────
  // Job struct: client[0] provider[1] evaluator[2] token[3] budget[4]
  //             deadline[5] createdAt[6] submittedAt[7] status[8] deliverable[9] reason[10]
  const job     = await manager.getJob(jobId) as unknown as unknown[]
  const status  = job[8] as bigint   // JobStatus enum: 0=Open 1=Funded ...
  const evalAddr = job[2] as string
  console.log(`\n  Final job state : ${status}  (expected: 1 = Funded)`)
  console.log(`  Evaluator on job: ${evalAddr}`)
  console.log('\n=== Auto-assign smoke test complete ===\n')
}

main().catch((err: unknown) => {
  console.error('\n  FATAL:', err)
  process.exitCode = 1
})
