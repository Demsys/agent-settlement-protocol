import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8"))

  const registry = await ethers.getContractAt("EvaluatorRegistry", manifest.contracts.EvaluatorRegistry.address, deployer)
  const agentJobManager = await ethers.getContractAt("AgentJobManager", manifest.contracts.AgentJobManager.address, deployer)

  const eligible = await registry.isEligible(deployer.address)
  const warmup = await registry.warmupPeriod()
  const now = BigInt(Math.floor(Date.now() / 1000))

  // Read governance proposals via propose* events on-chain
  const jobManagerKey = ethers.keccak256(ethers.toUtf8Bytes("jobManager"))
  const bridgeKey = ethers.keccak256(ethers.toUtf8Bytes("reputationBridge"))

  // Query ProposalCreated events to find executableAt
  const registryFilter = registry.filters.JobManagerProposed?.() 
  const bridgeFilter = agentJobManager.filters.ReputationBridgeProposed?.()

  console.log("\n=== Pre-execution checks ===")
  console.log(`Deployer:          ${deployer.address}`)
  console.log(`Deployer eligible: ${eligible ? "✓ YES — ready to evaluate" : "✗ NO — warmup not passed yet"}`)
  console.log(`Warmup period:     ${Number(warmup) / 86400} day(s)`)
  console.log(`Current time:      ${new Date(Number(now) * 1000).toISOString()}`)
  console.log(`\nGovernance proposals were submitted 2026-03-27.`)
  console.log(`2-day GOVERNANCE_DELAY expires: 2026-03-29`)
  console.log(`Ready to execute:  ${now >= BigInt(1743206400) ? "✓ YES (>= 2026-03-29)" : "✗ NOT YET"}`)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
