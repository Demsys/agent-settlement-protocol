import { ethers } from 'ethers'
import * as path from 'path'
import * as fs from 'fs'

// TypeChain-generated factories — typed wrappers around the ABI
import { AgentJobManager__factory } from '../../typechain-types/factories/contracts/core/AgentJobManager.sol/AgentJobManager__factory'
import { EvaluatorRegistry__factory } from '../../typechain-types/factories/contracts/core/EvaluatorRegistry__factory'
import { MockUSDC__factory } from '../../typechain-types/factories/contracts/test/MockUSDC__factory'

import type { AgentJobManager } from '../../typechain-types/contracts/core/AgentJobManager.sol/AgentJobManager'
import type { EvaluatorRegistry } from '../../typechain-types/contracts/core/EvaluatorRegistry'
import type { MockUSDC } from '../../typechain-types/contracts/test/MockUSDC'

// -------------------------------------------------------------------
// Deployment manifest
// -------------------------------------------------------------------

interface DeploymentManifest {
  network: string
  chainId: number
  deployer: string
  contracts: {
    MockUSDC: { address: string }
    ProtocolToken: { address: string }
    EvaluatorRegistry: { address: string }
    AgentJobManager: { address: string }
    ReputationBridge: { address: string }
  }
}

const MANIFEST_PATH = path.resolve(process.cwd(), '..', 'deployments', 'base-sepolia.json')

function loadManifest(): DeploymentManifest {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Deployment manifest not found at ${MANIFEST_PATH}`)
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as DeploymentManifest
}

export const manifest = loadManifest()

// -------------------------------------------------------------------
// Provider
// -------------------------------------------------------------------

// Returns either a single JsonRpcProvider (when only one URL is configured)
// or a FallbackProvider that tries multiple RPCs in priority order.
// The FallbackProvider with quorum=1 accepts the first successful response,
// so a single stalled RPC node does not block all requests.
function createProvider(): ethers.AbstractProvider {
  const primary   = process.env.BASE_SEPOLIA_RPC_URL    // required
  const secondary = process.env.BASE_SEPOLIA_RPC_URL_2  // optional
  const tertiary  = process.env.BASE_SEPOLIA_RPC_URL_3  // optional

  if (!primary) throw new Error('BASE_SEPOLIA_RPC_URL is not set')

  type FallbackProviderConfig = { provider: ethers.JsonRpcProvider; priority: number; stallTimeout: number }
  const configs: FallbackProviderConfig[] = [
    { provider: new ethers.JsonRpcProvider(primary), priority: 1, stallTimeout: 2000 },
  ]
  if (secondary) {
    configs.push({ provider: new ethers.JsonRpcProvider(secondary), priority: 2, stallTimeout: 2000 })
  }
  if (tertiary) {
    configs.push({ provider: new ethers.JsonRpcProvider(tertiary), priority: 3, stallTimeout: 2000 })
  }

  // With a single RPC, return it directly to avoid the FallbackProvider
  // overhead (extra latency from quorum bookkeeping).
  if (configs.length === 1) return configs[0].provider as ethers.JsonRpcProvider
  return new ethers.FallbackProvider(configs, undefined, { quorum: 1 })
}

// Shared read-only provider — used for all contract reads and balance queries.
export const provider: ethers.AbstractProvider = createProvider()

// Wallet signers require a Provider interface that supports sendTransaction.
// FallbackProvider satisfies ethers.Provider but ethers.Wallet only accepts
// ethers.Provider directly — both JsonRpcProvider and FallbackProvider implement it.
// We expose the primary URL as a dedicated JsonRpcProvider for wallet attachment.
export const primaryProvider: ethers.JsonRpcProvider = new ethers.JsonRpcProvider(
  process.env.BASE_SEPOLIA_RPC_URL ?? '',
)

// -------------------------------------------------------------------
// Contract factories
// -------------------------------------------------------------------

// Returns a read-only contract instance (no signer)
export function getJobManagerReadOnly(): AgentJobManager {
  return AgentJobManager__factory.connect(
    manifest.contracts.AgentJobManager.address,
    provider,
  )
}

// Returns a contract instance connected to the given signer (write-capable)
export function getJobManagerWithSigner(signer: ethers.Signer): AgentJobManager {
  return AgentJobManager__factory.connect(
    manifest.contracts.AgentJobManager.address,
    signer,
  )
}

export function getMockUSDCWithSigner(signer: ethers.Signer): MockUSDC {
  return MockUSDC__factory.connect(
    manifest.contracts.MockUSDC.address,
    signer,
  )
}

export function getMockUSDCReadOnly(): MockUSDC {
  return MockUSDC__factory.connect(
    manifest.contracts.MockUSDC.address,
    provider,
  )
}

export function getEvaluatorRegistryReadOnly(): EvaluatorRegistry {
  return EvaluatorRegistry__factory.connect(
    manifest.contracts.EvaluatorRegistry.address,
    provider,
  )
}

// -------------------------------------------------------------------
// Job status mapping (on-chain uint8 → human-readable string)
// -------------------------------------------------------------------

export const JOB_STATUS_MAP: Record<number, string> = {
  0: 'open',
  1: 'funded',
  2: 'submitted',
  3: 'completed',
  4: 'rejected',
  5: 'expired',
}

// USDC has 6 decimals on all networks
export const USDC_DECIMALS = 6
