/**
 * setWarmupPeriod.ts
 *
 * Reduces the EvaluatorRegistry warmup period from the default 7 days to 1 day
 * (the allowed minimum) to speed up testnet bootstrapping.
 * setWarmupPeriod() is NOT timelocked — takes effect immediately.
 *
 * Usage:
 *   npx hardhat run scripts/setWarmupPeriod.ts --network base-sepolia
 */
import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8")
  )
  const registry = await ethers.getContractAt("EvaluatorRegistry", manifest.contracts.EvaluatorRegistry.address, deployer)

  const current = await registry.warmupPeriod()
  console.log(`Current warmupPeriod : ${Number(current) / 86400} days (${current}s)`)

  const ONE_DAY = 86_400n

  if (current === ONE_DAY) {
    console.log("✓ Already 1 day — nothing to do.")
    return
  }

  const fd = await ethers.provider.getFeeData()
  const gas = fd.maxFeePerGas != null
    ? { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 2n }
    : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 2n }

  const tx = await registry.setWarmupPeriod(ONE_DAY, gas)
  await tx.wait(1)
  console.log(`✓ warmupPeriod set to 1 day — tx: ${tx.hash}`)

  const updated = await registry.warmupPeriod()
  console.log(`New warmupPeriod : ${Number(updated) / 86400} days`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
