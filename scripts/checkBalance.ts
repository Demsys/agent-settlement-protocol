import { ethers } from "hardhat"
async function main() {
  const [d] = await ethers.getSigners()
  const b = await ethers.provider.getBalance(d.address)
  console.log(`Deployer: ${d.address}`)
  console.log(`ETH balance: ${ethers.formatEther(b)} ETH`)
}
main().catch(console.error)
