/**
 * Returns the self-contained HTML for the monitoring dashboard.
 * apiBase is injected at render time so the fetch() calls point to the
 * correct host regardless of the environment.
 * basescanBase is the network-aware root URL (mainnet vs. sepolia) so
 * contract links work on both testnet and production deployments.
 */
export declare function getDashboardHtml(apiBase: string, basescanBase: string): string;
//# sourceMappingURL=dashboard.d.ts.map