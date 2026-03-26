"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.USDC_DECIMALS = exports.JOB_STATUS_MAP = exports.primaryProvider = exports.provider = exports.manifest = void 0;
exports.getJobManagerReadOnly = getJobManagerReadOnly;
exports.getJobManagerWithSigner = getJobManagerWithSigner;
exports.getMockUSDCWithSigner = getMockUSDCWithSigner;
exports.getMockUSDCReadOnly = getMockUSDCReadOnly;
exports.getEvaluatorRegistryReadOnly = getEvaluatorRegistryReadOnly;
const ethers_1 = require("ethers");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// TypeChain-generated factories — typed wrappers around the ABI
const AgentJobManager__factory_1 = require("../../typechain-types/factories/contracts/core/AgentJobManager.sol/AgentJobManager__factory");
const EvaluatorRegistry__factory_1 = require("../../typechain-types/factories/contracts/core/EvaluatorRegistry__factory");
const MockUSDC__factory_1 = require("../../typechain-types/factories/contracts/test/MockUSDC__factory");
const MANIFEST_PATH = path.resolve(process.cwd(), '..', 'deployments', 'base-sepolia.json');
function loadManifest() {
    if (!fs.existsSync(MANIFEST_PATH)) {
        throw new Error(`Deployment manifest not found at ${MANIFEST_PATH}`);
    }
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
}
exports.manifest = loadManifest();
// -------------------------------------------------------------------
// Provider
// -------------------------------------------------------------------
// Returns either a single JsonRpcProvider (when only one URL is configured)
// or a FallbackProvider that tries multiple RPCs in priority order.
// The FallbackProvider with quorum=1 accepts the first successful response,
// so a single stalled RPC node does not block all requests.
function createProvider() {
    const primary = process.env.BASE_SEPOLIA_RPC_URL; // required
    const secondary = process.env.BASE_SEPOLIA_RPC_URL_2; // optional
    const tertiary = process.env.BASE_SEPOLIA_RPC_URL_3; // optional
    if (!primary)
        throw new Error('BASE_SEPOLIA_RPC_URL is not set');
    const configs = [
        { provider: new ethers_1.ethers.JsonRpcProvider(primary), priority: 1, stallTimeout: 2000 },
    ];
    if (secondary) {
        configs.push({ provider: new ethers_1.ethers.JsonRpcProvider(secondary), priority: 2, stallTimeout: 2000 });
    }
    if (tertiary) {
        configs.push({ provider: new ethers_1.ethers.JsonRpcProvider(tertiary), priority: 3, stallTimeout: 2000 });
    }
    // With a single RPC, return it directly to avoid the FallbackProvider
    // overhead (extra latency from quorum bookkeeping).
    if (configs.length === 1)
        return configs[0].provider;
    return new ethers_1.ethers.FallbackProvider(configs, undefined, { quorum: 1 });
}
// Shared read-only provider — used for all contract reads and balance queries.
exports.provider = createProvider();
// Wallet signers require a Provider interface that supports sendTransaction.
// FallbackProvider satisfies ethers.Provider but ethers.Wallet only accepts
// ethers.Provider directly — both JsonRpcProvider and FallbackProvider implement it.
// We expose the primary URL as a dedicated JsonRpcProvider for wallet attachment.
exports.primaryProvider = new ethers_1.ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC_URL ?? '');
// -------------------------------------------------------------------
// Contract factories
// -------------------------------------------------------------------
// Returns a read-only contract instance (no signer)
function getJobManagerReadOnly() {
    return AgentJobManager__factory_1.AgentJobManager__factory.connect(exports.manifest.contracts.AgentJobManager.address, exports.provider);
}
// Returns a contract instance connected to the given signer (write-capable)
function getJobManagerWithSigner(signer) {
    return AgentJobManager__factory_1.AgentJobManager__factory.connect(exports.manifest.contracts.AgentJobManager.address, signer);
}
function getMockUSDCWithSigner(signer) {
    return MockUSDC__factory_1.MockUSDC__factory.connect(exports.manifest.contracts.MockUSDC.address, signer);
}
function getMockUSDCReadOnly() {
    return MockUSDC__factory_1.MockUSDC__factory.connect(exports.manifest.contracts.MockUSDC.address, exports.provider);
}
function getEvaluatorRegistryReadOnly() {
    return EvaluatorRegistry__factory_1.EvaluatorRegistry__factory.connect(exports.manifest.contracts.EvaluatorRegistry.address, exports.provider);
}
// -------------------------------------------------------------------
// Job status mapping (on-chain uint8 → human-readable string)
// -------------------------------------------------------------------
exports.JOB_STATUS_MAP = {
    0: 'open',
    1: 'funded',
    2: 'submitted',
    3: 'completed',
    4: 'rejected',
    5: 'expired',
};
// USDC has 6 decimals on all networks
exports.USDC_DECIMALS = 6;
//# sourceMappingURL=contracts.js.map