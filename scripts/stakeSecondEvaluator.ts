/**
 * stakeSecondEvaluator.ts
 *
 * Run this script with the SECOND wallet's private key to stake as evaluator.
 *
 * Usage:
 *   PRIVATE_KEY=<second-wallet-key> npx hardhat run scripts/stakeSecondEvaluator.ts --network base-sepolia
 */
import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const [signer] = await ethers.getSigners()
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8"))

  const token    = await ethers.getContractAt("ProtocolToken",    manifest.contracts.ProtocolToken.address,    signer)
  const registry = await ethers.getContractAt("EvaluatorRegistry", manifest.contracts.EvaluatorRegistry.address, signer)

  const minStake   = await registry.minEvaluatorStake()
  const vrtBal     = await token.balanceOf(signer.address)
  const ethBal     = await ethers.provider.getBalance(signer.address)
  const isEligible = await registry.isEligible(signer.address)

  console.log(`\nWallet    : ${signer.address}`)
  console.log(`ETH       : ${ethers.formatEther(ethBal)}`)
  console.log(`VRT       : ${ethers.formatEther(vrtBal)}`)
  console.log(`Min stake : ${ethers.formatEther(minStake)} VRT`)
  console.log(`Eligible  : ${isEligible}`)

  if (isEligible) {
    console.log("\n✓ Already eligible — nothing to do.")
    return
  }
  if (vrtBal < minStake) {
    console.error(`\n✗ Not enough VRT (have ${ethers.formatEther(vrtBal)}, need ${ethers.formatEther(minStake)})`)
    process.exitCode = 1
    return
  }

  const fd = await ethers.provider.getFeeData()
  const gas = (n: number) => fd.maxFeePerGas != null
    ? { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 2n, nonce: n }
    : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 2n, nonce: n }

  let nonce = await ethers.provider.getTransactionCount(signer.address, "pending")

  // 1. Approve
  console.log(`\n1. Approving ${ethers.formatEther(minStake)} VRT to EvaluatorRegistry…`)
  const approveTx = await token.approve(manifest.contracts.EvaluatorRegistry.address, minStake, gas(nonce++))
  await approveTx.wait(1)
  console.log(`   ✓ tx: ${approveTx.hash}`)

  // 2. Stake
  console.log(`\n2. Staking ${ethers.formatEther(minStake)} VRT…`)
  const stakeTx = await registry.stake(minStake, gas(nonce++))
  await stakeTx.wait(1)
  console.log(`   ✓ tx: ${stakeTx.hash}`)

  const eligible = await registry.isEligible(signer.address)
  console.log(`\nEligible now : ${eligible}`)
  console.log(eligible
    ? "✓ You are now an active evaluator."
    : "⚠  Warmup period not yet elapsed (1 day). Check back tomorrow.")
}

main().catch(e => { console.error(e); process.exitCode = 1 })
