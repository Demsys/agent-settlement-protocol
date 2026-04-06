import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8"))
  const token = await ethers.getContractAt("ProtocolToken", manifest.contracts.ProtocolToken.address)
  const addr = "0xB4B9Cb85A2642719ba919b0C0F25d2df570eB9C0"
  const bal = await token.balanceOf(addr)
  console.log(`Balance: ${ethers.formatEther(bal)} VRT`)
  const receipt = await ethers.provider.getTransactionReceipt("0x86da5921b635ff04dbf7b04c64846375fb2e3a634826d25df61928bfe2f16c08")
  console.log(`Tx status: ${receipt?.status} | logs: ${receipt?.logs?.length}`)
}
main().catch(console.error)
