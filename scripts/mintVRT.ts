/**
 * mintVRT.ts
 * Mints ProtocolToken (VRT) to a given address.
 * Usage:
 *   RECIPIENT=0x... AMOUNT=100 npx hardhat run scripts/mintVRT.ts --network base-sepolia
 */
import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8")
  )

  const recipient = process.env.RECIPIENT
  const amount = process.env.AMOUNT ?? "100"

  if (!recipient || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    throw new Error("RECIPIENT env var must be a valid 0x address")
  }

  const token = await ethers.getContractAt("ProtocolToken", manifest.contracts.ProtocolToken.address, deployer)
  const amountWei = ethers.parseEther(amount)

  console.log(`\nMinting ${amount} VRT to ${recipient}…`)
  const fd = await ethers.provider.getFeeData()
  const gas = fd.maxFeePerGas != null
    ? { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 2n }
    : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 2n }

  const tx = await (token as any).mint(recipient, amountWei, gas)
  await tx.wait(1)
  console.log(`✓ Minted — tx: ${tx.hash}`)

  const bal = await token.balanceOf(recipient)
  console.log(`Balance of ${recipient}: ${ethers.formatEther(bal)} VRT`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
