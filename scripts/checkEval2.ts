import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8"))
  const [signer] = await ethers.getSigners()
  const registry = await ethers.getContractAt("EvaluatorRegistry", manifest.contracts.EvaluatorRegistry.address, signer)

  const second  = "0x06C1e576A107Aa417D305b817C75841aAb112758"
  const deployer = "0xEEb3E4548fbdfb8F3bEF8D496cC086Bb403C85E5"
  const minStake = await registry.minEvaluatorStake()

  for (const [label, addr] of [["Deployer", deployer], ["Second wallet", second]] as const) {
    const stake    = await registry.getStake(addr)
    const eligible = await registry.isEligible(addr)
    console.log(`\n${label} (${addr})`)
    console.log(`  Stake    : ${ethers.formatEther(stake)} VRT`)
    console.log(`  Eligible : ${eligible}`)
  }

  const count = await registry.getEvaluatorCount()
  console.log(`\nMin stake            : ${ethers.formatEther(minStake)} VRT`)
  console.log(`Total evaluators     : ${count}`)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
