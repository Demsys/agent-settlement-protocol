import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "base-sepolia.json"), "utf-8"))
  const [deployer] = await ethers.getSigners()

  const jobManager = await ethers.getContractAt("AgentJobManager", manifest.contracts.AgentJobManager.address, deployer)
  const usdc = await ethers.getContractAt("MockUSDC", manifest.contracts.MockUSDC.address, deployer)

  const job = await jobManager.getJob(1n)
  const contractUSDC = await usdc.balanceOf(manifest.contracts.AgentJobManager.address)
  const feeRecipientUSDC = await usdc.balanceOf(manifest.config.feeRecipient)

  // Parse complete() tx logs to find actual Transfer events
  const completeTxHash = "0xea78c2e716a11fb4791e1739cdb9f9ac5cb23608bdce582da6013fec0aeb17f9"
  const receipt = await ethers.provider.getTransactionReceipt(completeTxHash)
  const usdcInterface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"])

  console.log("\n=== Job #1 on-chain state ===")
  console.log(`Status          : ${["Open","Funded","Submitted","Completed","Rejected","Expired"][Number(job.status)]}`)
  console.log(`Provider        : ${job.provider}`)
  console.log(`Evaluator       : ${job.evaluator}`)
  console.log(`Budget          : ${ethers.formatUnits(job.budget, 6)} USDC`)
  console.log(`\nContract USDC balance : ${ethers.formatUnits(contractUSDC, 6)} USDC`)
  console.log(`FeeRecipient USDC     : ${ethers.formatUnits(feeRecipientUSDC, 6)} USDC`)

  console.log("\n=== Transfer events in complete() tx ===")
  if (receipt) {
    for (const log of receipt.logs) {
      try {
        const parsed = usdcInterface.parseLog(log)
        if (parsed?.name === "Transfer") {
          console.log(`  Transfer: ${parsed.args.from} → ${parsed.args.to} : ${ethers.formatUnits(parsed.args.value, 6)} USDC`)
        }
      } catch {}
    }
  }

  // Check Bob's actual current balance (from job.provider address)
  const bobUSDC = await usdc.balanceOf(job.provider)
  console.log(`\nBob (provider) current USDC : ${ethers.formatUnits(bobUSDC, 6)} USDC`)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
