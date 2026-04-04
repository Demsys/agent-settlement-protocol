import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8"))
  const [signer] = await ethers.getSigners()

  const bridge = await ethers.getContractAt("ReputationBridge", manifest.contracts.ReputationBridge.address, signer)
  const jobMgr  = await ethers.getContractAt("AgentJobManager", manifest.contracts.AgentJobManager.address, signer)

  const bridgeJobManager = await bridge.jobManager()
  const bridgeRegistry   = await bridge.reputationRegistry()
  const jobMgrBridge     = await jobMgr.reputationBridge()

  console.log("=== ReputationBridge wiring ===")
  console.log(`ReputationBridge address         : ${manifest.contracts.ReputationBridge.address}`)
  console.log(`ReputationBridge.jobManager      : ${bridgeJobManager}`)
  console.log(`  → should be AgentJobManager    : ${manifest.contracts.AgentJobManager.address}`)
  console.log(`  wired? ${bridgeJobManager.toLowerCase() === manifest.contracts.AgentJobManager.address.toLowerCase() ? "✓ YES" : "✗ NO"}`)

  console.log(`\nReputationBridge.reputationRegistry : ${bridgeRegistry}`)
  console.log(`  (address(0) = ERC-8004 not yet deployed — bridge runs in no-op mode)`)

  console.log(`\nAgentJobManager.reputationBridge : ${jobMgrBridge}`)
  console.log(`  → should be ReputationBridge   : ${manifest.contracts.ReputationBridge.address}`)
  console.log(`  wired? ${jobMgrBridge.toLowerCase() === manifest.contracts.ReputationBridge.address.toLowerCase() ? "✓ YES" : "✗ NO"}`)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
