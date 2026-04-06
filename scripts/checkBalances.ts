import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8")
  )
  const usdc = await ethers.getContractAt("MockUSDC", manifest.contracts.MockUSDC.address)

  const wallets = [
    { name: "Alice", address: "0x38d077611F2A334C560b7a257907672648A8F9EB" },
    { name: "Bob",   address: "0x7F2703972E18f00e73B6B2363d754eDD89cBEb01" },
  ]

  for (const w of wallets) {
    const eth  = await ethers.provider.getBalance(w.address)
    const usdc_ = await usdc.balanceOf(w.address)
    console.log(`${w.name} (${w.address})`)
    console.log(`  ETH  : ${ethers.formatEther(eth)}`)
    console.log(`  USDC : ${ethers.formatUnits(usdc_, 6)}`)
  }
}

main().catch(console.error)
