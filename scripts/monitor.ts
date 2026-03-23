import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../deployments/base-sepolia.json"), "utf-8")
)

async function main() {
  const jobManager = await ethers.getContractAt(
    "AgentJobManager",
    manifest.contracts.AgentJobManager.address
  )

  const STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"]

  console.log("\n=== Agent Settlement Protocol — Transaction Monitor ===")
  console.log(`Contract: ${manifest.contracts.AgentJobManager.address}`)
  console.log(`https://sepolia.basescan.org/address/${manifest.contracts.AgentJobManager.address}\n`)

  // Base Sepolia public RPC limits eth_getLogs to 10 000 blocks per request.
  // We paginate in 5 000-block chunks from the deployment block.
  const DEPLOY_BLOCK = 39226585
  const latestBlock = await ethers.provider.getBlockNumber()
  const CHUNK = 5000

  async function queryAll<T>(filter: ethers.ContractEventName): Promise<ethers.EventLog[]> {
    const results: ethers.EventLog[] = []
    for (let from = DEPLOY_BLOCK; from <= latestBlock; from += CHUNK) {
      const to = Math.min(from + CHUNK - 1, latestBlock)
      const chunk = await (jobManager.queryFilter as Function)(filter, from, to)
      results.push(...chunk)
    }
    return results
  }

  const [created, funded, submitted, completed, rejected, expired] = await Promise.all([
    queryAll(jobManager.filters.JobCreated()),
    queryAll(jobManager.filters.JobFunded()),
    queryAll(jobManager.filters.JobSubmitted()),
    queryAll(jobManager.filters.JobCompleted()),
    queryAll(jobManager.filters.JobRejected()),
    queryAll(jobManager.filters.JobExpired()),
  ])

  // Build a map jobId → events
  const jobs: Record<string, { events: string[]; status: string }> = {}

  for (const e of created) {
    const id = e.args[0].toString()
    jobs[id] = { events: [], status: "Open" }
    jobs[id].events.push(
      `  [${e.blockNumber}] JobCreated   client=${e.args[1].slice(0,10)}... provider=${e.args[2].slice(0,10)}...  tx=${e.transactionHash.slice(0,12)}...`
    )
  }
  for (const e of funded) {
    const id = e.args[0].toString()
    if (jobs[id]) {
      jobs[id].status = "Funded"
      jobs[id].events.push(
        `  [${e.blockNumber}] JobFunded    amount=${ethers.formatUnits(e.args[1], 6)} USDC  tx=${e.transactionHash.slice(0,12)}...`
      )
    }
  }
  for (const e of submitted) {
    const id = e.args[0].toString()
    if (jobs[id]) {
      jobs[id].status = "Submitted"
      jobs[id].events.push(
        `  [${e.blockNumber}] JobSubmitted deliverable=${e.args[1].slice(0,12)}...  tx=${e.transactionHash.slice(0,12)}...`
      )
    }
  }
  for (const e of completed) {
    const id = e.args[0].toString()
    if (jobs[id]) {
      jobs[id].status = "Completed ✓"
      jobs[id].events.push(
        `  [${e.blockNumber}] JobCompleted payment=${ethers.formatUnits(e.args[2], 6)} USDC  fee=${ethers.formatUnits(e.args[3], 6)} USDC  tx=${e.transactionHash.slice(0,12)}...`
      )
    }
  }
  for (const e of rejected) {
    const id = e.args[0].toString()
    if (jobs[id]) {
      jobs[id].status = "Rejected"
      jobs[id].events.push(`  [${e.blockNumber}] JobRejected  tx=${e.transactionHash.slice(0,12)}...`)
    }
  }
  for (const e of expired) {
    const id = e.args[0].toString()
    if (jobs[id]) {
      jobs[id].status = "Expired"
      jobs[id].events.push(`  [${e.blockNumber}] JobExpired   tx=${e.transactionHash.slice(0,12)}...`)
    }
  }

  const ids = Object.keys(jobs).sort((a, b) => Number(a) - Number(b))
  if (ids.length === 0) {
    console.log("No jobs found on-chain.")
    return
  }

  for (const id of ids) {
    const job = jobs[id]
    console.log(`─── Job #${id}  [${job.status}]`)
    for (const line of job.events) console.log(line)
    console.log()
  }

  console.log(`Total: ${ids.length} jobs`)
}

main().catch(console.error)
