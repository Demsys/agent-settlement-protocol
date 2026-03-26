export interface AgentRecord {
    agentId: string;
    name: string;
    address: string;
    apiKey: string;
    encryptedPrivateKey: string;
    createdAt: string;
}
export interface JobRecord {
    jobId: string;
    agentId: string;
    txHash: string;
    status: 'open' | 'funded' | 'submitted' | 'completed' | 'rejected' | 'expired';
    providerAddress: string;
    budget: string;
    deadlineMinutes: number;
    createdAt: string;
    updatedAt: string;
}
export declare function readAgents(): AgentRecord[];
export declare function writeAgents(_agents: AgentRecord[]): void;
export declare function findAgentById(agentId: string): AgentRecord | undefined;
export declare function findAgentByApiKey(apiKey: string): AgentRecord | undefined;
export declare function saveAgent(agent: AgentRecord): void;
export declare function readJobs(): JobRecord[];
export declare function writeJobs(_jobs: JobRecord[]): void;
export declare function findJobById(jobId: string): JobRecord | undefined;
export declare function findJobsByAgentId(agentId: string): JobRecord[];
export declare function saveJob(job: JobRecord): void;
export declare function updateJobStatus(jobId: string, status: JobRecord['status'], txHash?: string): void;
//# sourceMappingURL=storage.d.ts.map