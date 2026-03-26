"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
dotenv.config({ path: path.join(process.cwd(), '..', '.env') });
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const crypto = __importStar(require("crypto"));
const ethers_1 = require("ethers");
const storage_1 = require("./storage");
const wallet_1 = require("./wallet");
const contracts_1 = require("./contracts");
const stats_1 = require("./stats");
const dashboard_1 = require("./dashboard");
// -------------------------------------------------------------------
// Global error safety net — catches any unhandled promise rejection or
// synchronous exception that escapes the normal try/catch blocks.
// Without this, Node.js silently ignores them (Node < 15) or crashes (Node 15+).
// -------------------------------------------------------------------
process.on('unhandledRejection', (reason, promise) => {
    console.error('[unhandledRejection]', reason, promise);
});
process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
});
// -------------------------------------------------------------------
// App setup
// -------------------------------------------------------------------
const app = (0, express_1.default)();
// CORS — open during testnet/developer-testing phase
// Tighten to specific origins before production
app.use((0, cors_1.default)());
// Security headers (XSS protection, content-type sniffing, etc.)
app.use((0, helmet_1.default)());
// IP-based rate limiting — 120 requests / 15 min per IP
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.', code: 'RATE_LIMITED' },
});
app.use(limiter);
app.use(body_parser_1.default.json());
const PORT = parseInt(process.env.PORT ?? '3000', 10);
// Blockchain call timeout — transactions that are not confirmed within this
// window are considered failed (avoids hanging forever on a slow RPC node).
const BLOCKCHAIN_TIMEOUT_MS = 90_000;
// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function apiError(res, status, code, message) {
    console.error(`[apiError] ${status} ${code}: ${message}`);
    res.status(status).json({ error: message, code });
}
function basescanTx(txHash) {
    return `https://sepolia.basescan.org/tx/${txHash}`;
}
// Wraps any promise with a hard timeout so blockchain calls never hang forever.
function withTimeout(promise, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Operation timed out after ${BLOCKCHAIN_TIMEOUT_MS / 1000}s: ${label}`)), BLOCKCHAIN_TIMEOUT_MS)),
    ]);
}
// Polls getJob() until the job record is visible on the RPC node (post-createJob).
// This replaces the fragile fixed sleep(2000) that was previously used.
async function waitForJobOnChain(jobManager, jobId, maxAttempts = 12, delayMs = 500) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const job = await jobManager.getJob(jobId);
            if (job.client !== ethers_1.ethers.ZeroAddress)
                return;
        }
        catch { /* not visible yet */ }
        await new Promise((r) => setTimeout(r, delayMs));
    }
    throw new Error(`Job ${jobId} not found on-chain after ${maxAttempts} attempts`);
}
// Generates a random 32-byte API key as a hex string
function generateApiKey() {
    return crypto.randomBytes(32).toString('hex');
}
// Generates a random UUID-style agent ID
function generateAgentId() {
    return crypto.randomUUID();
}
// -------------------------------------------------------------------
// Auth middleware
// -------------------------------------------------------------------
function requireApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || typeof apiKey !== 'string') {
        apiError(res, 401, 'MISSING_API_KEY', 'x-api-key header is required');
        return;
    }
    const agent = (0, storage_1.findAgentByApiKey)(apiKey);
    if (!agent) {
        apiError(res, 401, 'INVALID_API_KEY', 'API key is invalid');
        return;
    }
    // Attach agent to request for downstream handlers
    res.locals.agent = agent;
    next();
}
// -------------------------------------------------------------------
// POST /v1/faucet/usdc
// Testnet only — mints MockUSDC to any address via the deployer wallet
// -------------------------------------------------------------------
app.post('/v1/faucet/usdc', async (req, res) => {
    const { address, amount = '100' } = req.body;
    if (!address || typeof address !== 'string' || !ethers_1.ethers.isAddress(address)) {
        apiError(res, 400, 'INVALID_ADDRESS', 'address must be a valid Ethereum address');
        return;
    }
    const amountStr = String(amount);
    if (!/^\d+(\.\d+)?$/.test(amountStr)) {
        apiError(res, 400, 'INVALID_AMOUNT', 'amount must be a decimal string (e.g. "100")');
        return;
    }
    if (!getDeployerWallet()) {
        apiError(res, 503, 'NO_DEPLOYER', 'Deployer key not configured');
        return;
    }
    res.json({ address, amount: amountStr, status: 'processing' });
    setImmediate(async () => {
        try {
            const deployer = getDeployerWallet();
            const usdc = (0, contracts_1.getMockUSDCWithSigner)(deployer);
            const amountWei = ethers_1.ethers.parseUnits(amountStr, contracts_1.USDC_DECIMALS);
            const tx = await usdc.mint(address, amountWei);
            const receipt = await withTimeout(tx.wait(1), 'faucet mint');
            if (!receipt || receipt.status === 0) {
                console.error(`[faucet] Mint transaction reverted for ${address}`);
                return;
            }
            console.log(`[faucet] Minted ${amountStr} USDC to ${address} — ${basescanTx(tx.hash)}`);
        }
        catch (err) {
            console.error(`[faucet] Failed to mint USDC to ${address}:`, err);
        }
    });
});
// -------------------------------------------------------------------
// POST /v1/agents
// Creates a managed wallet for a new agent and returns its address
// -------------------------------------------------------------------
// Amount of ETH sent to each new agent wallet — enough for ~50 txs on Base
const AGENT_SEED_ETH = ethers_1.ethers.parseEther('0.001');
// Singleton deployer wallet — reused across all seed calls so ethers.js
// manages the nonce internally and avoids reuse on concurrent requests.
let _deployerWallet = null;
function getDeployerWallet() {
    if (_deployerWallet)
        return _deployerWallet;
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey)
        return null;
    _deployerWallet = new ethers_1.ethers.Wallet(privateKey, contracts_1.provider);
    return _deployerWallet;
}
// Serial seed queue — prevents concurrent seed calls from colliding on nonce.
let _seedQueue = Promise.resolve();
async function seedAgentWallet(agentAddress) {
    _seedQueue = _seedQueue.then(async () => {
        const deployer = getDeployerWallet();
        if (!deployer)
            return;
        try {
            const balance = await contracts_1.provider.getBalance(deployer.address);
            if (balance < AGENT_SEED_ETH) {
                console.warn(`Deployer balance too low to seed agent wallet ${agentAddress}`);
                return;
            }
            const tx = await deployer.sendTransaction({ to: agentAddress, value: AGENT_SEED_ETH });
            await tx.wait(1);
            console.log(`Seeded ${agentAddress} with ${ethers_1.ethers.formatEther(AGENT_SEED_ETH)} ETH`);
        }
        catch (err) {
            console.warn(`Failed to seed agent wallet ${agentAddress}:`, err);
        }
    });
    await _seedQueue;
}
app.post('/v1/agents', async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
        apiError(res, 400, 'INVALID_NAME', 'name is required and must be a non-empty string');
        return;
    }
    const wallet = (0, wallet_1.generateWallet)();
    const agentId = generateAgentId();
    const apiKey = generateApiKey();
    (0, storage_1.saveAgent)({
        agentId,
        name: name.trim(),
        address: wallet.address,
        apiKey,
        encryptedPrivateKey: wallet.encryptedPrivateKey,
        createdAt: new Date().toISOString(),
    });
    // Auto-fund the new wallet from the deployer so it can pay gas immediately
    await seedAgentWallet(wallet.address);
    res.status(201).json({
        agentId,
        address: wallet.address,
        apiKey,
    });
});
// -------------------------------------------------------------------
// POST /v1/jobs
// Creates a job on-chain from the agent's wallet
// -------------------------------------------------------------------
app.post('/v1/jobs', requireApiKey, async (req, res) => {
    const agent = res.locals.agent;
    const { providerAddress, budget, deadlineMinutes = 60 } = req.body;
    // Validate inputs
    if (!providerAddress || typeof providerAddress !== 'string') {
        apiError(res, 400, 'INVALID_PROVIDER', 'providerAddress is required');
        return;
    }
    if (!ethers_1.ethers.isAddress(providerAddress)) {
        apiError(res, 400, 'INVALID_ADDRESS', 'providerAddress is not a valid Ethereum address');
        return;
    }
    if (!budget || typeof budget !== 'string' || !/^\d+(\.\d+)?$/.test(budget)) {
        apiError(res, 400, 'INVALID_BUDGET', 'budget must be a decimal string (e.g. "5.00")');
        return;
    }
    const deadlineMins = Number(deadlineMinutes);
    if (!Number.isInteger(deadlineMins) || deadlineMins < 5 || deadlineMins > 10080) {
        apiError(res, 400, 'INVALID_DEADLINE', 'deadlineMinutes must be between 5 and 10080');
        return;
    }
    try {
        const signer = (0, wallet_1.walletFromEncrypted)(agent.encryptedPrivateKey, contracts_1.provider);
        const jobManager = (0, contracts_1.getJobManagerWithSigner)(signer);
        // Track nonce manually to avoid stale-nonce errors on L2 RPC nodes
        let nonce = await contracts_1.provider.getTransactionCount(await signer.getAddress(), 'pending');
        const budgetWei = ethers_1.ethers.parseUnits(budget, contracts_1.USDC_DECIMALS);
        // Deadline is a Unix timestamp — contract checks deadline > block.timestamp
        const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + deadlineMins * 60);
        // For the MVP, use the deployer wallet as the evaluator.
        // address(0) triggers auto-assignment from EvaluatorRegistry which requires
        // at least one registered staker — not yet set up on this testnet deployment.
        const evaluatorAddress = contracts_1.manifest.deployer;
        const tokenAddress = contracts_1.manifest.contracts.MockUSDC.address;
        // Estimate gas first so we fail fast with a clear message if the tx would revert
        const gasEstimate = await jobManager.createJob.estimateGas(providerAddress, evaluatorAddress, tokenAddress, deadlineTimestamp);
        const createTx = await jobManager.createJob(providerAddress, evaluatorAddress, tokenAddress, deadlineTimestamp, { gasLimit: (gasEstimate * 120n) / 100n, nonce: nonce++ });
        const createReceipt = await withTimeout(createTx.wait(1), 'createJob confirmation');
        if (!createReceipt || createReceipt.status === 0) {
            apiError(res, 500, 'TX_FAILED', `createJob transaction failed: ${basescanTx(createTx.hash)}`);
            return;
        }
        // Parse JobCreated event to get the on-chain jobId
        const jobCreatedLog = createReceipt.logs
            .map((log) => {
            try {
                return jobManager.interface.parseLog(log);
            }
            catch {
                return null;
            }
        })
            .find((parsed) => parsed?.name === 'JobCreated');
        if (!jobCreatedLog) {
            apiError(res, 500, 'EVENT_NOT_FOUND', 'JobCreated event not found in receipt');
            return;
        }
        const onChainJobId = jobCreatedLog.args[0];
        // Wait until the job is visible on the RPC node before calling setBudget.
        // This replaces a fixed sleep — the retry loop is more reliable on slow nodes.
        await waitForJobOnChain((0, contracts_1.getJobManagerReadOnly)(), onChainJobId);
        // Set the budget in a separate call as required by the ERC-8183 flow
        const setBudgetGas = await jobManager.setBudget.estimateGas(onChainJobId, budgetWei);
        const setBudgetTx = await jobManager.setBudget(onChainJobId, budgetWei, {
            gasLimit: (setBudgetGas * 120n) / 100n, nonce: nonce++,
        });
        const setBudgetReceipt = await withTimeout(setBudgetTx.wait(1), 'setBudget confirmation');
        if (!setBudgetReceipt || setBudgetReceipt.status === 0) {
            apiError(res, 500, 'TX_FAILED', `setBudget transaction failed: ${basescanTx(setBudgetTx.hash)}`);
            return;
        }
        const jobId = onChainJobId.toString();
        (0, storage_1.saveJob)({
            jobId,
            agentId: agent.agentId,
            txHash: createTx.hash,
            status: 'open',
            providerAddress,
            budget,
            deadlineMinutes: deadlineMins,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        res.status(201).json({
            jobId,
            txHash: createTx.hash,
            basescanUrl: basescanTx(createTx.hash),
            status: 'open',
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        apiError(res, 500, 'BLOCKCHAIN_ERROR', message);
    }
});
// -------------------------------------------------------------------
// POST /v1/jobs/:id/fund
// Mints MockUSDC, approves AgentJobManager, calls fund()
// -------------------------------------------------------------------
app.post('/v1/jobs/:id/fund', requireApiKey, async (req, res) => {
    const agent = res.locals.agent;
    const { id } = req.params;
    const job = (0, storage_1.findJobById)(id);
    if (!job) {
        apiError(res, 404, 'JOB_NOT_FOUND', `Job ${id} not found`);
        return;
    }
    if (job.agentId !== agent.agentId) {
        apiError(res, 403, 'FORBIDDEN', 'This job does not belong to your agent');
        return;
    }
    if (job.status !== 'open') {
        apiError(res, 409, 'INVALID_STATE', `Job is in status '${job.status}', expected 'open'`);
        return;
    }
    // Fail fast: check the agent wallet has enough USDC before going async.
    // Avoids the confusing "job stays open forever" symptom when USDC is missing.
    try {
        const signer = (0, wallet_1.walletFromEncrypted)(agent.encryptedPrivateKey, contracts_1.provider);
        const agentAddress = await signer.getAddress();
        const budgetWei = ethers_1.ethers.parseUnits(job.budget, contracts_1.USDC_DECIMALS);
        const usdcBalance = await (0, contracts_1.getMockUSDCReadOnly)().balanceOf(agentAddress);
        if (usdcBalance < budgetWei) {
            apiError(res, 402, 'INSUFFICIENT_USDC', `Agent wallet has ${ethers_1.ethers.formatUnits(usdcBalance, contracts_1.USDC_DECIMALS)} USDC but job budget is ${job.budget} USDC — call POST /v1/faucet/usdc first`);
            return;
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        apiError(res, 500, 'BLOCKCHAIN_ERROR', `Pre-flight check failed: ${message}`);
        return;
    }
    res.status(202).json({ jobId: id, status: 'processing' });
    setImmediate(async () => {
        console.log(`[fund] Background handler started for job ${id}`);
        try {
            const signer = (0, wallet_1.walletFromEncrypted)(agent.encryptedPrivateKey, contracts_1.provider);
            const usdc = (0, contracts_1.getMockUSDCWithSigner)(signer);
            const jobManager = (0, contracts_1.getJobManagerWithSigner)(signer);
            const budgetWei = ethers_1.ethers.parseUnits(job.budget, contracts_1.USDC_DECIMALS);
            const jobManagerAddress = contracts_1.manifest.contracts.AgentJobManager.address;
            const agentAddress = await signer.getAddress();
            console.log(`[fund] Wallet ${agentAddress}, budget ${job.budget} USDC`);
            let nonce = await contracts_1.provider.getTransactionCount(agentAddress, 'pending');
            console.log(`[fund] Starting nonce: ${nonce}`);
            // Approve the maximum possible amount so the agent never needs a second approval
            // when creating more jobs with the same token — saves a transaction in the future.
            // Note: we do NOT mint here — the client must already hold USDC (use POST /v1/faucet/usdc).
            console.log(`[fund] Step 1/2 — approving USDC allowance…`);
            const approveGas = await usdc.approve.estimateGas(jobManagerAddress, ethers_1.ethers.MaxUint256);
            const approveTx = await usdc.approve(jobManagerAddress, ethers_1.ethers.MaxUint256, {
                gasLimit: (approveGas * 120n) / 100n, nonce: nonce++,
            });
            console.log(`[fund] approve tx sent: ${approveTx.hash}`);
            await withTimeout(approveTx.wait(1), 'approve confirmation');
            console.log(`[fund] approve confirmed`);
            // Call fund() — passes expectedBudget so the contract can validate nothing changed
            console.log(`[fund] Step 2/2 — calling fund()…`);
            const onChainJobId = BigInt(id);
            const fundGas = await jobManager.fund.estimateGas(onChainJobId, budgetWei);
            const fundTx = await jobManager.fund(onChainJobId, budgetWei, {
                gasLimit: (fundGas * 120n) / 100n, nonce: nonce++,
            });
            console.log(`[fund] fund tx sent: ${fundTx.hash}`);
            const fundReceipt = await withTimeout(fundTx.wait(1), 'fund confirmation');
            if (!fundReceipt || fundReceipt.status === 0) {
                console.error(`[fund] Transaction reverted for job ${id}: ${basescanTx(fundTx.hash)}`);
                return;
            }
            (0, storage_1.updateJobStatus)(id, 'funded', fundTx.hash);
            console.log(`[fund] Job ${id} funded — ${basescanTx(fundTx.hash)}`);
        }
        catch (err) {
            console.error(`[fund] Failed to fund job ${id}:`, err);
        }
    });
});
// -------------------------------------------------------------------
// POST /v1/jobs/:id/submit
// Hashes the deliverable and calls submit() from the provider's wallet
// -------------------------------------------------------------------
app.post('/v1/jobs/:id/submit', requireApiKey, async (req, res) => {
    const agent = res.locals.agent;
    const { id } = req.params;
    const { deliverable } = req.body;
    if (!deliverable || typeof deliverable !== 'string' || deliverable.trim() === '') {
        apiError(res, 400, 'INVALID_DELIVERABLE', 'deliverable is required and must be a non-empty string');
        return;
    }
    const job = (0, storage_1.findJobById)(id);
    if (!job) {
        apiError(res, 404, 'JOB_NOT_FOUND', `Job ${id} not found`);
        return;
    }
    // submit() must be called by the provider, not the job creator
    if (agent.address.toLowerCase() !== job.providerAddress.toLowerCase()) {
        apiError(res, 403, 'FORBIDDEN', 'Only the provider can submit a deliverable');
        return;
    }
    if (job.status !== 'funded') {
        apiError(res, 409, 'INVALID_STATE', `Job is in status '${job.status}', expected 'funded'`);
        return;
    }
    res.status(202).json({ jobId: id, status: 'processing' });
    setImmediate(async () => {
        console.log(`[submit] Background handler started for job ${id}`);
        try {
            const signer = (0, wallet_1.walletFromEncrypted)(agent.encryptedPrivateKey, contracts_1.provider);
            const jobManager = (0, contracts_1.getJobManagerWithSigner)(signer);
            const providerAddress = await signer.getAddress();
            console.log(`[submit] Provider wallet: ${providerAddress}`);
            // ERC-8183 submit() expects a bytes32 hash of the deliverable, not the raw content.
            // The actual deliverable should be stored off-chain (IPFS, S3, etc.).
            const deliverableHash = ethers_1.ethers.keccak256(ethers_1.ethers.toUtf8Bytes(deliverable));
            console.log(`[submit] Deliverable hash: ${deliverableHash}`);
            const onChainJobId = BigInt(id);
            const nonce = await contracts_1.provider.getTransactionCount(providerAddress, 'pending');
            console.log(`[submit] Nonce: ${nonce}`);
            console.log(`[submit] Estimating gas for submit()…`);
            const gasEstimate = await jobManager.submit.estimateGas(onChainJobId, deliverableHash);
            console.log(`[submit] Gas estimate: ${gasEstimate}`);
            const submitTx = await jobManager.submit(onChainJobId, deliverableHash, {
                gasLimit: (gasEstimate * 120n) / 100n, nonce,
            });
            console.log(`[submit] tx sent: ${submitTx.hash}`);
            const submitReceipt = await withTimeout(submitTx.wait(1), 'submit confirmation');
            if (!submitReceipt || submitReceipt.status === 0) {
                console.error(`[submit] Transaction reverted for job ${id}: ${basescanTx(submitTx.hash)}`);
                return;
            }
            (0, storage_1.updateJobStatus)(id, 'submitted', submitTx.hash);
            console.log(`[submit] Job ${id} submitted — ${basescanTx(submitTx.hash)}`);
        }
        catch (err) {
            console.error(`[submit] Failed to submit job ${id}:`, err);
        }
    });
});
// -------------------------------------------------------------------
// POST /v1/jobs/:id/complete
// Calls complete() from the evaluator's wallet
// In this MVP the evaluator role is played by the same agent wallet
// -------------------------------------------------------------------
app.post('/v1/jobs/:id/complete', requireApiKey, async (req, res) => {
    const agent = res.locals.agent;
    const { id } = req.params;
    const { reason = '' } = req.body;
    const job = (0, storage_1.findJobById)(id);
    if (!job) {
        apiError(res, 404, 'JOB_NOT_FOUND', `Job ${id} not found`);
        return;
    }
    if (job.agentId !== agent.agentId) {
        apiError(res, 403, 'FORBIDDEN', 'This job does not belong to your agent');
        return;
    }
    if (job.status !== 'submitted') {
        apiError(res, 409, 'INVALID_STATE', `Job is in status '${job.status}', expected 'submitted'`);
        return;
    }
    // complete() must be called by the evaluator — in this MVP the deployer wallet
    // plays the evaluator role. Fail fast synchronously if the key is missing.
    const evaluatorSigner = getDeployerWallet();
    if (!evaluatorSigner) {
        apiError(res, 500, 'CONFIG_ERROR', 'PRIVATE_KEY not set — evaluator wallet unavailable');
        return;
    }
    res.status(202).json({ jobId: id, status: 'processing' });
    setImmediate(async () => {
        console.log(`[complete] Background handler started for job ${id}`);
        try {
            const jobManager = (0, contracts_1.getJobManagerWithSigner)(evaluatorSigner);
            const evaluatorAddress = await evaluatorSigner.getAddress();
            console.log(`[complete] Evaluator wallet: ${evaluatorAddress}`);
            const reasonStr = typeof reason === 'string' ? reason : '';
            const reasonTruncated = reasonStr.length > 31;
            // The reason field is stored as bytes32 on-chain — max 31 ASCII chars
            const reasonBytes = ethers_1.ethers.encodeBytes32String(reasonStr.slice(0, 31));
            const onChainJobId = BigInt(id);
            const nonce = await contracts_1.provider.getTransactionCount(evaluatorAddress, 'pending');
            console.log(`[complete] Nonce: ${nonce}`);
            console.log(`[complete] Estimating gas for complete()…`);
            const gasEstimate = await jobManager.complete.estimateGas(onChainJobId, reasonBytes);
            console.log(`[complete] Gas estimate: ${gasEstimate}`);
            const completeTx = await jobManager.complete(onChainJobId, reasonBytes, {
                gasLimit: (gasEstimate * 120n) / 100n, nonce,
            });
            console.log(`[complete] tx sent: ${completeTx.hash}`);
            const completeReceipt = await withTimeout(completeTx.wait(1), 'complete confirmation');
            if (!completeReceipt || completeReceipt.status === 0) {
                console.error(`[complete] Transaction reverted for job ${id}: ${basescanTx(completeTx.hash)}`);
                return;
            }
            (0, storage_1.updateJobStatus)(id, 'completed', completeTx.hash);
            console.log(`[complete] Job ${id} completed — ${basescanTx(completeTx.hash)}${reasonTruncated ? ' (reason truncated)' : ''}`);
        }
        catch (err) {
            console.error(`[complete] Failed to complete job ${id}:`, err);
        }
    });
});
// -------------------------------------------------------------------
// GET /v1/jobs/:id
// Returns the stored job record — clients use this to poll status after
// receiving a 202 from fund/submit/complete (which process in background).
// -------------------------------------------------------------------
app.get('/v1/jobs/:id', async (req, res) => {
    const job = (0, storage_1.findJobById)(req.params.id);
    if (!job) {
        apiError(res, 404, 'JOB_NOT_FOUND', `Job ${req.params.id} not found`);
        return;
    }
    // Auto-reconcile: if the background handler timed out before updating storage,
    // the on-chain state will be ahead of local storage. Detect and fix silently.
    const terminalStatuses = ['completed', 'rejected', 'expired'];
    if (!terminalStatuses.includes(job.status)) {
        try {
            const onChainJob = await (0, contracts_1.getJobManagerReadOnly)().getJob(BigInt(job.jobId));
            const onChainStatus = contracts_1.JOB_STATUS_MAP[Number(onChainJob.status)];
            if (onChainStatus && onChainStatus !== job.status) {
                console.log(`[sync] Job ${job.jobId}: local=${job.status} → on-chain=${onChainStatus}`);
                (0, storage_1.updateJobStatus)(job.jobId, onChainStatus);
                return res.json({ ...job, status: onChainStatus });
            }
        }
        catch (err) {
            // Non-fatal: return stored status if the RPC call fails
            console.warn(`[sync] Failed to read on-chain status for job ${job.jobId}:`, err);
        }
    }
    res.json(job);
});
// -------------------------------------------------------------------
// GET /v1/jobs
// Lists all jobs created by the authenticated agent
// -------------------------------------------------------------------
app.get('/v1/jobs', requireApiKey, (req, res) => {
    const agent = res.locals.agent;
    const jobs = (0, storage_1.findJobsByAgentId)(agent.agentId);
    res.json({ jobs });
});
// -------------------------------------------------------------------
// POST /v1/jobs/:id/reject
// Evaluator rejects a submitted deliverable — funds returned to client
// -------------------------------------------------------------------
app.post('/v1/jobs/:id/reject', requireApiKey, async (req, res) => {
    const agent = res.locals.agent;
    const { id } = req.params;
    const { reason = '' } = req.body;
    const job = (0, storage_1.findJobById)(id);
    if (!job) {
        apiError(res, 404, 'JOB_NOT_FOUND', `Job ${id} not found`);
        return;
    }
    if (job.agentId !== agent.agentId) {
        apiError(res, 403, 'FORBIDDEN', 'This job does not belong to your agent');
        return;
    }
    if (job.status !== 'submitted') {
        apiError(res, 409, 'INVALID_STATE', `Job is in status '${job.status}', expected 'submitted'`);
        return;
    }
    // reject() must be called by the evaluator — same deployer wallet as complete()
    const evaluatorSigner = getDeployerWallet();
    if (!evaluatorSigner) {
        apiError(res, 500, 'CONFIG_ERROR', 'PRIVATE_KEY not set — evaluator wallet unavailable');
        return;
    }
    try {
        const jobManager = (0, contracts_1.getJobManagerWithSigner)(evaluatorSigner);
        const reasonStr = typeof reason === 'string' ? reason : '';
        const reasonTruncated = reasonStr.length > 31;
        // The reason field is stored as bytes32 on-chain — max 31 ASCII chars
        const reasonBytes = ethers_1.ethers.encodeBytes32String(reasonStr.slice(0, 31));
        const onChainJobId = BigInt(id);
        const nonce = await contracts_1.provider.getTransactionCount(await evaluatorSigner.getAddress(), 'pending');
        const gasEstimate = await jobManager.reject.estimateGas(onChainJobId, reasonBytes);
        const rejectTx = await jobManager.reject(onChainJobId, reasonBytes, {
            gasLimit: (gasEstimate * 120n) / 100n, nonce,
        });
        const rejectReceipt = await withTimeout(rejectTx.wait(1), 'reject confirmation');
        if (!rejectReceipt || rejectReceipt.status === 0) {
            apiError(res, 500, 'TX_FAILED', `reject transaction failed: ${basescanTx(rejectTx.hash)}`);
            return;
        }
        (0, storage_1.updateJobStatus)(id, 'rejected', rejectTx.hash);
        res.json({
            jobId: id,
            txHash: rejectTx.hash,
            basescanUrl: basescanTx(rejectTx.hash),
            status: 'rejected',
            ...(reasonTruncated && { warning: 'reason was truncated to 31 characters for on-chain storage' }),
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        apiError(res, 500, 'BLOCKCHAIN_ERROR', message);
    }
});
// -------------------------------------------------------------------
// GET /v1/agents/:id/balance
// Returns ETH and MockUSDC balances for a managed agent wallet
// -------------------------------------------------------------------
app.get('/v1/agents/:id/balance', async (req, res) => {
    const { id } = req.params;
    const agent = (0, storage_1.findAgentById)(id);
    if (!agent) {
        apiError(res, 404, 'AGENT_NOT_FOUND', `Agent ${id} not found`);
        return;
    }
    try {
        const [ethBalanceWei, usdcBalanceRaw] = await Promise.all([
            contracts_1.provider.getBalance(agent.address),
            (0, contracts_1.getMockUSDCReadOnly)().balanceOf(agent.address),
        ]);
        res.json({
            agentId: id,
            address: agent.address,
            ethBalance: ethers_1.ethers.formatEther(ethBalanceWei),
            usdcBalance: ethers_1.ethers.formatUnits(usdcBalanceRaw, contracts_1.USDC_DECIMALS),
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        apiError(res, 500, 'BLOCKCHAIN_ERROR', message);
    }
});
// -------------------------------------------------------------------
// GET /health
// Lightweight liveness probe for Railway healthchecks — no RPC calls
// -------------------------------------------------------------------
app.get('/health', (_req, res) => {
    res.json({ ok: true });
});
// -------------------------------------------------------------------
// GET /dashboard/stats  (internal — used only by the dashboard UI)
// Not part of the public v1 API; no API key required but undocumented.
// -------------------------------------------------------------------
app.get('/dashboard/stats', async (_req, res) => {
    try {
        const stats = await withTimeout((0, stats_1.getStats)(), 'stats on-chain reads');
        res.json(stats);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        apiError(res, 500, 'STATS_ERROR', message);
    }
});
// -------------------------------------------------------------------
// GET /dashboard
// Monitoring dashboard — self-contained HTML, no auth required
// -------------------------------------------------------------------
app.get('/dashboard', (req, res) => {
    // Relax helmet's default CSP for this route only (inline scripts needed)
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline';");
    // Use a relative base so fetch() works regardless of protocol (avoids
    // mixed-content errors when Railway terminates TLS at the proxy layer).
    const apiBase = '';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send((0, dashboard_1.getDashboardHtml)(apiBase));
});
// -------------------------------------------------------------------
// Server startup
// -------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`Agent Settlement API running on http://localhost:${PORT}`);
    console.log(`Network: ${contracts_1.manifest.network} (chainId ${contracts_1.manifest.chainId})`);
    console.log(`AgentJobManager: ${contracts_1.manifest.contracts.AgentJobManager.address}`);
    console.log(`MockUSDC:        ${contracts_1.manifest.contracts.MockUSDC.address}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map