import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8")
  )
  const mgr  = await ethers.getContractAt("AgentJobManager", manifest.contracts.AgentJobManager.address, deployer)
  const usdc = await ethers.getContractAt("MockUSDC",        manifest.contracts.MockUSDC.address,        deployer)

  const AGENT = "0x38d7a7A86b6f9f91cF4059cEff0a1AeE42A11797"
  const JOB_ID = 1n
  const BUDGET = ethers.parseUnits("5", 6)

  // Check on-chain state
  const job = await mgr.getJob(JOB_ID)
  console.log(`Job status: ${job.status}, budget: ${ethers.formatUnits(job.budget, 6)} USDC`)
  console.log(`Job evaluator: ${job.evaluator}`)

  // Try to simulate fund() from the agent's address
  console.log("\nSimulating fund() from agent address…")
  try {
    await mgr.fund.staticCall(JOB_ID, BUDGET, { from: AGENT })
    console.log("  ✓ fund() would succeed")
  } catch (e: any) {
    console.log(`  ✗ fund() would revert: ${e.message?.slice(0, 300)}`)
  }

  // Try to simulate approve then fund
  console.log("\nSimulating approve() from agent address…")
  try {
    await usdc.approve.staticCall(manifest.contracts.AgentJobManager.address, ethers.MaxUint256, { from: AGENT })
    console.log("  ✓ approve() would succeed")
  } catch (e: any) {
    console.log(`  ✗ approve() would revert: ${e.message?.slice(0, 300)}`)
  }
}
main().catch(console.error)
