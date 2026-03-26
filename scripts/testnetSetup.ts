/**
 * testnetSetup.ts
 * Configures the EvaluatorRegistry for testnet operation:
 *   1. Sets warmupPeriod to 0 (no wait needed on testnet)
 *   2. Verifies deployer is now eligible as evaluator
 */
import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8")
  )
  const registry = await ethers.getContractAt(
    "EvaluatorRegistry",
    manifest.contracts.EvaluatorRegistry.address,
    deployer,
  )

  const fd = await ethers.provider.getFeeData()
  const gas = fd.maxFeePerGas != null
    ? { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 2n }
    : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 2n }

  console.log("\nSetting warmupPeriod to 0…")
  const tx = await registry.setWarmupPeriod(0, gas)
  await tx.wait(1)
  console.log(`  ✓ warmupPeriod = 0 — tx: ${tx.hash}`)

  const eligible = await registry.isEligible(deployer.address)
  console.log(`\nDeployer eligible: ${eligible}`)
  if (eligible) {
    console.log("  ✓ Deployer is now a valid evaluator. testnet ready.")
  } else {
    console.log("  ✗ Still not eligible — check stake amount.")
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
