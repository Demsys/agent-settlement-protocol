import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8"))
  const [signer] = await ethers.getSigners()

  const jobManager = await ethers.getContractAt("AgentJobManager", manifest.contracts.AgentJobManager.address, signer)

  const job = await jobManager.getJob(3n)
  console.log("Job #3 on-chain:")
  console.log("  client   :", job.client)
  console.log("  provider :", job.provider)
  console.log("  evaluator:", job.evaluator)
  console.log("  status   :", job.status.toString(), "→", ["Open","Funded","Submitted","Completed","Rejected","Expired"][Number(job.status)])
  console.log("  budget   :", ethers.formatUnits(job.budget, 6), "USDC")
  console.log("  deadline :", new Date(Number(job.deadline) * 1000).toISOString())
}

main().catch(e => { console.error(e); process.exitCode = 1 })
