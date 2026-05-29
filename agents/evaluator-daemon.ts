#!/usr/bin/env npx ts-node
/**
 * Evaluator Daemon — ERC-8183 Job Monitor
 *
 * Scans Base Sepolia for jobs assigned to watched evaluator addresses
 * that are in Submitted state and waiting for evaluation.
 *
 * Zero Claude API calls — purely on-chain reads via ethers.js.
 *
 * Usage:
 *   npm run agent:evaluator                  # check new jobs since last scan
 *   npm run agent:evaluator -- --all         # show all open Submitted jobs (rescan from deploy block)
 *   npm run agent:evaluator -- --job=5       # inspect a single job by ID
 */

import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { ethers } from 'ethers'

dotenv.config({ path: path.join(__dirname, '../.env') })

// ─── Config ───────────────────────────────────────────────────────────────────

const DEPLOYMENT_FILE = path.join(__dirname, '../deployments/base-sepolia.json')
const ABI_FILE        = path.join(__dirname, '../artifacts/contracts/core/AgentJobManager.sol/AgentJobManager.json')
const STATE_FILE      = path.join(__dirname, 'state/evaluator-state.json')

// Phase 2 deployment block (2026-05-16, Base Sepolia)
// Used only for --all scans. Normal mode and first run scan from lastScannedBlock.
const DEPLOY_BLOCK = 40_000_000

// Base Sepolia public RPC limits eth_getLogs to 2 000 blocks per request
const CHUNK_SIZE = 1_500

// Default scan window for first run (no state file): last 24 hours at ~2 sec/block
const BLOCKS_PER_DAY = 43_200
const DEFAULT_LOOKBACK_DAYS = 1

// Evaluator addresses we monitor. Add new evaluators here.
const WATCHED_EVALUATORS = new Set([
  '0x118B1E5A47658D20046bC874cB34E469d472c0C2', // ThoughtProof
  '0x35eeDdcbE5E1AE01396Cb93Fc8606cE4C713d7BC', // pablocactus
])

const BASESCAN = 'https://sepolia.basescan.org'

// ─── Types ────────────────────────────────────────────────────────────────────

enum JobStatus { Open, Funded, Submitted, Completed, Rejected, Expired }

interface EvaluatorState {
  lastScannedBlock: number
  lastChecked: string
}

interface JobAlert {
  jobId:       number
  evaluator:   string
  provider:    string
  token:       string
  budget:      bigint
  deadline:    number   // unix timestamp
  deliverable: string   // bytes32 hex
  urgency:     'critical' | 'high' | 'normal' | 'low'
}

// ─── State ────────────────────────────────────────────────────────────────────

function loadState(latestBlock: number): EvaluatorState {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
  }
  // First run: scan last 24 hours only, not from deploy block
  const lookback = Math.max(DEPLOY_BLOCK, latestBlock - BLOCKS_PER_DAY * DEFAULT_LOOKBACK_DAYS)
  return { lastScannedBlock: lookback, lastChecked: new Date().toISOString() }
}

function saveState(state: EvaluatorState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// ─── Chain helpers ────────────────────────────────────────────────────────────

function evaluatorLabel(address: string): string {
  const lower = address.toLowerCase()
  if (lower === '0x118b1e5a47658d20046bc874cb34e469d472c0c2') return 'ThoughtProof'
  if (lower === '0x35eeddcbe5e1ae01396cb93fc8606ce4c713d7bc') return 'pablocactus'
  return address.slice(0, 10) + '...'
}

function urgencyFromDeadline(deadline: number): JobAlert['urgency'] {
  const now    = Math.floor(Date.now() / 1000)
  const hoursLeft = (deadline - now) / 3600
  if (hoursLeft < 6)   return 'critical'
  if (hoursLeft < 24)  return 'high'
  if (hoursLeft < 168) return 'normal'   // 7 days
  return 'low'
}

function formatDeadline(deadline: number): string {
  const now      = Math.floor(Date.now() / 1000)
  const secsLeft = deadline - now
  if (secsLeft <= 0) return 'EXPIRED'
  const h = Math.floor(secsLeft / 3600)
  const m = Math.floor((secsLeft % 3600) / 60)
  if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h`
  return `${h}h ${m}m`
}

async function queryEventsInChunks(
  contract: ethers.Contract,
  filter: ethers.ContractEventName,
  fromBlock: number,
  toBlock: number
): Promise<ethers.EventLog[]> {
  const results: ethers.EventLog[] = []
  for (let from = fromBlock; from <= toBlock; from += CHUNK_SIZE) {
    const to    = Math.min(from + CHUNK_SIZE - 1, toBlock)
    const chunk = await (contract.queryFilter as Function)(filter, from, to)
    results.push(...chunk)
  }
  return results
}

// ─── Core scan ────────────────────────────────────────────────────────────────

async function scanJobs(
  contract: ethers.Contract,
  fromBlock: number,
  toBlock: number
): Promise<JobAlert[]> {
  const events = await queryEventsInChunks(
    contract,
    contract.filters.JobSubmitted(),
    fromBlock,
    toBlock
  )

  const alerts: JobAlert[] = []

  for (const ev of events) {
    const jobId = Number(ev.args[0])

    let job: any
    try {
      job = await contract.getJob(jobId)
    } catch {
      continue
    }

    const status    = Number(job.status)
    const evaluator = job.evaluator as string

    // Only alert if: still Submitted + evaluator is one of ours
    if (status !== JobStatus.Submitted) continue
    if (!WATCHED_EVALUATORS.has(evaluator)) continue

    const deadline = Number(job.deadline)
    alerts.push({
      jobId,
      evaluator,
      provider:    job.provider as string,
      token:       job.token as string,
      budget:      BigInt(job.budget),
      deadline,
      deliverable: job.deliverable as string,
      urgency:     urgencyFromDeadline(deadline),
    })
  }

  return alerts
}

// ─── Single-job inspection ────────────────────────────────────────────────────

async function inspectJob(contract: ethers.Contract, jobId: number): Promise<void> {
  const STATUS_LABEL = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired']

  let job: any
  try {
    job = await contract.getJob(jobId)
  } catch {
    console.error(`[evaluator-daemon] Job #${jobId} not found on-chain.`)
    process.exit(1)
  }

  const status   = Number(job.status)
  const deadline = Number(job.deadline)
  const budget   = ethers.formatUnits(job.budget, 6)

  console.log()
  console.log(`╔══════════════════════════════════════════════════════════════╗`)
  console.log(`║          ERC-8183 Evaluator Daemon — Job #${String(jobId).padEnd(19)}║`)
  console.log(`╚══════════════════════════════════════════════════════════════╝`)
  console.log()
  console.log(`  Status      : ${STATUS_LABEL[status]}`)
  console.log(`  Client      : ${job.client}`)
  console.log(`  Provider    : ${job.provider}`)
  console.log(`  Evaluator   : ${job.evaluator}  (${evaluatorLabel(job.evaluator)})`)
  console.log(`  Budget      : ${budget} USDC`)
  console.log(`  Deadline    : ${new Date(deadline * 1000).toISOString()}  (${formatDeadline(deadline)} remaining)`)
  console.log(`  Deliverable : ${job.deliverable}`)
  if (job.reason !== ethers.ZeroHash) {
    console.log(`  Reason      : ${job.reason}`)
  }
  console.log(`  Basescan    : ${BASESCAN}/address/${await contract.getAddress()}`)
  console.log()

  if (status === JobStatus.Submitted && WATCHED_EVALUATORS.has(job.evaluator)) {
    console.log(`  ACTION NEEDED — call complete() or reject() as ${evaluatorLabel(job.evaluator)}`)
    console.log()
  }
}

// ─── Output ───────────────────────────────────────────────────────────────────

const URGENCY_ICON: Record<JobAlert['urgency'], string> = {
  critical: '🔴',
  high:     '🟠',
  normal:   '🟡',
  low:      '⚪',
}

function printAlerts(alerts: JobAlert[]): void {
  console.log()
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║       ERC-8183 Evaluator Daemon — Jobs Awaiting Action       ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')

  if (alerts.length === 0) {
    console.log('\n  No jobs awaiting evaluation.\n')
    return
  }

  // Sort by deadline asc (most urgent first)
  alerts.sort((a, b) => a.deadline - b.deadline)

  console.log()
  for (const a of alerts) {
    const icon    = URGENCY_ICON[a.urgency]
    const budget  = ethers.formatUnits(a.budget, 6)
    const evLabel = evaluatorLabel(a.evaluator)
    console.log(`  ${icon}  Job #${a.jobId}  —  evaluator: ${evLabel}`)
    console.log(`     Provider    : ${a.provider}`)
    console.log(`     Budget      : ${budget} USDC`)
    console.log(`     Deadline    : ${formatDeadline(a.deadline)} remaining  (${new Date(a.deadline * 1000).toLocaleString('fr-FR')})`)
    console.log(`     Deliverable : ${a.deliverable}`)
    console.log(`     Basescan    : ${BASESCAN}/tx/...  (search job #${a.jobId})`)
    console.log()
  }

  const critical = alerts.filter(a => a.urgency === 'critical').length
  const high     = alerts.filter(a => a.urgency === 'high').length
  const normal   = alerts.filter(a => a.urgency === 'normal').length
  const low      = alerts.filter(a => a.urgency === 'low').length
  console.log(`  ─── ${critical} 🔴  ${high} 🟠  ${normal} 🟡  ${low} ⚪  (${alerts.length} total)`)
  console.log()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args      = process.argv.slice(2)
  const scanAll   = args.includes('--all')
  const jobArg    = args.find(a => a.startsWith('--job='))
  const jobId     = jobArg ? parseInt(jobArg.split('=')[1]) : undefined

  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org'
  const provider = new ethers.JsonRpcProvider(rpcUrl)

  const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf-8'))
  const { abi }    = JSON.parse(fs.readFileSync(ABI_FILE, 'utf-8'))

  const contractAddress = deployment.contracts.AgentJobManager.address
  const contract = new ethers.Contract(contractAddress, abi, provider)

  console.log(`[evaluator-daemon] Contract : ${contractAddress}`)
  console.log(`[evaluator-daemon] RPC      : ${rpcUrl}`)

  // Single job inspection mode
  if (jobId !== undefined) {
    await inspectJob(contract, jobId)
    return
  }

  const latestBlock = await provider.getBlockNumber()
  const state       = loadState(latestBlock)
  const fromBlock   = scanAll ? DEPLOY_BLOCK : state.lastScannedBlock

  const blockRange  = latestBlock - fromBlock
  const estimatedReqs = Math.ceil(blockRange / CHUNK_SIZE)
  if (estimatedReqs > 200) {
    console.log(`[evaluator-daemon] Warning: ${blockRange.toLocaleString()} blocks → ~${estimatedReqs} RPC calls (may be slow)`)
  }
  console.log(`[evaluator-daemon] Scanning blocks #${fromBlock} → #${latestBlock}...`)

  const alerts = await scanJobs(contract, fromBlock, latestBlock)
  printAlerts(alerts)

  if (!scanAll) {
    saveState({ lastScannedBlock: latestBlock, lastChecked: new Date().toISOString() })
    console.log(`[evaluator-daemon] State updated → block #${latestBlock}`)
  }
}

main().catch(err => {
  console.error('[evaluator-daemon] Error:', err.message)
  process.exit(1)
})
