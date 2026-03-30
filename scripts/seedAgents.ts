import { ethers } from "hardhat"

async function main() {
  const [deployer] = await ethers.getSigners()
  const bob   = "0x7F2703972E18f00e73B6B2363d754eDD89cBEb01"
  const alice = "0x38d077611F2A334C560b7a257907672648A8F9EB"

  const amount = ethers.parseEther("0.005")

  console.log(`Deployer: ${deployer.address}`)
  console.log(`Deployer ETH: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))}`)

  for (const [label, addr] of [["Bob", bob], ["Alice", alice]]) {
    const bal = await ethers.provider.getBalance(addr)
    console.log(`${label} (${addr}) ETH: ${ethers.formatEther(bal)}`)
    if (bal < ethers.parseEther("0.002")) {
      const tx = await deployer.sendTransaction({ to: addr, value: amount })
      await tx.wait(1)
      console.log(`  ✓ Funded ${label}: ${tx.hash}`)
    } else {
      console.log(`  — ${label} balance OK, skipping`)
    }
  }
}

main().catch(e => { console.error(e); process.exitCode = 1 })
