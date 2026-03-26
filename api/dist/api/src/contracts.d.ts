import { ethers } from 'ethers';
import type { AgentJobManager } from '../../typechain-types/contracts/core/AgentJobManager.sol/AgentJobManager';
import type { EvaluatorRegistry } from '../../typechain-types/contracts/core/EvaluatorRegistry';
import type { MockUSDC } from '../../typechain-types/contracts/test/MockUSDC';
interface DeploymentManifest {
    network: string;
    chainId: number;
    deployer: string;
    contracts: {
        MockUSDC: {
            address: string;
        };
        ProtocolToken: {
            address: string;
        };
        EvaluatorRegistry: {
            address: string;
        };
        AgentJobManager: {
            address: string;
        };
        ReputationBridge: {
            address: string;
        };
    };
}
export declare const manifest: DeploymentManifest;
export declare const provider: ethers.AbstractProvider;
export declare const primaryProvider: ethers.JsonRpcProvider;
export declare function getJobManagerReadOnly(): AgentJobManager;
export declare function getJobManagerWithSigner(signer: ethers.Signer): AgentJobManager;
export declare function getMockUSDCWithSigner(signer: ethers.Signer): MockUSDC;
export declare function getMockUSDCReadOnly(): MockUSDC;
export declare function getEvaluatorRegistryReadOnly(): EvaluatorRegistry;
export declare const JOB_STATUS_MAP: Record<number, string>;
export declare const USDC_DECIMALS = 6;
export {};
//# sourceMappingURL=contracts.d.ts.map