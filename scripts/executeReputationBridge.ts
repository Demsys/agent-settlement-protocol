import { ethers } from 'hardhat'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployments', 'base-sepolia.json'), 'utf-8'))

  const AgentJobManager = await ethers.getContractAt('AgentJobManager', manifest.contracts.AgentJobManager.address, deployer)

  const fd = await ethers.provider.getFeeData()
  const gas = fd.maxFeePerGas != null
    ? { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 2n }
    : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 2n }

  console.log('Executing executeReputationBridge…')
  const tx = await AgentJobManager.executeReputationBridge(manifest.contracts.ReputationBridge.address, gas)
  await tx.wait(1)
  console.log(`✓ executeReputationBridge — tx: ${tx.hash}`)
}

main().catch((err) => { console.error(err.message); process.exitCode = 1 })
