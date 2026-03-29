import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8"))

  const agentJobManager = await ethers.getContractAt("AgentJobManager", manifest.contracts.AgentJobManager.address, deployer)
  const registry = await ethers.getContractAt("EvaluatorRegistry", manifest.contracts.EvaluatorRegistry.address, deployer)

  const bridge = await agentJobManager.reputationBridge()
  const jobManager = await registry.jobManager()
  const eligible = await registry.isEligible(deployer.address)

  console.log("\n=== Current on-chain state ===")
  console.log(`AgentJobManager.reputationBridge : ${bridge}`)
  console.log(`  Expected : ${manifest.contracts.ReputationBridge.address}`)
  console.log(`  Match    : ${bridge.toLowerCase() === manifest.contracts.ReputationBridge.address.toLowerCase() ? "✓ YES" : "✗ NO"}`)
  console.log(``)
  console.log(`EvaluatorRegistry.jobManager     : ${jobManager}`)
  console.log(`  Expected : ${manifest.contracts.AgentJobManager.address}`)
  console.log(`  Match    : ${jobManager.toLowerCase() === manifest.contracts.AgentJobManager.address.toLowerCase() ? "✓ YES" : "✗ NO"}`)
  console.log(``)
  console.log(`Deployer eligible evaluator      : ${eligible ? "✓ YES" : "✗ NO"}`)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
