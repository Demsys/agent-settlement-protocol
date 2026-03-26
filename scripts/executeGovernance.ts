/**
 * executeGovernance.ts
 *
 * Executes pending governance proposals after GOVERNANCE_DELAY (2 days).
 * Run this script 2+ days after deploy.ts to complete both:
 *   - EvaluatorRegistry.executeJobManager()
 *   - AgentJobManager.executeReputationBridge()
 *
 * Usage:
 *   npx hardhat run scripts/executeGovernance.ts --network base-sepolia
 *   npx hardhat run scripts/executeGovernance.ts --network base-mainnet
 *
 * The script is idempotent: if a proposal has already been executed or was
 * never submitted, it logs a warning and continues rather than aborting.
 * This makes it safe to re-run after a partial failure.
 */

import { ethers } from 'hardhat'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  const [deployer] = await ethers.getSigners()
  const network = await ethers.provider.getNetwork()
  const networkName = network.chainId === 8453n ? 'base-mainnet' : 'base-sepolia'

  const manifestPath = path.resolve(__dirname, '..', 'deployments', `${networkName}.json`)
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}. Run deploy.ts first.`)
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

  console.log(`\n=== Agent Settlement Protocol — Governance Execution ===`)
  console.log(`  Network  : ${networkName} (chainId ${network.chainId})`)
  console.log(`  Deployer : ${deployer.address}`)
  console.log(`  Balance  : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`)

  if (!manifest.contracts?.EvaluatorRegistry?.address) {
    throw new Error('EvaluatorRegistry address not found in manifest. Deploy first.')
  }
  if (!manifest.contracts?.AgentJobManager?.address) {
    throw new Error('AgentJobManager address not found in manifest. Deploy first.')
  }
  if (!manifest.contracts?.ReputationBridge?.address) {
    throw new Error('ReputationBridge address not found in manifest. Deploy first.')
  }

  const EvaluatorRegistry = await ethers.getContractAt(
    'EvaluatorRegistry',
    manifest.contracts.EvaluatorRegistry.address,
    deployer,
  )
  const AgentJobManager = await ethers.getContractAt(
    'AgentJobManager',
    manifest.contracts.AgentJobManager.address,
    deployer,
  )

  console.log('\n--- Executing pending governance proposals ---\n')

  // ── 1. EvaluatorRegistry.executeJobManager ──────────────────────────────────
  try {
    const tx = await EvaluatorRegistry.executeJobManager(manifest.contracts.AgentJobManager.address)
    await tx.wait(1)
    console.log(`  \u2713 executeJobManager — txHash: ${tx.hash}`)
    console.log(`    EvaluatorRegistry is now wired to AgentJobManager.`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('NoProposalPending')) {
      console.warn('  \u26a0  executeJobManager skipped: no proposal is pending (already executed or not proposed).')
    } else if (msg.includes('GovernanceDelayNotElapsed')) {
      console.warn('  \u26a0  executeJobManager skipped: GOVERNANCE_DELAY (2 days) has not elapsed yet. Re-run after the delay.')
    } else if (msg.includes('ProposalValueMismatch')) {
      console.warn('  \u26a0  executeJobManager skipped: address mismatch — check manifest for stale data.')
    } else {
      throw err
    }
  }

  // ── 2. AgentJobManager.executeReputationBridge ──────────────────────────────
  try {
    const tx = await AgentJobManager.executeReputationBridge(manifest.contracts.ReputationBridge.address)
    await tx.wait(1)
    console.log(`  \u2713 executeReputationBridge — txHash: ${tx.hash}`)
    console.log(`    AgentJobManager is now wired to ReputationBridge.`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('NoProposalPending')) {
      console.warn('  \u26a0  executeReputationBridge skipped: no proposal is pending (already executed or not proposed).')
    } else if (msg.includes('GovernanceDelayNotElapsed')) {
      console.warn('  \u26a0  executeReputationBridge skipped: GOVERNANCE_DELAY (2 days) has not elapsed yet. Re-run after the delay.')
    } else if (msg.includes('ProposalValueMismatch')) {
      console.warn('  \u26a0  executeReputationBridge skipped: address mismatch — check manifest for stale data.')
    } else {
      throw err
    }
  }

  console.log('\n=== Governance execution complete ===\n')
}

// ─── Entry point ──────────────────────────────────────────────────────────────

main().catch((err: unknown) => {
  console.error('\n  FATAL: Unhandled error during governance execution:')
  console.error(err)
  process.exitCode = 1
})
