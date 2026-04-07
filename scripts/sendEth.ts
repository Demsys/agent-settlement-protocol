/**
 * sendEth.ts — send Base Sepolia ETH from deployer to any address
 * Usage: RECIPIENT=0x... AMOUNT=0.005 npx hardhat run scripts/sendEth.ts --network base-sepolia
 */
import { ethers } from 'hardhat'

async function main() {
  const to = process.env.RECIPIENT
  if (!to || !ethers.isAddress(to)) throw new Error('RECIPIENT env var required (valid address)')
  const amount = process.env.AMOUNT ?? '0.005'

  const [deployer] = await ethers.getSigners()
  const fd = await ethers.provider.getFeeData()
  const gas = fd.maxFeePerGas != null
    ? { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 2n }
    : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 2n }

  const tx = await deployer.sendTransaction({ to, value: ethers.parseEther(amount), ...gas })
  await tx.wait(1)
  console.log(`✓ Sent ${amount} ETH to ${to} — tx: ${tx.hash}`)
}

main().catch((err) => { console.error(err.message); process.exitCode = 1 })
