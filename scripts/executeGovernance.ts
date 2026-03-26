/**
 * executeGovernance.ts
 *
 * Executes pending governance proposals after GOVERNANCE_DELAY (2 days).
 * Run this script 2+ days after deploy.ts to complete the EvaluatorRegistry
 * jobManager wiring.
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

  const EvaluatorRegistry = await ethers.getContractAt(
    'EvaluatorRegistry',
    manifest.contracts.EvaluatorRegistry.address,
    deployer,
  )

  console.log('\n--- Executing pending governance proposals on EvaluatorRegistry ---\n')

  try {
    const tx = await EvaluatorRegistry.executeJobManager(manifest.contracts.AgentJobManager.address)
    await tx.wait(1)
    console.log(`  \u2713 executeJobManager — txHash: ${tx.hash}`)
    console.log(`    EvaluatorRegistry is now wired to AgentJobManager.`)
    console.log(`    Auto-assigned evaluator jobs are now fully operational.`)
  } catch (err: unknown) {
    // Surface a clear message for each known failure mode so operators can diagnose
    // without reading Solidity ABI encodings.
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('NoProposalPending')) {
      console.warn('  \u26a0  executeJobManager skipped: no proposal is pending.')
      console.warn('     Either deploy.ts has not been run, or the proposal was already executed.')
    } else if (msg.includes('GovernanceDelayNotElapsed')) {
      console.warn('  \u26a0  executeJobManager skipped: GOVERNANCE_DELAY (2 days) has not elapsed yet.')
      console.warn('     Re-run this script after the delay.')
    } else if (msg.includes('ProposalValueMismatch')) {
      console.warn('  \u26a0  executeJobManager skipped: the AgentJobManager address in the manifest')
      console.warn('     does not match the value that was proposed. Check the manifest for stale data.')
    } else {
      // Unexpected error — rethrow so the operator sees the full trace.
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
