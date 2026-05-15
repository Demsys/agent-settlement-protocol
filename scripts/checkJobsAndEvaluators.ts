import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

const STATUS_LABELS: Record<number, string> = {
  0: "Open",
  1: "Funded",
  2: "Submitted",
  3: "Completed",
  4: "Rejected",
  5: "Expired",
}

async function main() {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "deployments", "base-sepolia.json"),
      "utf-8"
    )
  )

  const mgr = await ethers.getContractAt(
    "AgentJobManager",
    manifest.contracts.AgentJobManager.address
  )
  const registry = await ethers.getContractAt(
    "EvaluatorRegistry",
    manifest.contracts.EvaluatorRegistry.address
  )

  // Check jobs #1 and #2
  for (const jobId of [1n, 2n]) {
    console.log(`\n--- Job #${jobId} ---`)
    try {
      const job = await mgr.getJob(jobId)
      const statusNum = Number(job.status)
      const statusLabel = STATUS_LABELS[statusNum] ?? "Unknown"
      const deadlineDate = new Date(Number(job.deadline) * 1000).toISOString()
      const createdAtDate = new Date(Number(job.createdAt) * 1000).toISOString()

      console.log(`  status:      ${statusNum} (${statusLabel})`)
      console.log(`  client:      ${job.client}`)
      console.log(`  provider:    ${job.provider}`)
      console.log(`  evaluator:   ${job.evaluator}`)
      console.log(`  token:       ${job.token}`)
      console.log(`  budget:      ${ethers.formatUnits(job.budget, 6)} USDC`)
      console.log(`  createdAt:   ${createdAtDate}`)
      console.log(`  deadline:    ${deadlineDate}`)
      console.log(
        `  deliverable: ${job.deliverable === ethers.ZeroHash ? "(none)" : job.deliverable}`
      )
      console.log(
        `  reason:      ${job.reason === ethers.ZeroHash ? "(none)" : job.reason}`
      )
    } catch (e) {
      console.log(`  not found on-chain (or call reverted)`)
    }
  }

  // Check evaluator eligibility and stake
  const evaluators: Array<{ name: string; address: string }> = [
    { name: "ThoughtProof", address: "0x118B1E5A47658D20046bC874cB34E469d472c0C2" },
    { name: "pablocactus",  address: "0x35eeDdcbE5E1AE01396Cb93Fc8606cE4C713d7BC" },
  ]

  console.log(`\n--- Evaluator Registry (${manifest.contracts.EvaluatorRegistry.address}) ---`)

  for (const ev of evaluators) {
    console.log(`\n  ${ev.name} (${ev.address})`)
    try {
      const eligible = await registry.isEligible(ev.address)
      const stake    = await registry.getStake(ev.address)
      console.log(`    isEligible: ${eligible}`)
      console.log(`    stake:      ${ethers.formatUnits(stake, 18)} VRT`)
    } catch (e) {
      console.log(`    call failed: ${(e as Error).message}`)
    }
  }

  console.log()
}

main().catch(console.error)
