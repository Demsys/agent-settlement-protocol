import { ethers } from "hardhat"

async function main() {
  const [signer] = await ethers.getSigners()
  const address = signer.address
  
  // Nonce confirmé (transactions minées)
  const confirmedNonce = await ethers.provider.getTransactionCount(address, "latest")
  // Nonce pending (inclut les tx en attente)
  const pendingNonce = await ethers.provider.getTransactionCount(address, "pending")
  
  console.log(`Address : ${address}`)
  console.log(`Confirmed nonce : ${confirmedNonce}`)
  console.log(`Pending nonce   : ${pendingNonce}`)
  console.log(`Transactions à annuler : ${pendingNonce - confirmedNonce}`)

  const feeData = await ethers.provider.getFeeData()
  // 3x le gas price suggéré pour être sûr d'écraser les pending
  const gasPrice = (feeData.gasPrice ?? 1000000000n) * 3n

  console.log(`\nGas price utilisé : ${ethers.formatUnits(gasPrice, "gwei")} gwei\n`)

  for (let nonce = confirmedNonce; nonce < pendingNonce; nonce++) {
    const tx = await signer.sendTransaction({
      to: address,
      value: 0n,
      nonce,
      gasPrice,
      gasLimit: 21000n,
    })
    console.log(`  ✓ Annulation nonce ${nonce} — tx: ${tx.hash}`)
    await tx.wait(1)
    console.log(`    confirmée`)
  }

  console.log("\nToutes les transactions pending ont été annulées.")
}

main().catch(console.error)
