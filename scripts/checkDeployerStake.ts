/**
 * checkDeployerStake.ts — check deployer stake in EvaluatorRegistry
 * Usage: npx hardhat run scripts/checkDeployerStake.ts --network base-sepolia
 */
import { ethers } from 'hardhat'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployments', 'base-sepolia.json'), 'utf-8'))
  const registry = await ethers.getContractAt('EvaluatorRegistry', manifest.contracts.EvaluatorRegistry.address)

  const stake   = await registry.getStake(deployer.address)
  const eligible = await registry.isEligible(deployer.address)
  const count    = await registry.getEvaluatorCount()

  console.log(`Deployer  : ${deployer.address}`)
  console.log(`  Stake   : ${ethers.formatEther(stake)} VRT`)
  console.log(`  Eligible: ${eligible}`)
  console.log(`  Pool    : ${count} active evaluator(s)`)
}

main().catch((err) => { console.error(err.message); process.exitCode = 1 })
