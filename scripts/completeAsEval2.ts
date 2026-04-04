/**
 * completeAsEval2.ts
 *
 * Check job #6 status and complete it as the second evaluator wallet.
 *
 * Usage:
 *   PRIVATE_KEY=<second-wallet-key> npx hardhat run scripts/completeAsEval2.ts --network base-sepolia
 */
import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

const JOB_ID = 6n

async function main() {
  const [signer] = await ethers.getSigners()
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8"))

  const jobManager = await ethers.getContractAt("AgentJobManager", manifest.contracts.AgentJobManager.address, signer)
  const registry   = await ethers.getContractAt("EvaluatorRegistry", manifest.contracts.EvaluatorRegistry.address, signer)
  const usdc       = await ethers.getContractAt("MockUSDC", manifest.contracts.MockUSDC.address, signer)

  console.log(`\nWallet : ${signer.address}`)
  console.log(`ETH    : ${ethers.formatEther(await ethers.provider.getBalance(signer.address))}`)

  const eligible = await registry.isEligible(signer.address)
  console.log(`Eligible as evaluator: ${eligible}`)
  if (!eligible) {
    console.error("✗ This wallet is not an eligible evaluator. Stake first.")
    process.exitCode = 1
    return
  }

  // Check job status
  const STATUS_LABELS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"]
  const job = await jobManager.getJob(JOB_ID)
  const statusLabel = STATUS_LABELS[Number(job.status)]
  console.log(`\nJob #${JOB_ID}`)
  console.log(`  Status    : ${statusLabel}`)
  console.log(`  Provider  : ${job.provider}`)
  console.log(`  Evaluator : ${job.evaluator}`)
  console.log(`  Budget    : ${ethers.formatUnits(job.budget, 6)} USDC`)

  if (job.status === 1n) {
    console.log("\n⚠  Job is Funded but not yet Submitted. Bob needs to submit first.")
    console.log("   Run: npx hardhat run scripts/testJobWatcher.ts --network base-sepolia")
    console.log("   Or POST /v1/jobs/6/submit with Bob's API key.")
    return
  }

  if (job.status !== 2n) {
    console.error(`\n✗ Job must be in Submitted state to complete. Current: ${statusLabel}`)
    process.exitCode = 1
    return
  }

  // Verify this signer is the designated evaluator
  if (job.evaluator.toLowerCase() !== signer.address.toLowerCase()) {
    console.error(`\n✗ This wallet (${signer.address}) is not the designated evaluator (${job.evaluator})`)
    process.exitCode = 1
    return
  }

  const balBefore = await usdc.balanceOf(signer.address)
  console.log(`\nEvaluator USDC before : ${ethers.formatUnits(balBefore, 6)} USDC`)

  const fd = await ethers.provider.getFeeData()
  const overrides = fd.maxFeePerGas != null
    ? { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 2n }
    : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 2n }

  console.log("\nCalling complete()…")
  const tx = await jobManager.complete(JOB_ID, overrides)
  console.log(`  tx: ${tx.hash}`)
  const receipt = await tx.wait(1)
  console.log(`  confirmed in block ${receipt?.blockNumber}`)

  const balAfter = await usdc.balanceOf(signer.address)
  console.log(`\nEvaluator USDC after  : ${ethers.formatUnits(balAfter, 6)} USDC`)
  console.log(`  Earned : +${ethers.formatUnits(balAfter - balBefore, 6)} USDC`)

  const jobFinal = await jobManager.getJob(JOB_ID)
  console.log(`\nJob #${JOB_ID} final status: ${STATUS_LABELS[Number(jobFinal.status)]}`)
  console.log("✓ Done.")
}

main().catch(e => { console.error(e); process.exitCode = 1 })
