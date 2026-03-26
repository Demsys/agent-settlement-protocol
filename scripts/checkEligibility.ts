import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8")
  )
  const registry = await ethers.getContractAt("EvaluatorRegistry", manifest.contracts.EvaluatorRegistry.address, deployer)

  const warmup     = await registry.warmupPeriod()
  const info       = await registry.getEvaluator(deployer.address)
  const now        = Math.floor(Date.now() / 1000)
  const stakedAt   = Number(info.stakedAt)
  const eligibleAt = stakedAt + Number(warmup)

  console.log(`Warmup period:  ${Number(warmup) / 3600}h (${warmup}s)`)
  console.log(`Staked at:      ${new Date(stakedAt * 1000).toISOString()}`)
  console.log(`Eligible at:    ${new Date(eligibleAt * 1000).toISOString()}`)
  console.log(`Now:            ${new Date(now * 1000).toISOString()}`)
  console.log(`Wait remaining: ${Math.max(0, eligibleAt - now)}s`)
}

main().catch(console.error)
