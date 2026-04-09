/**
 * createJobForEvaluator.ts — create and fund a job with an explicit evaluator
 * Usage: EVALUATOR=0x... PROVIDER=0x... BUDGET=5 npx hardhat run scripts/createJobForEvaluator.ts --network base-sepolia
 */
import { ethers } from 'hardhat'
import * as fs from 'fs'
import * as path from 'path'

async function main() {
  const evaluatorAddr = process.env.EVALUATOR
  const providerAddr  = process.env.PROVIDER
  const budgetUSDC    = process.env.BUDGET ?? '5'

  if (!evaluatorAddr || !ethers.isAddress(evaluatorAddr)) throw new Error('EVALUATOR env var required')
  if (!providerAddr  || !ethers.isAddress(providerAddr))  throw new Error('PROVIDER env var required')

  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployments', 'base-sepolia.json'), 'utf-8'))

  const jobManager = await ethers.getContractAt('AgentJobManager', manifest.contracts.AgentJobManager.address, deployer)
  const usdc       = await ethers.getContractAt('MockUSDC', manifest.contracts.MockUSDC.address, deployer)

  const fd = await ethers.provider.getFeeData()
  const gas = fd.maxFeePerGas != null
    ? { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 2n }
    : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 2n }

  const budgetWei  = ethers.parseUnits(budgetUSDC, 6)
  const deadline   = BigInt(Math.floor(Date.now() / 1000) + 2 * 60 * 60) // 2h

  // createJob with explicit evaluator
  console.log(`Creating job — provider: ${providerAddr}, evaluator: ${evaluatorAddr}, budget: ${budgetUSDC} USDC`)
  const createTx = await jobManager.createJob(providerAddr, evaluatorAddr, manifest.contracts.MockUSDC.address, deadline, gas)
  const createReceipt = await createTx.wait(1)
  const jobCreatedLog = createReceipt?.logs.find((l: any) => {
    try { jobManager.interface.parseLog(l); return true } catch { return false }
  })
  const parsed = jobCreatedLog ? jobManager.interface.parseLog(jobCreatedLog) : null
  const jobId = parsed?.args?.jobId ?? 'unknown'
  console.log(`✓ Job #${jobId} created — tx: ${createTx.hash}`)

  // setBudget
  const setBudgetTx = await jobManager.setBudget(jobId, budgetWei, gas)
  await setBudgetTx.wait(1)
  console.log(`✓ Budget set: ${budgetUSDC} USDC`)

  // Mint + approve USDC
  const mintTx = await usdc.mint(deployer.address, budgetWei, gas)
  await mintTx.wait(1)
  const approveTx = await usdc.approve(manifest.contracts.AgentJobManager.address, budgetWei, gas)
  await approveTx.wait(1)
  console.log(`✓ USDC minted and approved`)

  // fund
  const fundTx = await jobManager.fund(jobId, budgetWei, gas)
  await fundTx.wait(1)
  console.log(`✓ Job #${jobId} funded — evaluator: ${evaluatorAddr}`)
  console.log(`  Basescan: https://sepolia.basescan.org/tx/${fundTx.hash}`)
}

main().catch((err) => { console.error(err.message); process.exitCode = 1 })
