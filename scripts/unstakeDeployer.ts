/**
 * unstakeDeployer.ts — fully unstake the deployer from EvaluatorRegistry
 * Usage: npx hardhat run scripts/unstakeDeployer.ts --network base-sepolia
 */
import { ethers } from 'hardhat'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployments', 'base-sepolia.json'), 'utf-8'))
  const registry = await ethers.getContractAt('EvaluatorRegistry', manifest.contracts.EvaluatorRegistry.address, deployer)

  const stake = await registry.getStake(deployer.address)
  if (stake === 0n) {
    console.log('Deployer has no stake — nothing to do')
    return
  }

  console.log(`Unstaking ${ethers.formatEther(stake)} VRT from deployer ${deployer.address}…`)

  const fd = await ethers.provider.getFeeData()
  const gas = fd.maxFeePerGas != null
    ? { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 2n }
    : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 2n }

  const tx = await registry.unstake(stake, gas)
  await tx.wait(1)

  const remaining = await registry.getStake(deployer.address)
  const count = await registry.getEvaluatorCount()
  console.log(`✓ Unstaked — remaining stake: ${ethers.formatEther(remaining)} VRT`)
  console.log(`  Pool now has ${count} active evaluator(s)`)
}

main().catch((err) => { console.error(err.message); process.exitCode = 1 })
