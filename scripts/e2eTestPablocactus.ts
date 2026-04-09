/**
 * e2eTestPablocactus.ts — full end-to-end test job assigned to pablocactus as evaluator
 * Creates client + provider wallets, funds them, creates/funds/submits the job.
 * Pablocactus's AHM then evaluates and calls complete() or reject() autonomously.
 *
 * Usage: npx hardhat run scripts/e2eTestPablocactus.ts --network base-sepolia
 */
import { ethers } from 'hardhat'
import * as fs from 'fs'
import * as path from 'path'

const PABLOCACTUS_EVALUATOR = '0x35eeDdcbE5E1AE01396Cb93Fc8606cE4C713d7BC'
const BUDGET_USDC = '5'
const DELIVERABLE  = 'Data pipeline executed successfully. Processed 4,200 records across 3 sources. Anomaly rate: 0.12%. All validation checks passed. Output schema conforms to spec v2.1.'

async function main() {
  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployments', 'base-sepolia.json'), 'utf-8'))

  const jobManager = await ethers.getContractAt('AgentJobManager', manifest.contracts.AgentJobManager.address, deployer)
  const usdc       = await ethers.getContractAt('MockUSDC', manifest.contracts.MockUSDC.address, deployer)

  // Generate ephemeral client and provider wallets
  const client   = ethers.Wallet.createRandom().connect(ethers.provider)
  const provider = ethers.Wallet.createRandom().connect(ethers.provider)

  console.log(`Client   : ${client.address}`)
  console.log(`Provider : ${provider.address}`)
  console.log(`Evaluator: ${PABLOCACTUS_EVALUATOR} (pablocactus / AHM)`)

  const fd = await ethers.provider.getFeeData()
  const gasOpts = fd.maxFeePerGas != null
    ? { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 2n }
    : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 2n }

  let nonce = await ethers.provider.getTransactionCount(deployer.address, 'pending')

  // Seed client and provider with ETH for gas
  console.log('\nSeeding wallets with ETH…')
  const seedAmount = ethers.parseEther('0.0005')
  const s1 = await deployer.sendTransaction({ to: client.address,   value: seedAmount, ...gasOpts, nonce: nonce++ })
  const s2 = await deployer.sendTransaction({ to: provider.address, value: seedAmount, ...gasOpts, nonce: nonce++ })
  await Promise.all([s1.wait(1), s2.wait(1)])
  console.log('✓ ETH seeded')

  // Mint USDC to client
  const budgetWei = ethers.parseUnits(BUDGET_USDC, 6)
  const mintTx = await usdc.mint(client.address, budgetWei, { ...gasOpts, nonce: nonce++ })
  await mintTx.wait(1)
  console.log(`✓ Minted ${BUDGET_USDC} USDC to client`)

  // Client: createJob with pablocactus as explicit evaluator
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 2 * 60 * 60) // 2h
  const clientJobManager = jobManager.connect(client)
  const clientNonce = await ethers.provider.getTransactionCount(client.address, 'pending')

  const createTx = await clientJobManager.createJob(
    provider.address,
    PABLOCACTUS_EVALUATOR,
    manifest.contracts.MockUSDC.address,
    deadline,
    { ...gasOpts, nonce: clientNonce }
  )
  const createReceipt = await createTx.wait(1)

  // Parse jobId from event
  let jobId = 0n
  for (const log of createReceipt?.logs ?? []) {
    try {
      const parsed = jobManager.interface.parseLog(log)
      if (parsed?.name === 'JobCreated') { jobId = parsed.args.jobId; break }
    } catch {}
  }
  console.log(`✓ Job #${jobId} created — tx: ${createTx.hash}`)

  // Client: setBudget + approve + fund
  let cn = clientNonce + 1
  const setBudgetTx = await clientJobManager.setBudget(jobId, budgetWei, { ...gasOpts, nonce: cn++ })
  await setBudgetTx.wait(1)

  const clientUsdc = usdc.connect(client)
  const approveTx = await clientUsdc.approve(manifest.contracts.AgentJobManager.address, budgetWei, { ...gasOpts, nonce: cn++ })
  await approveTx.wait(1)

  const fundTx = await clientJobManager.fund(jobId, budgetWei, { ...gasOpts, nonce: cn++ })
  await fundTx.wait(1)
  console.log(`✓ Job #${jobId} funded — tx: ${fundTx.hash}`)

  // Provider: submit deliverable
  const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes(DELIVERABLE))
  const providerJobManager = jobManager.connect(provider)
  const providerNonce = await ethers.provider.getTransactionCount(provider.address, 'pending')
  const submitTx = await providerJobManager.submit(jobId, deliverableHash, { ...gasOpts, nonce: providerNonce })
  await submitTx.wait(1)
  console.log(`✓ Job #${jobId} submitted — deliverable hash: ${deliverableHash}`)
  console.log(`  Deliverable: "${DELIVERABLE}"`)
  console.log(`\nJob #${jobId} is now in Submitted state.`)
  console.log(`Pablocactus AHM is watching — waiting for their complete() or reject() call.`)
  console.log(`Basescan: https://sepolia.basescan.org/tx/${submitTx.hash}`)
}

main().catch((err) => { console.error(err.message); process.exitCode = 1 })
