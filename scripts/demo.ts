import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

import { AgentJobManager__factory } from "../typechain-types/factories/contracts/core/AgentJobManager.sol/AgentJobManager__factory"
import { MockUSDC__factory } from "../typechain-types/factories/contracts/test/MockUSDC__factory"

// ─── Constants ────────────────────────────────────────────────────────────────

const EXPLORER_BASE = "https://sepolia.basescan.org"
const BUDGET_USDC = "5.00"
const USDC_DECIMALS = 6
// 0.5 % fee rate matches the deployed contract (feeRate = 50 basis points)
const FEE_RATE_BPS = 50n
// Faucet amount — deployer funds each ephemeral wallet with 0.001 ETH for gas
const FAUCET_ETH = ethers.parseEther("0.001")
const FLOOR_GAS = 100_000_000n // 0.1 gwei minimum

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeploymentManifest {
  network: string
  chainId: number
  deployer: string
  contracts: {
    MockUSDC: { address: string }
    AgentJobManager: { address: string }
  }
  config: {
    feeRate: number
    feeRecipient: string
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function basescanTx(txHash: string): string {
  return `${EXPLORER_BASE}/tx/${txHash}`
}

function basescanAddress(address: string): string {
  return `${EXPLORER_BASE}/address/${address}`
}

/** Formats an address as a short readable label (first 8 chars after 0x). */
function shortAddr(address: string): string {
  return address.slice(0, 8) + "..."
}

/** Pads a label to a fixed width for aligned output. */
function pad(label: string, width = 18): string {
  return label.padEnd(width)
}

/** Returns fresh EIP-1559 gas overrides with a manual nonce.
 *
 * We multiply the network's suggested fees by 10x to ensure fast inclusion
 * on Base Sepolia, then floor at 0.1 gwei to handle near-zero fee periods.
 * The nonce comes from the caller's counter so concurrent transactions from
 * the same wallet are sequenced correctly without RPC propagation race conditions.
 */
async function buildGasOverrides(
  provider: ethers.Provider,
  nonce: number,
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; nonce: number }> {
  const fd = await provider.getFeeData()
  const base = fd.maxFeePerGas ?? 1_000_000_000n
  const priority = fd.maxPriorityFeePerGas ?? base

  return {
    maxFeePerGas: base * 10n > FLOOR_GAS ? base * 10n : FLOOR_GAS,
    maxPriorityFeePerGas: priority * 10n > FLOOR_GAS ? priority * 10n : FLOOR_GAS,
    nonce,
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // ── Banner ────────────────────────────────────────────────────────────────
  console.log()
  console.log("╔══════════════════════════════════════════════════════════════╗")
  console.log("║         Agent Settlement Protocol — Live Demo                ║")
  console.log("║         ERC-8183 Reference Implementation on Base Sepolia    ║")
  console.log("╚══════════════════════════════════════════════════════════════╝")
  console.log()

  // ── Load deployment manifest ──────────────────────────────────────────────
  const manifestPath = path.join(__dirname, "../deployments/base-sepolia.json")
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Deployment manifest not found at ${manifestPath}. ` +
        "Run `npm run deploy:testnet` first.",
    )
  }
  const manifest: DeploymentManifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf-8"),
  )

  // ── Network info ──────────────────────────────────────────────────────────
  const network = await ethers.provider.getNetwork()
  const chainId = Number(network.chainId)

  console.log(`Network  : ${manifest.network} (chainId ${chainId})`)
  console.log(`Contract : ${manifest.contracts.AgentJobManager.address}`)
  console.log(`Explorer : ${basescanAddress(manifest.contracts.AgentJobManager.address)}`)
  console.log()

  // ── Deployer wallet (evaluator role) ─────────────────────────────────────
  // The deployer is loaded via Hardhat's configured accounts (PRIVATE_KEY in .env).
  // It plays the evaluator because the deployed contract uses manifest.deployer
  // as the evaluator address for all jobs created through this demo.
  const [deployer] = await ethers.getSigners()

  // Guard: ensure the deployer matches the manifest to avoid using the wrong
  // account when the .env has been rotated since the last deployment.
  if (deployer.address.toLowerCase() !== manifest.deployer.toLowerCase()) {
    throw new Error(
      `Signer mismatch: hardhat signer is ${deployer.address} ` +
        `but manifest.deployer is ${manifest.deployer}. ` +
        "Ensure PRIVATE_KEY in .env matches the deployment key.",
    )
  }

  // ── Ephemeral wallets for Alice and Bob ───────────────────────────────────
  // Alice and Bob are created fresh each run so the demo requires no pre-setup.
  // The deployer funds them with a small amount of ETH to cover gas costs.
  const alice = ethers.Wallet.createRandom().connect(ethers.provider)
  const bob = ethers.Wallet.createRandom().connect(ethers.provider)

  // ── Display wallet addresses and initial ETH balances ────────────────────
  const [deployerEth, aliceEth, bobEth] = await Promise.all([
    ethers.provider.getBalance(deployer.address),
    ethers.provider.getBalance(alice.address),
    ethers.provider.getBalance(bob.address),
  ])

  console.log("── Wallets ──────────────────────────────────────────────────")
  console.log(
    `  ${pad("Alice (client)")}  : ${shortAddr(alice.address)}  ETH: ${ethers.formatEther(aliceEth)}`,
  )
  console.log(
    `  ${pad("Bob   (provider)")}  : ${shortAddr(bob.address)}  ETH: ${ethers.formatEther(bobEth)}`,
  )
  console.log(
    `  ${pad("Deployer (eval)")}  : ${shortAddr(deployer.address)}  ETH: ${ethers.formatEther(deployerEth)}`,
  )
  console.log()

  // ── Faucet: fund Alice and Bob with ETH for gas ───────────────────────────
  // Without ETH, the ephemeral wallets cannot pay for any transaction.
  // The deployer sends 0.001 ETH to each wallet before proceeding.
  console.log("── Faucet ───────────────────────────────────────────────────")

  let deployerNonce = await ethers.provider.getTransactionCount(
    deployer.address,
    "pending",
  )

  const faucetAliceTx = await deployer.sendTransaction({
    to: alice.address,
    value: FAUCET_ETH,
    ...(await buildGasOverrides(ethers.provider, deployerNonce++)),
  })
  await faucetAliceTx.wait(1)
  console.log(`  Funded Alice with 0.001 ETH  tx: ${basescanTx(faucetAliceTx.hash)}`)

  const faucetBobTx = await deployer.sendTransaction({
    to: bob.address,
    value: FAUCET_ETH,
    ...(await buildGasOverrides(ethers.provider, deployerNonce++)),
  })
  await faucetBobTx.wait(1)
  console.log(`  Funded Bob   with 0.001 ETH  tx: ${basescanTx(faucetBobTx.hash)}`)
  console.log()

  // ── Connect contracts ─────────────────────────────────────────────────────
  // Alice is the client, so her signer is used for createJob / setBudget / fund.
  // Bob's signer is used for submit.
  // The deployer's signer is used for complete (evaluator role).
  const jobManagerAsAlice = AgentJobManager__factory.connect(
    manifest.contracts.AgentJobManager.address,
    alice,
  )
  const jobManagerAsBob = AgentJobManager__factory.connect(
    manifest.contracts.AgentJobManager.address,
    bob,
  )
  const jobManagerAsDeployer = AgentJobManager__factory.connect(
    manifest.contracts.AgentJobManager.address,
    deployer,
  )
  const mockUSDCAsAlice = MockUSDC__factory.connect(
    manifest.contracts.MockUSDC.address,
    alice,
  )

  // ── Step 1: Create Job ────────────────────────────────────────────────────
  console.log("── Step 1: Create Job ───────────────────────────────────────")

  const budgetWei = ethers.parseUnits(BUDGET_USDC, USDC_DECIMALS)
  // Deadline 60 minutes from now — well within the contract's allowed range
  const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + 60 * 60)

  console.log(
    `  createJob(provider=Bob, evaluator=deployer, token=MockUSDC)`,
  )

  let aliceNonce = await ethers.provider.getTransactionCount(
    alice.address,
    "pending",
  )

  const createGas = await jobManagerAsAlice.createJob.estimateGas(
    bob.address,
    deployer.address,
    manifest.contracts.MockUSDC.address,
    deadlineTimestamp,
  )
  const createTx = await jobManagerAsAlice.createJob(
    bob.address,
    deployer.address,
    manifest.contracts.MockUSDC.address,
    deadlineTimestamp,
    { gasLimit: (createGas * 120n) / 100n, ...(await buildGasOverrides(ethers.provider, aliceNonce++)) },
  )
  const createReceipt = await createTx.wait(1)
  if (!createReceipt || createReceipt.status === 0) {
    throw new Error(`createJob transaction failed: ${basescanTx(createTx.hash)}`)
  }

  // Parse JobCreated event to extract the on-chain jobId assigned by the contract
  const jobCreatedLog = createReceipt.logs
    .map((log) => {
      try {
        return jobManagerAsAlice.interface.parseLog(log)
      } catch {
        return null
      }
    })
    .find((parsed) => parsed?.name === "JobCreated")

  if (!jobCreatedLog) {
    throw new Error("JobCreated event not found in createJob receipt")
  }

  const jobId: bigint = jobCreatedLog.args[0] as bigint

  // Brief pause so the RPC node registers the state change before the next call.
  // Without this, setBudget.estimateGas can return JobNotFound on nodes with lag.
  await new Promise((resolve) => setTimeout(resolve, 2000))

  console.log(`  setBudget(${BUDGET_USDC} USDC)`)
  const setBudgetGas = await jobManagerAsAlice.setBudget.estimateGas(
    jobId,
    budgetWei,
  )
  const setBudgetTx = await jobManagerAsAlice.setBudget(jobId, budgetWei, {
    gasLimit: (setBudgetGas * 120n) / 100n,
    ...(await buildGasOverrides(ethers.provider, aliceNonce++)),
  })
  const setBudgetReceipt = await setBudgetTx.wait(1)
  if (!setBudgetReceipt || setBudgetReceipt.status === 0) {
    throw new Error(`setBudget transaction failed: ${basescanTx(setBudgetTx.hash)}`)
  }

  // Mint MockUSDC to Alice so she has funds to cover the job budget.
  // On Base Sepolia the real USDC requires a whitelist, so we use this
  // permissionless test token that allows free minting by anyone.
  const mintGas = await mockUSDCAsAlice.mint.estimateGas(
    alice.address,
    budgetWei,
  )
  const mintTx = await mockUSDCAsAlice.mint(alice.address, budgetWei, {
    gasLimit: (mintGas * 120n) / 100n,
    ...(await buildGasOverrides(ethers.provider, aliceNonce++)),
  })
  await mintTx.wait(1)

  // Approve the maximum possible allowance so Alice never needs a second approval
  // transaction when funding additional jobs with the same token in this session.
  const approveGas = await mockUSDCAsAlice.approve.estimateGas(
    manifest.contracts.AgentJobManager.address,
    ethers.MaxUint256,
  )
  const approveTx = await mockUSDCAsAlice.approve(
    manifest.contracts.AgentJobManager.address,
    ethers.MaxUint256,
    {
      gasLimit: (approveGas * 120n) / 100n,
      ...(await buildGasOverrides(ethers.provider, aliceNonce++)),
    },
  )
  await approveTx.wait(1)

  console.log(
    `  fund() — Alice locks ${BUDGET_USDC} USDC in escrow`,
  )

  // Read Alice's USDC balance before funding for the settlement summary
  const aliceUSDCBefore = await mockUSDCAsAlice.balanceOf(alice.address)
  const bobUSDCBefore = await mockUSDCAsAlice.balanceOf(bob.address)

  const fundGas = await jobManagerAsAlice.fund.estimateGas(jobId, budgetWei)
  const fundTx = await jobManagerAsAlice.fund(jobId, budgetWei, {
    gasLimit: (fundGas * 120n) / 100n,
    ...(await buildGasOverrides(ethers.provider, aliceNonce++)),
  })
  const fundReceipt = await fundTx.wait(1)
  if (!fundReceipt || fundReceipt.status === 0) {
    throw new Error(`fund transaction failed: ${basescanTx(fundTx.hash)}`)
  }

  console.log(
    `  \u2713 Job #${jobId} created  \u2192  ${basescanTx(fundTx.hash)}`,
  )
  console.log()

  // ── Step 2: Submit ────────────────────────────────────────────────────────
  console.log("── Step 2: Submit ───────────────────────────────────────────")

  // ERC-8183 submit() takes a bytes32 hash — the raw deliverable is stored
  // off-chain (IPFS, S3, etc.) and only its fingerprint goes on-chain.
  const deliverableText = `Rapport de recherche IA — tâche #${jobId} complétée`
  const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes(deliverableText))

  console.log("  Bob submits deliverable hash")

  let bobNonce = await ethers.provider.getTransactionCount(bob.address, "pending")

  const submitGas = await jobManagerAsBob.submit.estimateGas(jobId, deliverableHash)
  const submitTx = await jobManagerAsBob.submit(jobId, deliverableHash, {
    gasLimit: (submitGas * 120n) / 100n,
    ...(await buildGasOverrides(ethers.provider, bobNonce++)),
  })
  const submitReceipt = await submitTx.wait(1)
  if (!submitReceipt || submitReceipt.status === 0) {
    throw new Error(`submit transaction failed: ${basescanTx(submitTx.hash)}`)
  }

  console.log(`  \u2713 Submitted  \u2192  ${basescanTx(submitTx.hash)}`)
  console.log()

  // ── Step 3: Complete ──────────────────────────────────────────────────────
  console.log("── Step 3: Complete ─────────────────────────────────────────")
  console.log("  Evaluator approves")

  // The reason field is bytes32 on-chain — encode the human-readable string.
  // We trim to 31 chars because encodeBytes32String requires < 32 bytes.
  const reasonStr = "Deliverable accepted"
  const reasonBytes = ethers.encodeBytes32String(reasonStr.slice(0, 31))

  const completeGas = await jobManagerAsDeployer.complete.estimateGas(
    jobId,
    reasonBytes,
  )
  const completeTx = await jobManagerAsDeployer.complete(jobId, reasonBytes, {
    gasLimit: (completeGas * 120n) / 100n,
    ...(await buildGasOverrides(ethers.provider, deployerNonce++)),
  })
  const completeReceipt = await completeTx.wait(1)
  if (!completeReceipt || completeReceipt.status === 0) {
    throw new Error(`complete transaction failed: ${basescanTx(completeTx.hash)}`)
  }

  console.log(`  \u2713 Completed  \u2192  ${basescanTx(completeTx.hash)}`)
  console.log()

  // ── Settlement summary ────────────────────────────────────────────────────
  const bobUSDCAfter = await mockUSDCAsAlice.balanceOf(bob.address)
  const feeRecipientBalance = await mockUSDCAsAlice.balanceOf(
    manifest.config.feeRecipient,
  )

  // Reconstruct payment and fee amounts from first principles for a clear display.
  // The fee is floor(budget * feeRate / 10000) as computed by the contract.
  const feeWei = (budgetWei * FEE_RATE_BPS) / 10_000n
  const paymentWei = budgetWei - feeWei

  console.log("── Settlement ───────────────────────────────────────────────")
  console.log(
    `  ${pad("Budget")} :  ${ethers.formatUnits(budgetWei, USDC_DECIMALS)} USDC`,
  )
  console.log(
    `  ${pad(`Fee (${Number(FEE_RATE_BPS) / 100}%)`)} :  ${ethers.formatUnits(feeWei, USDC_DECIMALS)} USDC  \u2192  feeRecipient`,
  )
  console.log(
    `  ${pad("Payment")} :  ${ethers.formatUnits(paymentWei, USDC_DECIMALS)} USDC  \u2192  Bob \u2713`,
  )
  console.log()
  console.log(
    `  Bob balance before : ${ethers.formatUnits(bobUSDCBefore, USDC_DECIMALS)} USDC`,
  )
  console.log(
    `  Bob balance after  : ${ethers.formatUnits(bobUSDCAfter, USDC_DECIMALS)} USDC`,
  )
  console.log()

  // Verify the settlement numbers match what the contract actually transferred
  const actualPayment = bobUSDCAfter - bobUSDCBefore
  if (actualPayment !== paymentWei) {
    console.warn(
      `  WARNING: expected payment ${ethers.formatUnits(paymentWei, USDC_DECIMALS)} USDC ` +
        `but Bob received ${ethers.formatUnits(actualPayment, USDC_DECIMALS)} USDC`,
    )
  }

  console.log("── Done ─────────────────────────────────────────────────────")
  console.log(`  Job #${jobId} completed successfully.`)
  console.log(
    `  View contract: ${basescanAddress(manifest.contracts.AgentJobManager.address)}`,
  )
  console.log()

  // ── Scenario 2: Reject + reopen (optional, --full flag) ───────────────────
  const fullDemo = process.argv.includes("--full")
  if (!fullDemo) {
    console.log(
      "  Tip: pass --full to run the reject+reopen scenario as well.",
    )
    console.log()
    return
  }

  console.log()
  console.log("── Scenario 2: Reject + Reopen ──────────────────────────────")
  console.log()

  // Create a second ephemeral wallet pair for clarity
  const alice2 = ethers.Wallet.createRandom().connect(ethers.provider)
  const bob2 = ethers.Wallet.createRandom().connect(ethers.provider)

  // Fund them from the deployer
  const faucet2Alice = await deployer.sendTransaction({
    to: alice2.address,
    value: FAUCET_ETH,
    ...(await buildGasOverrides(ethers.provider, deployerNonce++)),
  })
  await faucet2Alice.wait(1)

  const faucet2Bob = await deployer.sendTransaction({
    to: bob2.address,
    value: FAUCET_ETH,
    ...(await buildGasOverrides(ethers.provider, deployerNonce++)),
  })
  await faucet2Bob.wait(1)

  const jm2Alice = AgentJobManager__factory.connect(
    manifest.contracts.AgentJobManager.address,
    alice2,
  )
  const jm2Bob = AgentJobManager__factory.connect(
    manifest.contracts.AgentJobManager.address,
    bob2,
  )
  const jm2Deployer = AgentJobManager__factory.connect(
    manifest.contracts.AgentJobManager.address,
    deployer,
  )
  const usdc2Alice = MockUSDC__factory.connect(
    manifest.contracts.MockUSDC.address,
    alice2,
  )

  let alice2Nonce = await ethers.provider.getTransactionCount(
    alice2.address,
    "pending",
  )

  const deadline2 = BigInt(Math.floor(Date.now() / 1000) + 60 * 60)

  // createJob
  const cg2 = await jm2Alice.createJob.estimateGas(
    bob2.address,
    deployer.address,
    manifest.contracts.MockUSDC.address,
    deadline2,
  )
  const ct2 = await jm2Alice.createJob(
    bob2.address,
    deployer.address,
    manifest.contracts.MockUSDC.address,
    deadline2,
    { gasLimit: (cg2 * 120n) / 100n, ...(await buildGasOverrides(ethers.provider, alice2Nonce++)) },
  )
  const cr2 = await ct2.wait(1)
  if (!cr2 || cr2.status === 0) throw new Error("createJob (scenario 2) failed")

  const jcl2 = cr2.logs
    .map((l) => { try { return jm2Alice.interface.parseLog(l) } catch { return null } })
    .find((p) => p?.name === "JobCreated")
  if (!jcl2) throw new Error("JobCreated event not found (scenario 2)")
  const jobId2: bigint = jcl2.args[0] as bigint

  await new Promise((resolve) => setTimeout(resolve, 2000))

  // setBudget
  const sbg2 = await jm2Alice.setBudget.estimateGas(jobId2, budgetWei)
  const sbt2 = await jm2Alice.setBudget(jobId2, budgetWei, {
    gasLimit: (sbg2 * 120n) / 100n,
    ...(await buildGasOverrides(ethers.provider, alice2Nonce++)),
  })
  await sbt2.wait(1)

  // mint + approve + fund
  const mg2 = await usdc2Alice.mint.estimateGas(alice2.address, budgetWei)
  const mt2 = await usdc2Alice.mint(alice2.address, budgetWei, {
    gasLimit: (mg2 * 120n) / 100n,
    ...(await buildGasOverrides(ethers.provider, alice2Nonce++)),
  })
  await mt2.wait(1)

  const ag2 = await usdc2Alice.approve.estimateGas(
    manifest.contracts.AgentJobManager.address,
    ethers.MaxUint256,
  )
  const at2 = await usdc2Alice.approve(
    manifest.contracts.AgentJobManager.address,
    ethers.MaxUint256,
    { gasLimit: (ag2 * 120n) / 100n, ...(await buildGasOverrides(ethers.provider, alice2Nonce++)) },
  )
  await at2.wait(1)

  const fg2 = await jm2Alice.fund.estimateGas(jobId2, budgetWei)
  const ft2 = await jm2Alice.fund(jobId2, budgetWei, {
    gasLimit: (fg2 * 120n) / 100n,
    ...(await buildGasOverrides(ethers.provider, alice2Nonce++)),
  })
  await ft2.wait(1)
  console.log(`  Job #${jobId2} created and funded  \u2192  ${basescanTx(ft2.hash)}`)

  // Bob submits
  let bob2Nonce = await ethers.provider.getTransactionCount(bob2.address, "pending")
  const deliverable2Hash = ethers.keccak256(ethers.toUtf8Bytes(`Rapport IA tâche #${jobId2} — draft v1`))
  const sg2 = await jm2Bob.submit.estimateGas(jobId2, deliverable2Hash)
  const st2 = await jm2Bob.submit(jobId2, deliverable2Hash, {
    gasLimit: (sg2 * 120n) / 100n,
    ...(await buildGasOverrides(ethers.provider, bob2Nonce++)),
  })
  await st2.wait(1)
  console.log(`  Bob submits deliverable  \u2192  ${basescanTx(st2.hash)}`)

  // Evaluator rejects — funds return to Alice
  const rejectReason = ethers.encodeBytes32String("Quality insufficient")
  const aliceUSDCBeforeReject = await usdc2Alice.balanceOf(alice2.address)

  const rg2 = await jm2Deployer.reject.estimateGas(jobId2, rejectReason)
  const rt2 = await jm2Deployer.reject(jobId2, rejectReason, {
    gasLimit: (rg2 * 120n) / 100n,
    ...(await buildGasOverrides(ethers.provider, deployerNonce++)),
  })
  await rt2.wait(1)
  console.log(`  Evaluator rejects  \u2192  ${basescanTx(rt2.hash)}`)

  const aliceUSDCAfterReject = await usdc2Alice.balanceOf(alice2.address)
  const refunded = aliceUSDCAfterReject - aliceUSDCBeforeReject
  console.log()
  console.log(
    `  Alice refunded : ${ethers.formatUnits(refunded, USDC_DECIMALS)} USDC  (expected ${BUDGET_USDC} USDC)`,
  )
  console.log()
  console.log(`  Job #${jobId2} rejected — funds returned to Alice. \u2713`)
  console.log()

  console.log("╔══════════════════════════════════════════════════════════════╗")
  console.log("║   Demo complete — both scenarios executed successfully.      ║")
  console.log("╚══════════════════════════════════════════════════════════════╝")
  console.log()
}

// ─── Entry point ──────────────────────────────────────────────────────────────

main().catch((err: unknown) => {
  console.error("\n  FATAL: Demo failed:")
  console.error(err)
  process.exitCode = 1
})
