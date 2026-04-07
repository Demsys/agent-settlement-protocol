import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.join(process.cwd(), '..', '.env') })

// -------------------------------------------------------------------
// Fail fast on missing critical configuration.
// Railway will surface the exit code in its deploy logs, making the
// root cause immediately obvious rather than buried in a stack trace.
// -------------------------------------------------------------------

const REQUIRED_ENV_VARS = ['BASE_SEPOLIA_RPC_URL', 'WALLET_ENCRYPTION_KEY'] as const
const missingVars = REQUIRED_ENV_VARS.filter((v) => !process.env[v])
if (missingVars.length > 0) {
  console.error(`[startup] Missing required environment variables: ${missingVars.join(', ')}`)
  process.exit(1)
}
// PRIVATE_KEY is optional — faucet and evaluator seeding are disabled without it
if (!process.env.PRIVATE_KEY) {
  console.warn('[startup] PRIVATE_KEY not set — faucet and agent seeding disabled')
}

import express, { Request, Response, NextFunction } from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import * as crypto from 'crypto'
import { ethers } from 'ethers'

import {
  saveAgent,
  saveJob,
  findAgentByApiKey,
  findAgentById,
  findJobById,
  findJobsByAgentId,
  findJobsByEvaluatorAddress,
  updateJobStatus,
  updateJobDeliverable,
  updateJobEvaluator,
  readAgents,
} from './storage'
import { generateWallet, walletFromEncrypted } from './wallet'
import {
  provider,
  primaryProvider,
  manifest,
  getJobManagerReadOnly,
  getJobManagerWithSigner,
  getMockUSDCWithSigner,
  getMockUSDCReadOnly,
  USDC_DECIMALS,
  JOB_STATUS_MAP,
} from './contracts'
import { getStats } from './stats'
import { getDashboardHtml } from './dashboard'
import { openApiSpec } from './openapi'
import swaggerUi from 'swagger-ui-express'

// -------------------------------------------------------------------
// Global error safety net — catches any unhandled promise rejection or
// synchronous exception that escapes the normal try/catch blocks.
// Without this, Node.js silently ignores them (Node < 15) or crashes (Node 15+).
// -------------------------------------------------------------------

process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', reason, promise)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})

// -------------------------------------------------------------------
// Network-aware constants
// -------------------------------------------------------------------

const NETWORK = process.env.NETWORK ?? 'testnet'
const BASESCAN_BASE = NETWORK === 'mainnet'
  ? 'https://basescan.org'
  : 'https://sepolia.basescan.org'

// -------------------------------------------------------------------
// App setup
// -------------------------------------------------------------------

const app = express()

// SECURITY-007: trust the first proxy hop (Railway reverse proxy) so that
// express-rate-limit reads the real client IP from X-Forwarded-For instead
// of the proxy's IP. Without this, all traffic shares one rate-limit bucket.
app.set('trust proxy', 1)

// Body limit — protects against oversized malicious payloads that could
// exhaust memory before the JSON parser even finishes.
app.use(bodyParser.json({ limit: '10kb' }))

// Security headers (XSS protection, content-type sniffing, etc.)
app.use(helmet())

// CORS — configurable via env var so testnet stays open for developer
// testing while mainnet can be locked to known frontend origins.
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : '*'
app.use(cors(allowedOrigins === '*' ? undefined : { origin: allowedOrigins }))

// IP-based rate limiting — 120 requests / 15 min per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.', code: 'RATE_LIMITED' },
})
app.use(limiter)

// Stricter per-route limiter for agent creation.
// FINDING-002 fix: each agent creation triggers a deployer ETH seed transfer.
// Without this limiter, an attacker can drain the deployer at 120 × 0.001 ETH
// per 15 minutes per IP. Capped here at 3 agents/hour/IP to bound drain rate.
const agentCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Agent creation limit reached. Max 3 per hour per IP.', code: 'RATE_LIMITED' },
})

const PORT = parseInt(process.env.PORT ?? '3000', 10)

// Blockchain call timeout — transactions that are not confirmed within this
// window are considered failed (avoids hanging forever on a slow RPC node).
const BLOCKCHAIN_TIMEOUT_MS = 90_000

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function apiError(res: Response, status: number, code: string, message: string): void {
  console.error(`[apiError] ${status} ${code}: ${message}`)
  res.status(status).json({ error: message, code })
}

function basescanTx(txHash: string): string {
  return `${BASESCAN_BASE}/tx/${txHash}`
}

// Wraps any promise with a hard timeout so blockchain calls never hang forever.
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Operation timed out after ${BLOCKCHAIN_TIMEOUT_MS / 1000}s: ${label}`)),
        BLOCKCHAIN_TIMEOUT_MS,
      )
    ),
  ])
}

// Retries an async function up to maxAttempts times with exponential backoff.
// Used for background blockchain handlers where a transient RPC error (stale
// nonce, rate-limit, brief node unavailability) should not permanently fail the job.
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3,
  baseDelayMs = 4_000,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * attempt
        console.warn(`[retry] ${label} attempt ${attempt}/${maxAttempts} failed — retrying in ${delay}ms:`, err instanceof Error ? err.message : err)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
  throw lastErr
}

// Polls getJob() until the job record is visible on the RPC node (post-createJob).
// This replaces the fragile fixed sleep(2000) that was previously used.
async function waitForJobOnChain(
  jobManager: ReturnType<typeof getJobManagerReadOnly>,
  jobId: bigint,
  maxAttempts = 12,
  delayMs    = 500,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const job = await jobManager.getJob(jobId)
      if (job.client !== ethers.ZeroAddress) return
    } catch { /* not visible yet */ }
    await new Promise((r) => setTimeout(r, delayMs))
  }
  throw new Error(`Job ${jobId} not found on-chain after ${maxAttempts} attempts`)
}

// Generates a random 32-byte API key as a hex string
function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex')
}

// Generates a random UUID-style agent ID
function generateAgentId(): string {
  return crypto.randomUUID()
}

// -------------------------------------------------------------------
// Auth middleware
// -------------------------------------------------------------------

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key']
  if (!apiKey || typeof apiKey !== 'string') {
    apiError(res, 401, 'MISSING_API_KEY', 'x-api-key header is required')
    return
  }
  const agent = findAgentByApiKey(apiKey)
  if (!agent) {
    apiError(res, 401, 'INVALID_API_KEY', 'API key is invalid')
    return
  }
  // Attach agent to request for downstream handlers
  res.locals.agent = agent
  next()
}

// -------------------------------------------------------------------
// POST /v1/faucet/usdc
// Testnet only — mints MockUSDC to any address via the deployer wallet
// -------------------------------------------------------------------

app.post('/v1/faucet/usdc', async (req: Request, res: Response) => {
  const { address, amount = '100' } = req.body as { address?: unknown; amount?: unknown }

  if (!address || typeof address !== 'string' || !ethers.isAddress(address)) {
    apiError(res, 400, 'INVALID_ADDRESS', 'address must be a valid Ethereum address')
    return
  }
  const amountStr = String(amount)
  if (!/^\d+(\.\d+)?$/.test(amountStr)) {
    apiError(res, 400, 'INVALID_AMOUNT', 'amount must be a decimal string (e.g. "100")')
    return
  }
  // SECURITY-008: cap faucet amount to prevent deployer drain
  if (parseFloat(amountStr) > 1_000) {
    apiError(res, 400, 'INVALID_AMOUNT', 'faucet amount cannot exceed 1000 USDC')
    return
  }

  if (!getDeployerWallet()) {
    apiError(res, 503, 'NO_DEPLOYER', 'Deployer key not configured')
    return
  }

  res.json({ address, amount: amountStr, status: 'processing' })

  setImmediate(async () => {
    try {
      const deployer = getDeployerWallet()!
      const usdc = getMockUSDCWithSigner(deployer)
      const amountWei = ethers.parseUnits(amountStr, USDC_DECIMALS)
      const tx = await usdc.mint(address, amountWei)
      const receipt = await withTimeout(tx.wait(1), 'faucet mint')
      if (!receipt || receipt.status === 0) {
        console.error(`[faucet] Mint transaction reverted for ${address}`)
        return
      }
      console.log(`[faucet] Minted ${amountStr} USDC to ${address} — ${basescanTx(tx.hash)}`)
    } catch (err) {
      console.error(`[faucet] Failed to mint USDC to ${address}:`, err)
    }
  })
})

// -------------------------------------------------------------------
// POST /v1/agents
// Creates a managed wallet for a new agent and returns its address
// -------------------------------------------------------------------

// Amount of ETH sent to each new agent wallet — enough for ~50 txs on Base
const AGENT_SEED_ETH = ethers.parseEther('0.001')

// Singleton deployer wallet — reused across all seed calls so ethers.js
// manages the nonce internally and avoids reuse on concurrent requests.
// Uses primaryProvider (a plain JsonRpcProvider) because ethers.Wallet
// requires a concrete provider that can sign and broadcast transactions.
let _deployerWallet: ethers.Wallet | null = null
function getDeployerWallet(): ethers.Wallet | null {
  if (_deployerWallet) return _deployerWallet
  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) return null
  _deployerWallet = new ethers.Wallet(privateKey, primaryProvider)
  return _deployerWallet
}

// Serial seed queue — prevents concurrent seed calls from colliding on nonce.
let _seedQueue: Promise<void> = Promise.resolve()

// SECURITY-006: per-wallet transaction queues — serialises concurrent fund/submit/complete
// calls from the same agent wallet to prevent nonce collisions on L2 RPC nodes.
const _walletQueues = new Map<string, Promise<void>>()
function withWalletQueue<T>(address: string, fn: () => Promise<T>): Promise<T> {
  const prev = _walletQueues.get(address) ?? Promise.resolve()
  let resolve!: () => void
  const slot = new Promise<void>((r) => { resolve = r })
  _walletQueues.set(address, prev.then(() => slot))
  return prev.then(fn).finally(resolve)
}

async function seedAgentWallet(agentAddress: string): Promise<void> {
  _seedQueue = _seedQueue.then(async () => {
    const deployer = getDeployerWallet()
    if (!deployer) return
    try {
      const balance = await primaryProvider.getBalance(deployer.address)
      if (balance < AGENT_SEED_ETH) {
        console.warn(`Deployer balance too low to seed agent wallet ${agentAddress}`)
        return
      }
      const tx = await deployer.sendTransaction({ to: agentAddress, value: AGENT_SEED_ETH })
      await tx.wait(1)
      console.log(`Seeded ${agentAddress} with ${ethers.formatEther(AGENT_SEED_ETH)} ETH`)
    } catch (err) {
      console.warn(`Failed to seed agent wallet ${agentAddress}:`, err)
    }
  })
  await _seedQueue
}

app.post('/v1/agents', agentCreationLimiter, async (req: Request, res: Response) => {
  const { name } = req.body as { name?: unknown }

  if (!name || typeof name !== 'string' || name.trim() === '') {
    apiError(res, 400, 'INVALID_NAME', 'name is required and must be a non-empty string')
    return
  }

  const agentId = generateAgentId()
  const wallet = generateWallet(agentId)   // HKDF key derived from agentId
  const apiKey = generateApiKey()

  saveAgent({
    agentId,
    name: name.trim(),
    address: wallet.address,
    apiKey,
    encryptedPrivateKey: wallet.encryptedPrivateKey,
    createdAt: new Date().toISOString(),
  })

  // Auto-fund the new wallet from the deployer so it can pay gas immediately
  await seedAgentWallet(wallet.address)

  res.status(201).json({
    agentId,
    address: wallet.address,
    apiKey,
  })
})

// -------------------------------------------------------------------
// POST /v1/jobs
// Creates a job on-chain from the agent's wallet
// -------------------------------------------------------------------

app.post('/v1/jobs', requireApiKey, async (req: Request, res: Response) => {
  const agent = res.locals.agent as ReturnType<typeof findAgentByApiKey> & {}

  const { providerAddress, budget, deadlineMinutes = 60 } = req.body as {
    providerAddress?: unknown
    budget?: unknown
    deadlineMinutes?: unknown
  }

  // Validate inputs
  if (!providerAddress || typeof providerAddress !== 'string') {
    apiError(res, 400, 'INVALID_PROVIDER', 'providerAddress is required')
    return
  }
  if (!ethers.isAddress(providerAddress)) {
    apiError(res, 400, 'INVALID_ADDRESS', 'providerAddress is not a valid Ethereum address')
    return
  }
  if (!budget || typeof budget !== 'string' || !/^\d+(\.\d+)?$/.test(budget)) {
    apiError(res, 400, 'INVALID_BUDGET', 'budget must be a decimal string (e.g. "5.00")')
    return
  }
  // SECURITY-003: bound budget to prevent griefing / drain attacks
  const budgetFloat = parseFloat(budget)
  if (budgetFloat < 0.01 || budgetFloat > 10_000) {
    apiError(res, 400, 'INVALID_BUDGET', 'budget must be between 0.01 and 10000 USDC')
    return
  }
  const deadlineMins = Number(deadlineMinutes)
  if (!Number.isInteger(deadlineMins) || deadlineMins < 5 || deadlineMins > 10080) {
    apiError(res, 400, 'INVALID_DEADLINE', 'deadlineMinutes must be between 5 and 10080')
    return
  }

  try {
    // Wallet signers require a JsonRpcProvider — use primaryProvider here
    const signer = walletFromEncrypted(agent!.encryptedPrivateKey, primaryProvider, agent!.agentId)
    const jobManager = getJobManagerWithSigner(signer)

    // Track nonce manually to avoid stale-nonce errors on L2 RPC nodes
    let nonce = await primaryProvider.getTransactionCount(await signer.getAddress(), 'pending')

    const budgetWei = ethers.parseUnits(budget, USDC_DECIMALS)
    // Deadline is a Unix timestamp — contract checks deadline > block.timestamp
    const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + deadlineMins * 60)

    // Pass address(0) to let the EvaluatorRegistry auto-assign a stake-weighted
    // eligible evaluator. The registry's assignEvaluator() is called inside
    // createJob() on-chain — it selects pseudo-randomly weighted by stake amount.
    // Reverts with NoEligibleEvaluator if no staker has completed the warmup period.
    const evaluatorAddress = ethers.ZeroAddress
    const tokenAddress = manifest.contracts.MockUSDC.address

    // Estimate gas first so we fail fast with a clear message if the tx would revert
    const gasEstimate = await jobManager.createJob.estimateGas(
      providerAddress,
      evaluatorAddress,
      tokenAddress,
      deadlineTimestamp,
    )

    const createTx = await jobManager.createJob(
      providerAddress,
      evaluatorAddress,
      tokenAddress,
      deadlineTimestamp,
      { gasLimit: (gasEstimate * 120n) / 100n, nonce: nonce++ },
    )
    const createReceipt = await withTimeout(createTx.wait(1), 'createJob confirmation')
    if (!createReceipt || createReceipt.status === 0) {
      apiError(res, 500, 'TX_FAILED', `createJob transaction failed: ${basescanTx(createTx.hash)}`)
      return
    }

    // Parse JobCreated event to get the on-chain jobId
    const jobCreatedLog = createReceipt.logs
      .map((log) => {
        try { return jobManager.interface.parseLog(log) } catch { return null }
      })
      .find((parsed) => parsed?.name === 'JobCreated')

    if (!jobCreatedLog) {
      apiError(res, 500, 'EVENT_NOT_FOUND', 'JobCreated event not found in receipt')
      return
    }

    const onChainJobId: bigint = jobCreatedLog.args[0] as bigint
    // JobCreated(jobId, client, provider, evaluator, token, deadline)
    const assignedEvaluator: string = jobCreatedLog.args[3] as string

    // Wait until the job is visible on the RPC node before calling setBudget.
    // This replaces a fixed sleep — the retry loop is more reliable on slow nodes.
    await waitForJobOnChain(getJobManagerReadOnly(), onChainJobId)

    // Set the budget in a separate call as required by the ERC-8183 flow
    const setBudgetGas = await jobManager.setBudget.estimateGas(onChainJobId, budgetWei)
    const setBudgetTx = await jobManager.setBudget(onChainJobId, budgetWei, {
      gasLimit: (setBudgetGas * 120n) / 100n, nonce: nonce++,
    })
    const setBudgetReceipt = await withTimeout(setBudgetTx.wait(1), 'setBudget confirmation')
    if (!setBudgetReceipt || setBudgetReceipt.status === 0) {
      apiError(res, 500, 'TX_FAILED', `setBudget transaction failed: ${basescanTx(setBudgetTx.hash)}`)
      return
    }

    console.log(`[createJob] Assigned evaluator: ${assignedEvaluator}`)

    const jobId = onChainJobId.toString()
    saveJob({
      jobId,
      agentId: agent!.agentId,
      txHash: createTx.hash,
      status: 'open',
      providerAddress,
      evaluatorAddress: assignedEvaluator,
      budget,
      deadlineMinutes: deadlineMins,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    res.status(201).json({
      jobId,
      txHash: createTx.hash,
      basescanUrl: basescanTx(createTx.hash),
      status: 'open',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    apiError(res, 500, 'BLOCKCHAIN_ERROR', message)
  }
})

// -------------------------------------------------------------------
// POST /v1/jobs/:id/fund
// Mints MockUSDC, approves AgentJobManager, calls fund()
// -------------------------------------------------------------------

app.post('/v1/jobs/:id/fund', requireApiKey, async (req: Request<{ id: string }>, res: Response) => {
  const agent = res.locals.agent as ReturnType<typeof findAgentByApiKey> & {}
  const { id } = req.params

  const job = findJobById(id)
  if (!job) {
    apiError(res, 404, 'JOB_NOT_FOUND', `Job ${id} not found`)
    return
  }
  if (job.agentId !== agent!.agentId) {
    apiError(res, 403, 'FORBIDDEN', 'This job does not belong to your agent')
    return
  }
  if (job.status !== 'open') {
    apiError(res, 409, 'INVALID_STATE', `Job is in status '${job.status}', expected 'open'`)
    return
  }

  // Fail fast: check the agent wallet has enough USDC before going async.
  // Avoids the confusing "job stays open forever" symptom when USDC is missing.
  try {
    const signer = walletFromEncrypted(agent!.encryptedPrivateKey, primaryProvider, agent!.agentId)
    const agentAddress = await signer.getAddress()
    const budgetWei = ethers.parseUnits(job.budget, USDC_DECIMALS)
    const usdcBalance = await getMockUSDCReadOnly().balanceOf(agentAddress)
    if (usdcBalance < budgetWei) {
      apiError(
        res, 402, 'INSUFFICIENT_USDC',
        `Agent wallet has ${ethers.formatUnits(usdcBalance, USDC_DECIMALS)} USDC but job budget is ${job.budget} USDC — call POST /v1/faucet/usdc first`,
      )
      return
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    apiError(res, 500, 'BLOCKCHAIN_ERROR', `Pre-flight check failed: ${message}`)
    return
  }

  res.status(202).json({ jobId: id, status: 'processing' })

  setImmediate(() => {
    console.log(`[fund] Background handler started for job ${id}`)
    // SECURITY-006: serialise per-wallet to prevent nonce collisions on concurrent calls
    withWalletQueue(agent!.address, () =>
    withRetry(async () => {
      const signer = walletFromEncrypted(agent!.encryptedPrivateKey, primaryProvider, agent!.agentId)
      const usdc = getMockUSDCWithSigner(signer)
      const jobManager = getJobManagerWithSigner(signer)

      const budgetWei = ethers.parseUnits(job.budget, USDC_DECIMALS)
      const jobManagerAddress = manifest.contracts.AgentJobManager.address
      const agentAddress = await signer.getAddress()

      console.log(`[fund] Wallet ${agentAddress}, budget ${job.budget} USDC`)

      // Re-read nonce fresh on every attempt — avoids stale-nonce errors caused by
      // RPC propagation delay between setBudget (confirmed in createJob handler) and
      // this background handler starting.
      let nonce = await primaryProvider.getTransactionCount(agentAddress, 'pending')
      console.log(`[fund] Starting nonce: ${nonce}`)

      // Skip approve if already approved (idempotent retry support)
      const existingAllowance = await getMockUSDCReadOnly().allowance(agentAddress, jobManagerAddress)
      if (existingAllowance < budgetWei) {
        console.log(`[fund] Step 1/2 — approving USDC allowance…`)
        const approveGas = await usdc.approve.estimateGas(jobManagerAddress, ethers.MaxUint256)
        const approveTx = await usdc.approve(jobManagerAddress, ethers.MaxUint256, {
          gasLimit: (approveGas * 120n) / 100n, nonce: nonce++,
        })
        console.log(`[fund] approve tx sent: ${approveTx.hash}`)
        await withTimeout(approveTx.wait(1), 'approve confirmation')
        console.log(`[fund] approve confirmed`)
      } else {
        console.log(`[fund] Step 1/2 — allowance already sufficient (${ethers.formatUnits(existingAllowance, USDC_DECIMALS)} USDC), skipping approve`)
      }

      // Call fund() — passes expectedBudget so the contract can validate nothing changed
      console.log(`[fund] Step 2/2 — calling fund()…`)
      const onChainJobId = BigInt(id)
      const fundGas = await jobManager.fund.estimateGas(onChainJobId, budgetWei)
      const fundTx = await jobManager.fund(onChainJobId, budgetWei, {
        gasLimit: (fundGas * 120n) / 100n, nonce: nonce++,
      })
      console.log(`[fund] fund tx sent: ${fundTx.hash}`)
      const fundReceipt = await withTimeout(fundTx.wait(1), 'fund confirmation')
      if (!fundReceipt || fundReceipt.status === 0) {
        throw new Error(`fund() reverted — ${basescanTx(fundTx.hash)}`)
      }

      updateJobStatus(id, 'funded', fundTx.hash)

      // Read the assigned evaluator from the contract (auto-assigned during fund())
      try {
        const onChainJob = await getJobManagerReadOnly().getJob(onChainJobId)
        const assignedEvaluator = onChainJob.evaluator as string
        if (assignedEvaluator && assignedEvaluator !== ethers.ZeroAddress) {
          updateJobEvaluator(id, assignedEvaluator)
          console.log(`[fund] Job ${id} evaluator assigned: ${assignedEvaluator}`)
        }
      } catch (err) {
        console.warn(`[fund] Could not read assigned evaluator for job ${id}:`, err)
      }

      console.log(`[fund] Job ${id} funded — ${basescanTx(fundTx.hash)}`)
    }, `fund job ${id}`).catch((err) => {
      console.error(`[fund] All retries exhausted for job ${id}:`, err)
    }))
  })
})

// -------------------------------------------------------------------
// POST /v1/jobs/:id/submit
// Hashes the deliverable and calls submit() from the provider's wallet
// -------------------------------------------------------------------

app.post('/v1/jobs/:id/submit', requireApiKey, async (req: Request<{ id: string }>, res: Response) => {
  const agent = res.locals.agent as ReturnType<typeof findAgentByApiKey> & {}
  const { id } = req.params
  const { deliverable } = req.body as { deliverable?: unknown }

  if (!deliverable || typeof deliverable !== 'string' || deliverable.trim() === '') {
    apiError(res, 400, 'INVALID_DELIVERABLE', 'deliverable is required and must be a non-empty string')
    return
  }

  const job = findJobById(id)
  if (!job) {
    apiError(res, 404, 'JOB_NOT_FOUND', `Job ${id} not found`)
    return
  }
  // submit() must be called by the provider, not the job creator
  if (agent!.address.toLowerCase() !== job.providerAddress.toLowerCase()) {
    apiError(res, 403, 'FORBIDDEN', 'Only the provider can submit a deliverable')
    return
  }
  if (job.status !== 'funded') {
    apiError(res, 409, 'INVALID_STATE', `Job is in status '${job.status}', expected 'funded'`)
    return
  }

  res.status(202).json({ jobId: id, status: 'processing' })

  setImmediate(() => {
    console.log(`[submit] Background handler started for job ${id}`)
    withRetry(async () => {
      const signer = walletFromEncrypted(agent!.encryptedPrivateKey, primaryProvider, agent!.agentId)
      const jobManager = getJobManagerWithSigner(signer)
      const providerAddress = await signer.getAddress()
      console.log(`[submit] Provider wallet: ${providerAddress}`)

      // ERC-8183 submit() expects a bytes32 hash of the deliverable, not the raw content.
      const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes(deliverable as string))
      console.log(`[submit] Deliverable hash: ${deliverableHash}`)

      const onChainJobId = BigInt(id)
      const nonce = await primaryProvider.getTransactionCount(providerAddress, 'pending')
      console.log(`[submit] Nonce: ${nonce}`)
      const gasEstimate = await jobManager.submit.estimateGas(onChainJobId, deliverableHash)
      const submitTx = await jobManager.submit(onChainJobId, deliverableHash, {
        gasLimit: (gasEstimate * 120n) / 100n, nonce,
      })
      console.log(`[submit] tx sent: ${submitTx.hash}`)
      const submitReceipt = await withTimeout(submitTx.wait(1), 'submit confirmation')
      if (!submitReceipt || submitReceipt.status === 0) {
        throw new Error(`submit() reverted — ${basescanTx(submitTx.hash)}`)
      }

      updateJobStatus(id, 'submitted', submitTx.hash)
      updateJobDeliverable(id, deliverable as string)
      console.log(`[submit] Job ${id} submitted — ${basescanTx(submitTx.hash)}`)
    }, `submit job ${id}`).catch((err) => {
      console.error(`[submit] All retries exhausted for job ${id}:`, err)
    })
  })
})

// -------------------------------------------------------------------
// POST /v1/jobs/:id/complete
// Calls complete() from the evaluator's wallet
// In this MVP the evaluator role is played by the same agent wallet
// -------------------------------------------------------------------

app.post('/v1/jobs/:id/complete', requireApiKey, async (req: Request<{ id: string }>, res: Response) => {
  const agent = res.locals.agent as ReturnType<typeof findAgentByApiKey> & {}
  const { id } = req.params
  const { reason = '' } = req.body as { reason?: unknown }

  const job = findJobById(id)
  if (!job) {
    apiError(res, 404, 'JOB_NOT_FOUND', `Job ${id} not found`)
    return
  }
  if (job.agentId !== agent!.agentId) {
    apiError(res, 403, 'FORBIDDEN', 'This job does not belong to your agent')
    return
  }
  if (job.status !== 'submitted') {
    apiError(res, 409, 'INVALID_STATE', `Job is in status '${job.status}', expected 'submitted'`)
    return
  }

  // complete() must be called by the evaluator wallet.
  // This API server only controls the deployer wallet — verify the assigned evaluator matches.
  const evaluatorSigner = getDeployerWallet()
  if (!evaluatorSigner) {
    apiError(res, 500, 'CONFIG_ERROR', 'PRIVATE_KEY not set — evaluator wallet unavailable')
    return
  }
  const deployerAddress = await evaluatorSigner.getAddress()
  if (job.evaluatorAddress && job.evaluatorAddress.toLowerCase() !== deployerAddress.toLowerCase()) {
    apiError(res, 409, 'EVALUATOR_MISMATCH',
      `Job evaluator is ${job.evaluatorAddress} — this API can only complete jobs assigned to the deployer wallet (${deployerAddress})`)
    return
  }

  res.status(202).json({ jobId: id, status: 'processing' })

  setImmediate(() => {
    console.log(`[complete] Background handler started for job ${id}`)
    const reasonStr = typeof reason === 'string' ? reason : ''
    const reasonTruncated = reasonStr.length > 31
    const reasonBytes = ethers.encodeBytes32String(reasonStr.slice(0, 31))

    withRetry(async () => {
      const jobManager = getJobManagerWithSigner(evaluatorSigner)
      const evaluatorAddress = await evaluatorSigner.getAddress()
      console.log(`[complete] Evaluator wallet: ${evaluatorAddress}`)

      const onChainJobId = BigInt(id)
      const nonce = await primaryProvider.getTransactionCount(evaluatorAddress, 'pending')
      console.log(`[complete] Nonce: ${nonce}`)
      const gasEstimate = await jobManager.complete.estimateGas(onChainJobId, reasonBytes)
      const completeTx = await jobManager.complete(onChainJobId, reasonBytes, {
        gasLimit: (gasEstimate * 120n) / 100n, nonce,
      })
      console.log(`[complete] tx sent: ${completeTx.hash}`)
      const completeReceipt = await withTimeout(completeTx.wait(1), 'complete confirmation')
      if (!completeReceipt || completeReceipt.status === 0) {
        throw new Error(`complete() reverted — ${basescanTx(completeTx.hash)}`)
      }

      updateJobStatus(id, 'completed', completeTx.hash)
      console.log(`[complete] Job ${id} completed — ${basescanTx(completeTx.hash)}${reasonTruncated ? ' (reason truncated)' : ''}`)
    }, `complete job ${id}`).catch((err) => {
      console.error(`[complete] All retries exhausted for job ${id}:`, err)
    })
  })
})

// -------------------------------------------------------------------
// GET /v1/jobs/:id
// Returns the stored job record — clients use this to poll status after
// receiving a 202 from fund/submit/complete (which process in background).
// -------------------------------------------------------------------

app.get('/v1/jobs/:id', async (req: Request<{ id: string }>, res: Response) => {
  let job = findJobById(req.params.id)
  if (!job) {
    apiError(res, 404, 'JOB_NOT_FOUND', `Job ${req.params.id} not found`)
    return
  }

  // Auto-reconcile: if the background handler timed out before updating storage,
  // the on-chain state will be ahead of local storage. Detect and fix silently.
  const terminalStatuses: Array<typeof job.status> = ['completed', 'rejected', 'expired']
  if (!terminalStatuses.includes(job.status)) {
    try {
      const onChainJob = await getJobManagerReadOnly().getJob(BigInt(job.jobId))
      const onChainStatus = JOB_STATUS_MAP[Number(onChainJob.status)] as typeof job.status | undefined
      const onChainEvaluator = onChainJob.evaluator as string

      // Sync evaluatorAddress if the DB has address(0) but the contract has a real one
      if (onChainEvaluator && onChainEvaluator !== ethers.ZeroAddress &&
          (!job.evaluatorAddress || job.evaluatorAddress === ethers.ZeroAddress)) {
        updateJobEvaluator(job.jobId, onChainEvaluator)
        job = { ...job, evaluatorAddress: onChainEvaluator }
        console.log(`[sync] Job ${job.jobId}: evaluator synced → ${onChainEvaluator}`)
      }

      if (onChainStatus && onChainStatus !== job.status) {
        console.log(`[sync] Job ${job.jobId}: local=${job.status} → on-chain=${onChainStatus}`)
        updateJobStatus(job.jobId, onChainStatus)
        return res.json({ ...job, status: onChainStatus })
      }
    } catch (err) {
      // Non-fatal: return stored status if the RPC call fails
      console.warn(`[sync] Failed to read on-chain status for job ${job.jobId}:`, err)
    }
  }

  res.json(job)
})

// -------------------------------------------------------------------
// GET /v1/evaluator/:address/jobs
// Public — returns all jobs assigned to the given evaluator address.
// Used by external evaluators to poll for work assigned to them.
// -------------------------------------------------------------------

app.get('/v1/evaluator/:address/jobs', (req: Request<{ address: string }>, res: Response) => {
  const { address } = req.params
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    apiError(res, 400, 'INVALID_ADDRESS', 'address must be a checksummed 0x Ethereum address')
    return
  }
  const jobs = findJobsByEvaluatorAddress(address)
  res.json({ jobs })
})

// -------------------------------------------------------------------
// GET /v1/jobs
// Lists all jobs created by the authenticated agent
// -------------------------------------------------------------------

app.get('/v1/jobs', requireApiKey, (req: Request, res: Response) => {
  const agent = res.locals.agent as ReturnType<typeof findAgentByApiKey> & {}
  const jobs = findJobsByAgentId(agent!.agentId)
  res.json({ jobs })
})

// -------------------------------------------------------------------
// POST /v1/jobs/:id/reject
// Evaluator rejects a submitted deliverable — funds returned to client
// -------------------------------------------------------------------

app.post('/v1/jobs/:id/reject', requireApiKey, async (req: Request<{ id: string }>, res: Response) => {
  const agent = res.locals.agent as ReturnType<typeof findAgentByApiKey> & {}
  const { id } = req.params
  const { reason = '' } = req.body as { reason?: unknown }

  const job = findJobById(id)
  if (!job) {
    apiError(res, 404, 'JOB_NOT_FOUND', `Job ${id} not found`)
    return
  }
  if (job.agentId !== agent!.agentId) {
    apiError(res, 403, 'FORBIDDEN', 'This job does not belong to your agent')
    return
  }
  if (job.status !== 'submitted') {
    apiError(res, 409, 'INVALID_STATE', `Job is in status '${job.status}', expected 'submitted'`)
    return
  }

  // reject() must be called by the evaluator — same deployer wallet as complete()
  const evaluatorSigner = getDeployerWallet()
  if (!evaluatorSigner) {
    apiError(res, 500, 'CONFIG_ERROR', 'PRIVATE_KEY not set — evaluator wallet unavailable')
    return
  }

  try {
    const jobManager = getJobManagerWithSigner(evaluatorSigner)

    const reasonStr = typeof reason === 'string' ? reason : ''
    const reasonTruncated = reasonStr.length > 31
    // The reason field is stored as bytes32 on-chain — max 31 ASCII chars
    const reasonBytes = ethers.encodeBytes32String(reasonStr.slice(0, 31))

    const onChainJobId = BigInt(id)
    const nonce = await primaryProvider.getTransactionCount(await evaluatorSigner.getAddress(), 'pending')
    const gasEstimate = await jobManager.reject.estimateGas(onChainJobId, reasonBytes)
    const rejectTx = await jobManager.reject(onChainJobId, reasonBytes, {
      gasLimit: (gasEstimate * 120n) / 100n, nonce,
    })
    const rejectReceipt = await withTimeout(rejectTx.wait(1), 'reject confirmation')
    if (!rejectReceipt || rejectReceipt.status === 0) {
      apiError(res, 500, 'TX_FAILED', `reject transaction failed: ${basescanTx(rejectTx.hash)}`)
      return
    }

    updateJobStatus(id, 'rejected', rejectTx.hash)

    res.json({
      jobId: id,
      txHash: rejectTx.hash,
      basescanUrl: basescanTx(rejectTx.hash),
      status: 'rejected',
      ...(reasonTruncated && { warning: 'reason was truncated to 31 characters for on-chain storage' }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    apiError(res, 500, 'BLOCKCHAIN_ERROR', message)
  }
})

// -------------------------------------------------------------------
// GET /v1/agents/:id/balance
// Returns ETH and MockUSDC balances for a managed agent wallet
// -------------------------------------------------------------------

app.get('/v1/agents/:id/balance', requireApiKey, async (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params

  const agent = findAgentById(id)
  if (!agent) {
    apiError(res, 404, 'AGENT_NOT_FOUND', `Agent ${id} not found`)
    return
  }

  try {
    const [ethBalanceWei, usdcBalanceRaw] = await Promise.all([
      provider.getBalance(agent.address),
      getMockUSDCReadOnly().balanceOf(agent.address),
    ])

    res.json({
      agentId: id,
      address: agent.address,
      ethBalance: ethers.formatEther(ethBalanceWei),
      usdcBalance: ethers.formatUnits(usdcBalanceRaw, USDC_DECIMALS),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    apiError(res, 500, 'BLOCKCHAIN_ERROR', message)
  }
})

// -------------------------------------------------------------------
// GET /health
// Full liveness + readiness probe — checks RPC connectivity and storage.
// Returns 200 when all subsystems are healthy, 503 when any check fails.
// -------------------------------------------------------------------

app.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, 'ok' | 'error'> = {}

  // Verify RPC connectivity with a short timeout so a stalled node
  // does not block Railway's healthcheck and cause a false-positive restart.
  try {
    await Promise.race([
      provider.getBlockNumber(),
      new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3000)),
    ])
    checks.rpc = 'ok'
  } catch {
    checks.rpc = 'error'
  }

  // Verify storage is reachable — a SQLite read failure here means the
  // DB file is corrupted or the data directory has a permission issue.
  try {
    readAgents()
    checks.storage = 'ok'
  } catch {
    checks.storage = 'error'
  }

  const allOk = Object.values(checks).every((v) => v === 'ok')
  res.status(allOk ? 200 : 503).json({ ok: allOk, checks })
})

// -------------------------------------------------------------------
// GET /dashboard/stats  (internal — used only by the dashboard UI)
// Not part of the public v1 API; no API key required but undocumented.
// -------------------------------------------------------------------

app.get('/dashboard/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await withTimeout(getStats(), 'stats on-chain reads')
    res.json(stats)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    apiError(res, 500, 'STATS_ERROR', message)
  }
})

// -------------------------------------------------------------------
// GET /openapi.json  — machine-readable OpenAPI 3.0 spec
// GET /docs          — Swagger UI (interactive browser)
// -------------------------------------------------------------------

app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiSpec)
})

app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  customSiteTitle: 'ASP API Docs',
  customCss: '.swagger-ui .topbar { display: none }',
}))

// -------------------------------------------------------------------
// GET /dashboard
// Monitoring dashboard — self-contained HTML, no auth required
// -------------------------------------------------------------------

app.get('/dashboard', (req: Request, res: Response) => {
  // Relax helmet's default CSP for this route only (inline scripts needed)
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline';",
  )
  // Use a relative base so fetch() works regardless of protocol (avoids
  // mixed-content errors when Railway terminates TLS at the proxy layer).
  const apiBase = ''
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(getDashboardHtml(apiBase, BASESCAN_BASE))
})

// -------------------------------------------------------------------
// Server startup + graceful shutdown
// -------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`Agent Settlement API running on http://localhost:${PORT}`)
  console.log(`Network: ${manifest.network} (chainId ${manifest.chainId})`)
  console.log(`AgentJobManager: ${manifest.contracts.AgentJobManager.address}`)
  console.log(`MockUSDC:        ${manifest.contracts.MockUSDC.address}`)
})

// Railway sends SIGTERM before killing the container.
// We wait for in-flight requests to drain (max 10 s) before exiting
// so background blockchain handlers are not cut off mid-transaction.
const shutdown = (signal: string): void => {
  console.log(`[shutdown] Received ${signal}, closing server…`)
  server.close(() => {
    console.log('[shutdown] HTTP server closed.')
    process.exit(0)
  })
  // Force exit if the server has not drained within 10 s
  setTimeout(() => {
    console.error('[shutdown] Forced exit after 10s timeout')
    process.exit(1)
  }, 10_000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

export default app
