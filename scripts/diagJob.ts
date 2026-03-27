import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8")
  )
  const mgr  = await ethers.getContractAt("AgentJobManager",  manifest.contracts.AgentJobManager.address)
  const usdc = await ethers.getContractAt("MockUSDC", manifest.contracts.MockUSDC.address)

  const agentAddr   = "0x38d7a7A86b6f9f91cF4059cEff0a1AeE42A11797"
  const mgrAddr     = manifest.contracts.AgentJobManager.address
  const jobId       = 1n

  const ethBal  = await ethers.provider.getBalance(agentAddr)
  const usdcBal = await usdc.balanceOf(agentAddr)
  const allow   = await usdc.allowance(agentAddr, mgrAddr)
  const nonce   = await ethers.provider.getTransactionCount(agentAddr, "latest")

  console.log(`\nAgent wallet: ${agentAddr}`)
  console.log(`  ETH:       ${ethers.formatEther(ethBal)} ETH`)
  console.log(`  USDC:      ${ethers.formatUnits(usdcBal, 6)} USDC`)
  console.log(`  Allowance: ${ethers.formatUnits(allow, 6)} USDC`)
  console.log(`  Nonce:     ${nonce}`)

  try {
    const job = await mgr.getJob(jobId)
    console.log(`\nJob #${jobId} on-chain:`)
    console.log(`  status:   ${job.status} (0=open,1=funded,2=submitted,3=completed)`)
    console.log(`  budget:   ${ethers.formatUnits(job.budget, 6)} USDC`)
    console.log(`  evaluator: ${job.evaluator}`)
  } catch (e) {
    console.log(`\nJob #${jobId}: not found on-chain`)
  }
}
main().catch(console.error)
