import { ethers } from 'ethers'
import * as path from 'path'
import * as fs from 'fs'

// TypeChain-generated factories — typed wrappers around the ABI
import { AgentJobManager__factory } from '../../typechain-types/factories/contracts/core/AgentJobManager.sol/AgentJobManager__factory'
import { MockUSDC__factory } from '../../typechain-types/factories/contracts/test/MockUSDC__factory'

import type { AgentJobManager } from '../../typechain-types/contracts/core/AgentJobManager.sol/AgentJobManager'
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

const MANIFEST_PATH = path.resolve(__dirname, '..', '..', 'deployments', 'base-sepolia.json')

function loadManifest(): DeploymentManifest {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Deployment manifest not found at ${MANIFEST_PATH}`)
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as DeploymentManifest
}

export const manifest = loadManifest()

// -------------------------------------------------------------------
// Provider (read-only, shared across all requests)
// -------------------------------------------------------------------

function createProvider(): ethers.JsonRpcProvider {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL
  if (!rpcUrl) {
    throw new Error('BASE_SEPOLIA_RPC_URL is not set in environment')
  }
  return new ethers.JsonRpcProvider(rpcUrl)
}

// Singleton provider — one connection pool for the whole process
export const provider = createProvider()

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
