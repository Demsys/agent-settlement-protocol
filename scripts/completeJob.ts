/**
 * completeJob.ts — complete a submitted job directly on-chain (deployer wallet)
 * Usage: JOB_ID=1 npx hardhat run scripts/completeJob.ts --network base-sepolia
 */
import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const jobId = process.env.JOB_ID
  if (!jobId) throw new Error("JOB_ID env var required")

  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8"))
  const jobManager = await ethers.getContractAt("AgentJobManager", manifest.contracts.AgentJobManager.address, deployer)

  const onChainJob = await jobManager.getJob(BigInt(jobId))
  console.log(`Job #${jobId} — status: ${onChainJob.status}, evaluator: ${onChainJob.evaluator}`)

  if (onChainJob.evaluator.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Evaluator is ${onChainJob.evaluator}, not deployer ${deployer.address}`)
  }

  const fd = await ethers.provider.getFeeData()
  const gas = fd.maxFeePerGas != null
    ? { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 2n }
    : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 2n }

  const tx = await jobManager.complete(BigInt(jobId), ethers.encodeBytes32String("test-cleanup"), gas)
  await tx.wait(1)
  console.log(`✓ Job #${jobId} completed — tx: ${tx.hash}`)
}

main().catch((err) => { console.error(err.message); process.exitCode = 1 })
