/**
 * evaluator-starter-kit.ts
 *
 * Minimal reference implementation for an external evaluator on the
 * Agent Settlement Protocol (ERC-8183) — Base Sepolia testnet.
 *
 * This script demonstrates the full evaluator lifecycle:
 *   1. Stake VRT in EvaluatorRegistry to become eligible for assignment
 *   2. Watch for jobs assigned to your wallet (on-chain, via getLogs)
 *   3. Read the deliverable once the provider submits
 *   4. Call complete() (or reject()) directly on-chain
 *
 * Prerequisites:
 *   npm install ethers
 *
 * Usage:
 *   EVALUATOR_PRIVATE_KEY=0x... npx ts-node evaluator-starter-kit.ts
 */

import { ethers } from 'ethers'

// ── Contract addresses (Base Sepolia — deployed 2026-04-13) ────────────────
const CONTRACTS = {
  AgentJobManager:   '0x892e7e77BC8DBc7E97E16E8e7DcF3783aFbB3A19',
  EvaluatorRegistry: '0xe5517C488a470D5eeB5Aa812bb87c09fc5c14D21',
  ProtocolToken:     '0x74038A4790B2082dAEF447ed9a32a1EBa3e3Dd69',
  MockUSDC:          '0xe02cc9863bf4d49Fcc88DD9C098d6CA97D332FDD',
  ReputationBridge:  '0xba6195A6afF8997C8E1439b1634d4cA28A9e4c54',
}

const RPC_URL = 'https://sepolia.base.org'

// ── Minimal ABIs (only the functions and events you need) ──────────────────
const TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]

const REGISTRY_ABI = [
  'function isEligible(address) view returns (bool)',
  'function minEvaluatorStake() view returns (uint256)',
  'function stake(uint256 amount)',
]

const JOB_MANAGER_ABI = [
  'function complete(uint256 jobId, bytes32 reason)',
  'function reject(uint256 jobId, bytes32 reason)',
  // EvaluatorAssigned is emitted from fund() — AgentJobManager is the single
  // source of truth for assignment events since the 2026-04-13 deployment.
  'event EvaluatorAssigned(uint256 indexed jobId, address indexed evaluator)',
]

// ── Step 1: Setup ──────────────────────────────────────────────────────────
const provider  = new ethers.JsonRpcProvider(RPC_URL)
const wallet    = new ethers.Wallet(process.env.EVALUATOR_PRIVATE_KEY!, provider)

const token      = new ethers.Contract(CONTRACTS.ProtocolToken,    TOKEN_ABI,       wallet)
const registry   = new ethers.Contract(CONTRACTS.EvaluatorRegistry, REGISTRY_ABI,   wallet)
const jobManager = new ethers.Contract(CONTRACTS.AgentJobManager,  JOB_MANAGER_ABI, wallet)

// ── getLogs chunk size ─────────────────────────────────────────────────────
// Base Sepolia enforces a maximum of 9000 blocks per eth_getLogs request.
// Exceeding this limit returns an RPC error — we paginate explicitly.
const LOGS_CHUNK_SIZE = 9_000n

async function main() {
  console.log(`Evaluator wallet: ${wallet.address}`)

  // ── Step 2: Stake if not yet eligible ─────────────────────────────────
  const eligible = await registry.isEligible(wallet.address)
  if (!eligible) {
    const minStake = await registry.minEvaluatorStake()
    const balance  = await token.balanceOf(wallet.address)

    if (balance < minStake) {
      throw new Error(
        `Insufficient VRT: have ${ethers.formatEther(balance)}, need ${ethers.formatEther(minStake)}.\n` +
        `Ask the protocol deployer to mint VRT to ${wallet.address}.`
      )
    }

    console.log(`Approving ${ethers.formatEther(minStake)} VRT...`)
    const approveTx = await token.approve(CONTRACTS.EvaluatorRegistry, minStake)
    await approveTx.wait(1)

    console.log(`Staking ${ethers.formatEther(minStake)} VRT...`)
    const stakeTx = await registry.stake(minStake)
    await stakeTx.wait(1)

    // warmup period: 24h on testnet
    console.log(`Staked. You will be eligible for assignment after the warmup period (24h on testnet).`)
  } else {
    console.log(`Already eligible — ready for assignment.`)
  }

  // ── Step 3: Watch for assigned jobs ───────────────────────────────────
  // We listen to EvaluatorAssigned(uint256 indexed jobId, address indexed evaluator)
  // emitted by AgentJobManager.fund(). The evaluator address is the second indexed
  // topic, so we can filter getLogs directly on our wallet without fetching all events.
  //
  // Fallback: on freshly deployed contracts, eth_getLogs indexing can lag by
  // several blocks. If getLogs returns 0 results over the last 9000 blocks we
  // fall back to parsing receipts of known fund() transaction hashes directly.
  console.log(`\nWatching for job assignments on ${wallet.address}...\n`)

  await watchAssignmentsOnChain()
}

async function watchAssignmentsOnChain(): Promise<void> {
  const iface = new ethers.Interface(JOB_MANAGER_ABI)

  // EvaluatorAssigned(uint256 indexed jobId, address indexed evaluator)
  // selector: 0x50a93d710505e6f207121334c60e2a4c6312fdbae71f879f5abee6488e20b131
  const eventTopic    = ethers.id('EvaluatorAssigned(uint256,address)')
  const evaluatorTopic = ethers.zeroPadValue(wallet.address, 32)

  let lastProcessedBlock = (await provider.getBlockNumber()) - 1

  // Poll every 5 seconds — Base Sepolia produces a block roughly every 2 seconds
  // so this gives us ~2 block confirmation margin without overwhelming the RPC.
  setInterval(async () => {
    try {
      const currentBlock = await provider.getBlockNumber()
      if (currentBlock <= lastProcessedBlock) return

      const fromBlock = lastProcessedBlock + 1
      const toBlock   = currentBlock

      const logs = await getLogsInChunks(
        CONTRACTS.AgentJobManager,
        [eventTopic, null, evaluatorTopic],
        BigInt(fromBlock),
        BigInt(toBlock),
      )

      // Fallback: if the contract was deployed very recently, the RPC node's
      // log index may not yet cover the full range. In that case, known fund()
      // transaction hashes can be passed to eth_getTransactionReceipt to
      // extract EvaluatorAssigned logs directly from the receipt.
      //
      // Example usage (replace with actual tx hash if getLogs returns nothing
      // and you know a fund() was just sent):
      //
      //   if (logs.length === 0) {
      //     const fallbackLogs = await getLogsFromReceipts(
      //       ['0xabc...'],
      //       eventTopic,
      //       evaluatorTopic,
      //     )
      //     logs.push(...fallbackLogs)
      //   }

      for (const log of logs) {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data })
        if (!parsed) continue

        const jobId = parsed.args.jobId as bigint
        console.log(`[assigned] Job #${jobId} — funded and assigned to you. Waiting for provider submission...`)

        // TODO: persist jobId and monitor for JobSubmitted events to trigger evaluation
      }

      lastProcessedBlock = toBlock
    } catch (err) {
      console.warn(`[watcher] poll error: ${(err as Error).message}`)
    }
  }, 5_000)
}

/**
 * Paginates eth_getLogs in chunks of LOGS_CHUNK_SIZE blocks.
 * Base Sepolia rejects requests that span more than 9000 blocks.
 */
async function getLogsInChunks(
  address: string,
  topics: (string | null)[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ethers.Log[]> {
  const results: ethers.Log[] = []

  for (let start = fromBlock; start <= toBlock; start += LOGS_CHUNK_SIZE) {
    const end = start + LOGS_CHUNK_SIZE - 1n < toBlock
      ? start + LOGS_CHUNK_SIZE - 1n
      : toBlock

    const chunk = await provider.getLogs({
      address,
      topics,
      fromBlock: Number(start),
      toBlock:   Number(end),
    })

    results.push(...chunk)
  }

  return results
}

/**
 * Fallback for freshly deployed contracts where eth_getLogs indexing lags.
 * Fetches transaction receipts by hash and extracts matching logs manually.
 *
 * Use this when getLogs returns 0 results but you have known fund() tx hashes
 * (e.g. stored from a previous createAndFund call in the same session).
 */
async function getLogsFromReceipts(
  txHashes: string[],
  eventTopic: string,
  evaluatorTopic: string,
): Promise<ethers.Log[]> {
  const results: ethers.Log[] = []

  for (const hash of txHashes) {
    const receipt = await provider.getTransactionReceipt(hash)
    if (!receipt) continue

    for (const log of receipt.logs) {
      if (
        log.address.toLowerCase() === CONTRACTS.AgentJobManager.toLowerCase() &&
        log.topics[0] === eventTopic &&
        log.topics[2]?.toLowerCase() === evaluatorTopic.toLowerCase()
      ) {
        results.push(log)
      }
    }
  }

  return results
}

// ── Step 4: Evaluate & call complete() or reject() ────────────────────────
// Call this once the provider has submitted their deliverable (JobSubmitted event).
async function evaluateJob(jobId: bigint, deliverable: string): Promise<void> {
  const accepted = await yourEvaluationLogic(deliverable)

  if (accepted) {
    // reason is bytes32 — pass a keccak256 hash of your attestation CID,
    // or ethers.encodeBytes32String('...') for a short string (max 31 chars).
    const reason = ethers.keccak256(ethers.toUtf8Bytes(`job-${jobId}-accepted`))
    console.log(`[evaluating] Calling complete(${jobId})...`)
    const tx = await jobManager.complete(jobId, reason)
    await tx.wait(1)
    console.log(`Job #${jobId} completed — tx: ${tx.hash}`)
  } else {
    const reason = ethers.keccak256(ethers.toUtf8Bytes(`job-${jobId}-rejected`))
    console.log(`[evaluating] Calling reject(${jobId})...`)
    const tx = await jobManager.reject(jobId, reason)
    await tx.wait(1)
    console.log(`Job #${jobId} rejected — tx: ${tx.hash}`)
  }
}

// Replace with your actual multi-model consensus logic.
async function yourEvaluationLogic(deliverable: string): Promise<boolean> {
  console.log(`[evaluating] Running consensus on: "${deliverable}"`)
  // TODO: call ThoughtProof API here
  return true
}

main().catch((err) => {
  console.error(err.message)
  process.exitCode = 1
})
