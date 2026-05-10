import { ethers } from 'ethers'
import { provider, manifest, getJobManagerReadOnly, getEvaluatorRegistryReadOnly, JOB_STATUS_MAP, USDC_DECIMALS } from './contracts'
import { readAgents } from './storage'

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface StatsPayload {
  generatedAt: string
  protocol: {
    network: string
    chainId: number
    feeRateBps: number
    feeRatePercent: string
    evaluatorCount: number
    contracts: {
      agentJobManager: string
      evaluatorRegistry: string
      reputationBridge: string
      protocolToken: string
      mockUsdc: string
    }
  }
  jobs: {
    total: number
    byStatus: Record<string, number>
    completionRate: string
    totalBudgetUsdc: string
  }
  agents: {
    total: number
  }
}

// -------------------------------------------------------------------
// On-chain job stats
// -------------------------------------------------------------------

const CHUNK_SIZE = 9_000

// Cached deployment block — resolved once from the deploy tx receipt
let deploymentBlock: number | null = null

async function getDeploymentBlock(): Promise<number> {
  if (deploymentBlock !== null) return deploymentBlock
  const receipt = await provider.getTransactionReceipt(manifest.contracts.AgentJobManager.txHash)
  if (!receipt) throw new Error('AgentJobManager deployment tx receipt not found')
  deploymentBlock = receipt.blockNumber
  return deploymentBlock
}

async function buildChainJobStats() {
  const jobManager = getJobManagerReadOnly()
  const [fromBlock, currentBlock] = await Promise.all([
    getDeploymentBlock(),
    provider.getBlockNumber(),
  ])

  // Collect all JobCreated event logs in 9000-block chunks (Base Sepolia RPC limit)
  const jobIds = new Set<bigint>()
  for (let start = fromBlock; start <= currentBlock; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, currentBlock)
    const logs = await jobManager.queryFilter(jobManager.filters.JobCreated(), start, end)
    for (const log of logs as unknown as ethers.EventLog[]) {
      jobIds.add(log.args.jobId as bigint)
    }
  }

  // Fetch all job structs in parallel
  const jobs = await Promise.all([...jobIds].map((id) => jobManager.getJob(id)))

  // Aggregate by status
  const byStatus: Record<string, number> = {
    open: 0, funded: 0, submitted: 0, completed: 0, rejected: 0, expired: 0,
  }
  let totalBudgetRaw = 0n

  for (const job of jobs) {
    const statusStr = JOB_STATUS_MAP[Number(job.status)] ?? 'unknown'
    byStatus[statusStr] = (byStatus[statusStr] ?? 0) + 1
    // budget is zeroed on-chain after settlement — only active jobs contribute
    totalBudgetRaw += job.budget
  }

  const settled = (byStatus.completed ?? 0) + (byStatus.rejected ?? 0) + (byStatus.expired ?? 0)
  const completionRate = settled > 0
    ? `${Math.round(((byStatus.completed ?? 0) / settled) * 100)}%`
    : 'n/a'

  return {
    total: jobIds.size,
    byStatus,
    completionRate,
    totalBudgetUsdc: (Number(totalBudgetRaw) / 10 ** USDC_DECIMALS).toFixed(2),
  }
}

// -------------------------------------------------------------------
// In-memory cache — avoids hammering the RPC on every dashboard refresh
// -------------------------------------------------------------------

const CACHE_TTL_MS = 30_000

let cache: { data: StatsPayload; expiresAt: number } | null = null

// -------------------------------------------------------------------
// Builder
// -------------------------------------------------------------------

async function buildStats(): Promise<StatsPayload> {
  const [feeRateBigint, evaluatorCountBigint, chainJobStats, agents] = await Promise.all([
    getJobManagerReadOnly().getFeeRate(),
    getEvaluatorRegistryReadOnly().getEvaluatorCount(),
    buildChainJobStats(),
    Promise.resolve(readAgents()),
  ])

  const feeRateBps = Number(feeRateBigint)
  const evaluatorCount = Number(evaluatorCountBigint)

  return {
    generatedAt: new Date().toISOString(),
    protocol: {
      network: manifest.network,
      chainId: manifest.chainId,
      feeRateBps,
      feeRatePercent: `${(feeRateBps / 100).toFixed(2)}%`,
      evaluatorCount,
      contracts: {
        agentJobManager:   manifest.contracts.AgentJobManager.address,
        evaluatorRegistry: manifest.contracts.EvaluatorRegistry.address,
        reputationBridge:  manifest.contracts.ReputationBridge.address,
        protocolToken:     manifest.contracts.ProtocolToken.address,
        mockUsdc:          manifest.contracts.MockUSDC.address,
      },
    },
    jobs: chainJobStats,
    agents: {
      total: agents.length,
    },
  }
}

// -------------------------------------------------------------------
// Public API — returns cached data when fresh, rebuilds otherwise
// -------------------------------------------------------------------

export async function getStats(): Promise<StatsPayload> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.data
  }
  const data = await buildStats()
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS }
  return data
}

/** Force-invalidates the cache (useful after a write operation). */
export function invalidateStatsCache(): void {
  cache = null
}
