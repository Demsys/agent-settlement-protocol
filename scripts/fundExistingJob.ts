/**
 * fundExistingJob.ts — setBudget + mint USDC + approve + fund for an existing Open job
 * Usage: JOB_ID=5 BUDGET=5 npx hardhat run scripts/fundExistingJob.ts --network base-sepolia
 */
import { ethers } from 'hardhat'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  const jobId     = BigInt(process.env.JOB_ID ?? '5')
  const budgetUSDC = process.env.BUDGET ?? '5'

  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployments', 'base-sepolia.json'), 'utf-8'))
  const jobManager = await ethers.getContractAt('AgentJobManager', manifest.contracts.AgentJobManager.address, deployer)
  const usdc       = await ethers.getContractAt('MockUSDC', manifest.contracts.MockUSDC.address, deployer)

  const budgetWei = ethers.parseUnits(budgetUSDC, 6)
  let nonce = await ethers.provider.getTransactionCount(deployer.address, 'pending')

  const fd = await ethers.provider.getFeeData()
  const gasOpts = fd.maxFeePerGas != null
    ? { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 2n }
    : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 2n }

  console.log(`Funding job #${jobId} — ${budgetUSDC} USDC — nonce start: ${nonce}`)

  const tx1 = await jobManager.setBudget(jobId, budgetWei, { ...gasOpts, nonce: nonce++ })
  await tx1.wait(1)
  console.log(`✓ setBudget`)

  const tx2 = await usdc.mint(deployer.address, budgetWei, { ...gasOpts, nonce: nonce++ })
  await tx2.wait(1)
  console.log(`✓ mint USDC`)

  const tx3 = await usdc.approve(manifest.contracts.AgentJobManager.address, budgetWei, { ...gasOpts, nonce: nonce++ })
  await tx3.wait(1)
  console.log(`✓ approve`)

  const tx4 = await jobManager.fund(jobId, budgetWei, { ...gasOpts, nonce: nonce++ })
  await tx4.wait(1)
  console.log(`✓ Job #${jobId} funded — tx: ${tx4.hash}`)
  console.log(`  Basescan: https://sepolia.basescan.org/tx/${tx4.hash}`)
}

main().catch((err) => { console.error(err.message); process.exitCode = 1 })
