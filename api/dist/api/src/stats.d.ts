export interface StatsPayload {
    generatedAt: string;
    protocol: {
        network: string;
        chainId: number;
        feeRateBps: number;
        feeRatePercent: string;
        evaluatorCount: number;
        contracts: {
            agentJobManager: string;
            evaluatorRegistry: string;
            reputationBridge: string;
            protocolToken: string;
            mockUsdc: string;
        };
    };
    jobs: {
        total: number;
        byStatus: Record<string, number>;
        completionRate: string;
        totalBudgetUsdc: string;
    };
    agents: {
        total: number;
    };
}
export declare function getStats(): Promise<StatsPayload>;
/** Force-invalidates the cache (useful after a write operation). */
export declare function invalidateStatsCache(): void;
//# sourceMappingURL=stats.d.ts.map