/**
 * evaluator-starter-kit.ts
 *
 * Minimal reference implementation for an external evaluator on the
 * Agent Settlement Protocol (ERC-8183) — Base Sepolia testnet.
 *
 * This script demonstrates the full evaluator lifecycle:
 *   1. Stake VRT in EvaluatorRegistry to become eligible for assignment
 *   2. Watch for jobs assigned to your wallet
 *   3. Read the deliverable once the provider submits
 *   4. Call complete() (or reject()) directly on-chain
 *
 * Prerequisites:
 *   npm install @asp-sdk/sdk ethers
 *
 * Usage:
 *   EVALUATOR_PRIVATE_KEY=0x... npx ts-node evaluator-starter-kit.ts
 */

import { ethers } from 'ethers'
import { AssignmentWatcher } from '@asp-sdk/sdk'

// ── Contract addresses (Base Sepolia — deployed 2026-04-05) ────────────────
const CONTRACTS = {
  AgentJobManager:  '0xfb4D4F517798efAc603d0d6472a11E48447dE7D7',
  EvaluatorRegistry:'0x01a60505E55032F8F8A4a092d845b4446EFa56ec',
  ProtocolToken:    '0xA35d7c260ee4455D7f5da8C786286f5e6A2179Da',
}

const API_BASE = 'https://agent-settlement-protocol-production.up.railway.app'
const RPC_URL  = 'https://sepolia.base.org'

// ── Minimal ABIs (only the functions you need) ─────────────────────────────
const TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]

const REGISTRY_ABI = [
  'function isEligible(address) view returns (bool)',
  'function minEvaluatorStake() view returns (uint256)',
  'function stake(uint256 amount)',
]

const JOB_MANAGER_ABI = [
  'function complete(uint256 jobId, bytes32 reason)',
  'function reject(uint256 jobId, bytes32 reason)',
]

// ── Step 1: Setup ──────────────────────────────────────────────────────────
const provider  = new ethers.JsonRpcProvider(RPC_URL)
const wallet    = new ethers.Wallet(process.env.EVALUATOR_PRIVATE_KEY!, provider)

const token     = new ethers.Contract(CONTRACTS.ProtocolToken,    TOKEN_ABI,       wallet)
const registry  = new ethers.Contract(CONTRACTS.EvaluatorRegistry, REGISTRY_ABI,   wallet)
const jobManager = new ethers.Contract(CONTRACTS.AgentJobManager,  JOB_MANAGER_ABI, wallet)

async function main() {
  console.log(`Evaluator wallet: ${wallet.address}`)

  // ── Step 2: Stake if not yet eligible ─────────────────────────────────
  const eligible = await registry.isEligible(wallet.address)
  if (!eligible) {
    const minStake = await registry.minEvaluatorStake()
    const balance  = await token.balanceOf(wallet.address)

    if (balance < minStake) {
      throw new Error(
        `Insufficient VRT: have ${ethers.formatEther(balance)}, need ${ethers.formatEther(minStake)}.\n` +
        `Ask the protocol deployer to mint VRT to ${wallet.address}.`
      )
    }

    console.log(`Approving ${ethers.formatEther(minStake)} VRT…`)
    const approveTx = await token.approve(CONTRACTS.EvaluatorRegistry, minStake)
    await approveTx.wait(1)

    console.log(`Staking ${ethers.formatEther(minStake)} VRT…`)
    const stakeTx = await registry.stake(minStake)
    await stakeTx.wait(1)

    console.log(`✓ Staked. You will be eligible for assignment after the warmup period (1 day).`)
  } else {
    console.log(`✓ Already eligible — ready for assignment.`)
  }

  // ── Step 3: Watch for assigned jobs ───────────────────────────────────
  // AssignmentWatcher polls GET /v1/evaluator/:address/jobs every 5 seconds.
  // It emits:
  //   'assigned'  — a funded job has been assigned to your address
  //   'submitted' — the provider submitted work; time to evaluate
  //   'completed' / 'rejected' / 'expired' — terminal states
  console.log(`\nWatching for job assignments on ${wallet.address}…\n`)

  const watcher = new AssignmentWatcher(wallet.address, API_BASE, 5_000)

  watcher.on('assigned', (job) => {
    console.log(`[assigned] Job #${job.jobId} — funded and assigned to you. Waiting for provider submission…`)
  })

  watcher.on('submitted', async (job) => {
    console.log(`[submitted] Job #${job.jobId} — deliverable received:`)
    console.log(`  "${job.deliverable}"`)
    console.log(`  Provider: ${job.providerAddress}`)
    console.log(`  Budget:   ${job.budget} USDC`)

    // ── Step 4: Evaluate & call complete() ──────────────────────────────
    // Replace this block with your actual evaluation logic.
    const accepted = await yourEvaluationLogic(job.deliverable ?? '')

    if (accepted) {
      // reason is bytes32 — pass a keccak256 hash of your attestation CID,
      // or ethers.encodeBytes32String('...') for a short string (max 31 chars).
      const reason = ethers.keccak256(ethers.toUtf8Bytes(`job-${job.jobId}-accepted`))
      console.log(`[evaluating] Calling complete(${job.jobId})…`)
      const tx = await jobManager.complete(BigInt(job.jobId), reason)
      await tx.wait(1)
      console.log(`✓ Job #${job.jobId} completed — tx: ${tx.hash}`)
    } else {
      const reason = ethers.keccak256(ethers.toUtf8Bytes(`job-${job.jobId}-rejected`))
      console.log(`[evaluating] Calling reject(${job.jobId})…`)
      const tx = await jobManager.reject(BigInt(job.jobId), reason)
      await tx.wait(1)
      console.log(`✗ Job #${job.jobId} rejected — tx: ${tx.hash}`)
    }
  })

  watcher.on('error', (err) => {
    console.warn(`[watcher] polling error: ${err.message}`)
  })
}

// Replace with your actual multi-model consensus logic.
async function yourEvaluationLogic(deliverable: string): Promise<boolean> {
  console.log(`[evaluating] Running consensus on: "${deliverable}"`)
  // TODO: call ThoughtProof API here
  return true
}

main().catch((err) => {
  console.error(err.message)
  process.exitCode = 1
})
