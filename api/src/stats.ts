import { manifest, getJobManagerReadOnly, getEvaluatorRegistryReadOnly } from './contracts'
import { readJobs, readAgents } from './storage'

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
// In-memory cache — avoids hammering the RPC on every dashboard refresh
// -------------------------------------------------------------------

const CACHE_TTL_MS = 30_000

let cache: { data: StatsPayload; expiresAt: number } | null = null

// -------------------------------------------------------------------
// Builder
// -------------------------------------------------------------------

async function buildStats(): Promise<StatsPayload> {
  const [feeRateBigint, evaluatorCountBigint] = await Promise.all([
    getJobManagerReadOnly().getFeeRate(),
    getEvaluatorRegistryReadOnly().getEvaluatorCount(),
  ])

  const feeRateBps = Number(feeRateBigint)
  const evaluatorCount = Number(evaluatorCountBigint)

  const jobs = readJobs()
  const agents = readAgents()

  // Count by status
  const byStatus: Record<string, number> = {
    open: 0, funded: 0, submitted: 0, completed: 0, rejected: 0, expired: 0,
  }
  let totalBudget = 0
  for (const job of jobs) {
    byStatus[job.status] = (byStatus[job.status] ?? 0) + 1
    totalBudget += parseFloat(job.budget)
  }

  const settled = byStatus.completed + byStatus.rejected
  const completionRate = settled > 0
    ? `${Math.round((byStatus.completed / settled) * 100)}%`
    : 'n/a'

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
    jobs: {
      total: jobs.length,
      byStatus,
      completionRate,
      totalBudgetUsdc: totalBudget.toFixed(2),
    },
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
