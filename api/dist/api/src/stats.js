"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStats = getStats;
exports.invalidateStatsCache = invalidateStatsCache;
const contracts_1 = require("./contracts");
const storage_1 = require("./storage");
// -------------------------------------------------------------------
// In-memory cache — avoids hammering the RPC on every dashboard refresh
// -------------------------------------------------------------------
const CACHE_TTL_MS = 30_000;
let cache = null;
// -------------------------------------------------------------------
// Builder
// -------------------------------------------------------------------
async function buildStats() {
    const [feeRateBigint, evaluatorCountBigint] = await Promise.all([
        (0, contracts_1.getJobManagerReadOnly)().getFeeRate(),
        (0, contracts_1.getEvaluatorRegistryReadOnly)().getEvaluatorCount(),
    ]);
    const feeRateBps = Number(feeRateBigint);
    const evaluatorCount = Number(evaluatorCountBigint);
    const jobs = (0, storage_1.readJobs)();
    const agents = (0, storage_1.readAgents)();
    // Count by status
    const byStatus = {
        open: 0, funded: 0, submitted: 0, completed: 0, rejected: 0, expired: 0,
    };
    let totalBudget = 0;
    for (const job of jobs) {
        byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;
        totalBudget += parseFloat(job.budget);
    }
    const settled = byStatus.completed + byStatus.rejected;
    const completionRate = settled > 0
        ? `${Math.round((byStatus.completed / settled) * 100)}%`
        : 'n/a';
    return {
        generatedAt: new Date().toISOString(),
        protocol: {
            network: contracts_1.manifest.network,
            chainId: contracts_1.manifest.chainId,
            feeRateBps,
            feeRatePercent: `${(feeRateBps / 100).toFixed(2)}%`,
            evaluatorCount,
            contracts: {
                agentJobManager: contracts_1.manifest.contracts.AgentJobManager.address,
                evaluatorRegistry: contracts_1.manifest.contracts.EvaluatorRegistry.address,
                reputationBridge: contracts_1.manifest.contracts.ReputationBridge.address,
                protocolToken: contracts_1.manifest.contracts.ProtocolToken.address,
                mockUsdc: contracts_1.manifest.contracts.MockUSDC.address,
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
    };
}
// -------------------------------------------------------------------
// Public API — returns cached data when fresh, rebuilds otherwise
// -------------------------------------------------------------------
async function getStats() {
    if (cache && Date.now() < cache.expiresAt) {
        return cache.data;
    }
    const data = await buildStats();
    cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return data;
}
/** Force-invalidates the cache (useful after a write operation). */
function invalidateStatsCache() {
    cache = null;
}
//# sourceMappingURL=stats.js.map