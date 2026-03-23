import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.join(__dirname, '../../.env') })
import express, { Request, Response, NextFunction } from 'express'
import bodyParser from 'body-parser'
import * as crypto from 'crypto'
import { ethers } from 'ethers'

import {
  saveAgent,
  saveJob,
  findAgentByApiKey,
  findAgentById,
  findJobById,
  findJobsByAgentId,
  updateJobStatus,
} from './storage'
import { generateWallet, walletFromEncrypted } from './wallet'
import {
  provider,
  manifest,
  getJobManagerReadOnly,
  getJobManagerWithSigner,
  getMockUSDCWithSigner,
  getMockUSDCReadOnly,
  JOB_STATUS_MAP,
  USDC_DECIMALS,
} from './contracts'

// -------------------------------------------------------------------
// App setup
// -------------------------------------------------------------------

const app = express()
app.use(bodyParser.json())

const PORT = parseInt(process.env.PORT ?? '3000', 10)

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function apiError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: message, code })
}

function basescanTx(txHash: string): string {
  return `https://sepolia.basescan.org/tx/${txHash}`
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
// POST /v1/agents
// Creates a managed wallet for a new agent and returns its address
// -------------------------------------------------------------------

app.post('/v1/agents', (req: Request, res: Response) => {
  const { name } = req.body as { name?: unknown }

  if (!name || typeof name !== 'string' || name.trim() === '') {
    apiError(res, 400, 'INVALID_NAME', 'name is required and must be a non-empty string')
    return
  }

  const wallet = generateWallet()
  const agentId = generateAgentId()
  const apiKey = generateApiKey()

  saveAgent({
    agentId,
    name: name.trim(),
    address: wallet.address,
    apiKey,
    encryptedPrivateKey: wallet.encryptedPrivateKey,
    createdAt: new Date().toISOString(),
  })

  // NOTE: The managed wallet needs ETH on Base Sepolia to pay gas.
  // Fund it manually from a faucet: https://faucet.quicknode.com/base/sepolia
  res.status(201).json({
    agentId,
    address: wallet.address,
    apiKey,
    note: 'Fund this address with Base Sepolia ETH to pay gas: https://faucet.quicknode.com/base/sepolia',
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
  const deadlineMins = Number(deadlineMinutes)
  if (!Number.isInteger(deadlineMins) || deadlineMins < 5 || deadlineMins > 10080) {
    apiError(res, 400, 'INVALID_DEADLINE', 'deadlineMinutes must be between 5 and 10080')
    return
  }

  try {
    const signer = walletFromEncrypted(agent!.encryptedPrivateKey, provider)
    const jobManager = getJobManagerWithSigner(signer)

    // Track nonce manually to avoid stale-nonce errors on L2 RPC nodes
    let nonce = await provider.getTransactionCount(await signer.getAddress(), 'pending')

    const budgetWei = ethers.parseUnits(budget, USDC_DECIMALS)
    // Deadline is a Unix timestamp — contract checks deadline > block.timestamp
    const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + deadlineMins * 60)

    // For the MVP, use the deployer wallet as the evaluator.
    // address(0) triggers auto-assignment from EvaluatorRegistry which requires
    // at least one registered staker — not yet set up on this testnet deployment.
    const evaluatorAddress = manifest.deployer
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
    const createReceipt = await createTx.wait(1)
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

    // Brief pause so the RPC node propagates the createJob confirmation before
    // estimateGas for setBudget — avoids JobNotFound on nodes with lag.
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Set the budget in a separate call as required by the ERC-8183 flow
    const setBudgetGas = await jobManager.setBudget.estimateGas(onChainJobId, budgetWei)
    const setBudgetTx = await jobManager.setBudget(onChainJobId, budgetWei, {
      gasLimit: (setBudgetGas * 120n) / 100n, nonce: nonce++,
    })
    const setBudgetReceipt = await setBudgetTx.wait(1)
    if (!setBudgetReceipt || setBudgetReceipt.status === 0) {
      apiError(res, 500, 'TX_FAILED', `setBudget transaction failed: ${basescanTx(setBudgetTx.hash)}`)
      return
    }

    const jobId = onChainJobId.toString()
    saveJob({
      jobId,
      agentId: agent!.agentId,
      txHash: createTx.hash,
      status: 'open',
      providerAddress,
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

  try {
    const signer = walletFromEncrypted(agent!.encryptedPrivateKey, provider)
    const usdc = getMockUSDCWithSigner(signer)
    const jobManager = getJobManagerWithSigner(signer)

    const budgetWei = ethers.parseUnits(job.budget, USDC_DECIMALS)
    const jobManagerAddress = manifest.contracts.AgentJobManager.address
    const agentAddress = await signer.getAddress()

    // Mint MockUSDC to the agent wallet so it has funds to cover the job budget
    let nonce = await provider.getTransactionCount(agentAddress, 'pending')

    const mintGas = await usdc.mint.estimateGas(agentAddress, budgetWei)
    const mintTx = await usdc.mint(agentAddress, budgetWei, {
      gasLimit: (mintGas * 120n) / 100n, nonce: nonce++,
    })
    await mintTx.wait(1)

    // Approve the maximum possible amount so the agent never needs a second approval
    // when creating more jobs with the same token — saves a transaction in the future
    const approveGas = await usdc.approve.estimateGas(jobManagerAddress, ethers.MaxUint256)
    const approveTx = await usdc.approve(jobManagerAddress, ethers.MaxUint256, {
      gasLimit: (approveGas * 120n) / 100n, nonce: nonce++,
    })
    await approveTx.wait(1)

    // Call fund() — passes expectedBudget so the contract can validate nothing changed
    const onChainJobId = BigInt(id)
    const fundGas = await jobManager.fund.estimateGas(onChainJobId, budgetWei)
    const fundTx = await jobManager.fund(onChainJobId, budgetWei, {
      gasLimit: (fundGas * 120n) / 100n, nonce: nonce++,
    })
    const fundReceipt = await fundTx.wait(1)
    if (!fundReceipt || fundReceipt.status === 0) {
      apiError(res, 500, 'TX_FAILED', `fund transaction failed: ${basescanTx(fundTx.hash)}`)
      return
    }

    updateJobStatus(id, 'funded', fundTx.hash)

    res.json({
      jobId: id,
      txHash: fundTx.hash,
      basescanUrl: basescanTx(fundTx.hash),
      status: 'funded',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    apiError(res, 500, 'BLOCKCHAIN_ERROR', message)
  }
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

  try {
    const signer = walletFromEncrypted(agent!.encryptedPrivateKey, provider)
    const jobManager = getJobManagerWithSigner(signer)

    // ERC-8183 submit() expects a bytes32 hash of the deliverable, not the raw content.
    // The actual deliverable should be stored off-chain (IPFS, S3, etc.).
    const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes(deliverable))

    const onChainJobId = BigInt(id)
    const nonce = await provider.getTransactionCount(await signer.getAddress(), 'pending')
    const gasEstimate = await jobManager.submit.estimateGas(onChainJobId, deliverableHash)
    const submitTx = await jobManager.submit(onChainJobId, deliverableHash, {
      gasLimit: (gasEstimate * 120n) / 100n, nonce,
    })
    const submitReceipt = await submitTx.wait(1)
    if (!submitReceipt || submitReceipt.status === 0) {
      apiError(res, 500, 'TX_FAILED', `submit transaction failed: ${basescanTx(submitTx.hash)}`)
      return
    }

    updateJobStatus(id, 'submitted', submitTx.hash)

    res.json({
      jobId: id,
      txHash: submitTx.hash,
      basescanUrl: basescanTx(submitTx.hash),
      status: 'submitted',
      deliverableHash,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    apiError(res, 500, 'BLOCKCHAIN_ERROR', message)
  }
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

  try {
    // complete() must be called by the evaluator — in this MVP the deployer wallet
    // plays the evaluator role. Load it from PRIVATE_KEY env variable.
    const evaluatorPrivateKey = process.env.PRIVATE_KEY
    if (!evaluatorPrivateKey) {
      apiError(res, 500, 'CONFIG_ERROR', 'PRIVATE_KEY not set — evaluator wallet unavailable')
      return
    }
    const evaluatorSigner = new ethers.Wallet(evaluatorPrivateKey, provider)
    const jobManager = getJobManagerWithSigner(evaluatorSigner)

    const reasonStr = typeof reason === 'string' ? reason : ''
    // The reason field is stored as bytes32 on-chain
    const reasonBytes = ethers.encodeBytes32String(reasonStr.slice(0, 31))

    const onChainJobId = BigInt(id)
    const nonce = await provider.getTransactionCount(await evaluatorSigner.getAddress(), 'pending')
    const gasEstimate = await jobManager.complete.estimateGas(onChainJobId, reasonBytes)
    const completeTx = await jobManager.complete(onChainJobId, reasonBytes, {
      gasLimit: (gasEstimate * 120n) / 100n, nonce,
    })
    const completeReceipt = await completeTx.wait(1)
    if (!completeReceipt || completeReceipt.status === 0) {
      apiError(res, 500, 'TX_FAILED', `complete transaction failed: ${basescanTx(completeTx.hash)}`)
      return
    }

    updateJobStatus(id, 'completed', completeTx.hash)

    res.json({
      jobId: id,
      txHash: completeTx.hash,
      basescanUrl: basescanTx(completeTx.hash),
      status: 'completed',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    apiError(res, 500, 'BLOCKCHAIN_ERROR', message)
  }
})

// -------------------------------------------------------------------
// GET /v1/jobs/:id
// Reads the live on-chain state of a job
// -------------------------------------------------------------------

app.get('/v1/jobs/:id', async (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params

  try {
    const onChainJobId = BigInt(id)
    const jobManager = getJobManagerReadOnly()
    const jobData = await jobManager.getJob(onChainJobId)

    const statusIndex = Number(jobData.status)
    const statusLabel = JOB_STATUS_MAP[statusIndex] ?? 'unknown'

    res.json({
      jobId: id,
      status: statusLabel,
      client: jobData.client,
      provider: jobData.provider,
      evaluator: jobData.evaluator,
      token: jobData.token,
      budget: ethers.formatUnits(jobData.budget, USDC_DECIMALS),
      deadline: new Date(Number(jobData.deadline) * 1000).toISOString(),
      createdAt: new Date(Number(jobData.createdAt) * 1000).toISOString(),
      deliverableHash: jobData.deliverable !== ethers.ZeroHash ? jobData.deliverable : null,
      reason: jobData.reason !== ethers.ZeroHash ? ethers.decodeBytes32String(jobData.reason) : null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // A BigInt conversion failure means the id is not a valid job ID
    if (message.includes('Cannot convert') || message.includes('invalid BigInt')) {
      apiError(res, 400, 'INVALID_JOB_ID', 'jobId must be a numeric string')
      return
    }
    apiError(res, 500, 'BLOCKCHAIN_ERROR', message)
  }
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

  try {
    // reject() must be called by the evaluator — same deployer wallet as complete()
    const evaluatorPrivateKey = process.env.PRIVATE_KEY
    if (!evaluatorPrivateKey) {
      apiError(res, 500, 'CONFIG_ERROR', 'PRIVATE_KEY not set — evaluator wallet unavailable')
      return
    }
    const evaluatorSigner = new ethers.Wallet(evaluatorPrivateKey, provider)
    const jobManager = getJobManagerWithSigner(evaluatorSigner)

    const reasonStr = typeof reason === 'string' ? reason : ''
    const reasonBytes = ethers.encodeBytes32String(reasonStr.slice(0, 31))

    const onChainJobId = BigInt(id)
    const nonce = await provider.getTransactionCount(await evaluatorSigner.getAddress(), 'pending')
    const gasEstimate = await jobManager.reject.estimateGas(onChainJobId, reasonBytes)
    const rejectTx = await jobManager.reject(onChainJobId, reasonBytes, {
      gasLimit: (gasEstimate * 120n) / 100n, nonce,
    })
    const rejectReceipt = await rejectTx.wait(1)
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

app.get('/v1/agents/:id/balance', async (req: Request<{ id: string }>, res: Response) => {
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
// Server startup
// -------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Agent Settlement API running on http://localhost:${PORT}`)
  console.log(`Network: ${manifest.network} (chainId ${manifest.chainId})`)
  console.log(`AgentJobManager: ${manifest.contracts.AgentJobManager.address}`)
  console.log(`MockUSDC:        ${manifest.contracts.MockUSDC.address}`)
})

export default app
