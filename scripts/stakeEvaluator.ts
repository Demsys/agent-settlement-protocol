/**
 * stakeEvaluator.ts
 * Stakes the deployer wallet as an evaluator in EvaluatorRegistry.
 * Required for testnet operation: the deployer acts as the evaluator for MVP jobs.
 */
import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8")
  )

  const token    = await ethers.getContractAt("ProtocolToken",    manifest.contracts.ProtocolToken.address,    deployer)
  const registry = await ethers.getContractAt("EvaluatorRegistry", manifest.contracts.EvaluatorRegistry.address, deployer)

  const minStake   = await registry.minEvaluatorStake()
  const bal        = await token.balanceOf(deployer.address)
  const isEligible = await registry.isEligible(deployer.address)

  console.log(`\nDeployer:   ${deployer.address}`)
  console.log(`Balance:    ${ethers.formatEther(bal)} VRT`)
  console.log(`Min stake:  ${ethers.formatEther(minStake)} VRT`)
  console.log(`Eligible:   ${isEligible}`)

  if (isEligible) {
    console.log("\nDeployer is already eligible — nothing to do.")
    return
  }

  // Mint tokens if balance is insufficient
  if (bal < minStake) {
    console.log(`\nMinting ${ethers.formatEther(minStake)} VRT to deployer…`)
    const fd = await ethers.provider.getFeeData()
    const gas = fd.maxFeePerGas != null
      ? { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 2n }
      : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 2n }

    const mintTx = await (token as any).mint(deployer.address, minStake, gas)
    await mintTx.wait(1)
    console.log(`  ✓ Minted — tx: ${mintTx.hash}`)
  }

  // Approve registry
  console.log(`\nApproving EvaluatorRegistry for ${ethers.formatEther(minStake)} VRT…`)
  const fd1 = await ethers.provider.getFeeData()
  const gas1 = fd1.maxFeePerGas != null
    ? { maxFeePerGas: fd1.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd1.maxPriorityFeePerGas ?? fd1.maxFeePerGas) * 2n }
    : { gasPrice: (fd1.gasPrice ?? 1_000_000_000n) * 2n }
  const approveTx = await token.approve(manifest.contracts.EvaluatorRegistry.address, minStake, gas1)
  await approveTx.wait(1)
  console.log(`  ✓ Approved — tx: ${approveTx.hash}`)

  // Stake
  console.log(`\nStaking ${ethers.formatEther(minStake)} VRT…`)
  const fd2 = await ethers.provider.getFeeData()
  const gas2 = fd2.maxFeePerGas != null
    ? { maxFeePerGas: fd2.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd2.maxPriorityFeePerGas ?? fd2.maxFeePerGas) * 2n }
    : { gasPrice: (fd2.gasPrice ?? 1_000_000_000n) * 2n }
  const stakeTx = await registry.stake(minStake, gas2)
  await stakeTx.wait(1)
  console.log(`  ✓ Staked — tx: ${stakeTx.hash}`)

  // Verify
  const eligible = await registry.isEligible(deployer.address)
  console.log(`\nIs eligible now: ${eligible}`)
  if (!eligible) {
    console.log("  ⚠  Not eligible yet — warmup period may apply. Wait and re-check.")
  } else {
    console.log("  ✓ Deployer is now an eligible evaluator.")
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
