import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8"))
  const registry = await ethers.getContractAt("EvaluatorRegistry", manifest.contracts.EvaluatorRegistry.address)
  const token    = await ethers.getContractAt("ProtocolToken",    manifest.contracts.ProtocolToken.address)

  const addr = "0xB4B9Cb85A2642719ba919b0C0F25d2df570eB9C0"
  const vrt      = await token.balanceOf(addr)
  const eligible = await registry.isEligible(addr)
  console.log(`ThoughtProof (${addr})`)
  console.log(`  VRT balance : ${ethers.formatEther(vrt)}`)
  console.log(`  Eligible    : ${eligible}`)
}

main().catch(console.error)
