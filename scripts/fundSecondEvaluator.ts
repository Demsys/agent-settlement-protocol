/**
 * Funds the second evaluator wallet with ETH (gas) and VRT (stake).
 * Run from the deployer wallet — it sends funds to the target address.
 */
import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

const SECOND_WALLET = "0x06C1e576A107Aa417D305b817C75841aAb112758"
const ETH_FOR_GAS   = ethers.parseEther("0.005")   // ~200 txs on Base Sepolia
const VRT_FOR_STAKE = ethers.parseEther("100")      // exactly minEvaluatorStake

async function main() {
  const [deployer] = await ethers.getSigners()
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8"))
  const token = await ethers.getContractAt("ProtocolToken", manifest.contracts.ProtocolToken.address, deployer)

  const fd = await ethers.provider.getFeeData()
  const gas = fd.maxFeePerGas != null
    ? { maxFeePerGas: fd.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 2n }
    : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 2n }

  let nonce = await ethers.provider.getTransactionCount(deployer.address, "pending")

  console.log(`\nFunding second evaluator: ${SECOND_WALLET}`)

  // 1. Send ETH for gas
  console.log(`\n1. Sending ${ethers.formatEther(ETH_FOR_GAS)} ETH for gas…`)
  const ethTx = await deployer.sendTransaction({ to: SECOND_WALLET, value: ETH_FOR_GAS, ...gas, nonce: nonce++ })
  await ethTx.wait(1)
  console.log(`   ✓ tx: ${ethTx.hash}`)

  // 2. Transfer VRT
  console.log(`\n2. Transferring ${ethers.formatEther(VRT_FOR_STAKE)} VRT…`)
  const fd2 = await ethers.provider.getFeeData()
  const gas2 = fd2.maxFeePerGas != null
    ? { maxFeePerGas: fd2.maxFeePerGas * 2n, maxPriorityFeePerGas: (fd2.maxPriorityFeePerGas ?? fd2.maxFeePerGas) * 2n, nonce: nonce++ }
    : { gasPrice: (fd2.gasPrice ?? 1_000_000_000n) * 2n, nonce: nonce++ }
  const vrtTx = await token.transfer(SECOND_WALLET, VRT_FOR_STAKE, gas2)
  await vrtTx.wait(1)
  console.log(`   ✓ tx: ${vrtTx.hash}`)

  // Verify
  const ethBal = await ethers.provider.getBalance(SECOND_WALLET)
  const vrtBal = await token.balanceOf(SECOND_WALLET)
  console.log(`\nSecond wallet balances:`)
  console.log(`   ETH : ${ethers.formatEther(ethBal)}`)
  console.log(`   VRT : ${ethers.formatEther(vrtBal)}`)
  console.log(`\n✓ Ready. Now run scripts/stakeSecondEvaluator.ts with the second wallet's private key.`)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
