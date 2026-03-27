import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

// ─── Constants ────────────────────────────────────────────────────────────────

// 0.5% protocol fee in basis points (out of 10000).
// The deployment spec requires 50 for the initial SaaS phase.
// Note: deployment-config.md documents 100 (1%) as the intended steady-state —
// the governance can update this post-launch via ProtocolToken DAO.
const FEE_RATE = 50n

// Chain ID for Base Sepolia testnet — used to guard against accidental
// mainnet deployment and to label the output JSON correctly.
const BASE_SEPOLIA_CHAIN_ID = 84532

// Minimum evaluator stake: 100 tokens with 18 decimals.
// Stored as a string to preserve precision in the deployment JSON.
const MIN_EVALUATOR_STAKE = ethers.parseEther("100").toString()

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContractDeployment {
  address: string
  txHash: string
}

interface DeploymentManifest {
  network: string
  chainId: number
  deployedAt: string
  deployer: string
  contracts: {
    MockUSDC: ContractDeployment
    ProtocolToken: ContractDeployment
    EvaluatorRegistry: ContractDeployment
    AgentJobManager: ContractDeployment
    ReputationBridge: ContractDeployment
  }
  config: {
    feeRate: number
    feeRecipient: string
    minEvaluatorStake: string
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Logs a successful deployment with a consistent, scannable format.
 * The unicode checkmark makes it easy to spot deployed contracts in terminal output.
 */
function logDeployment(name: string, address: string, txHash: string): void {
  console.log(`  \u2713 ${name} deployed : ${address} (tx: ${txHash})`)
}

/**
 * Logs a post-deployment configuration transaction.
 */
function logConfig(description: string, txHash: string): void {
  console.log(`  \u2192 ${description} (tx: ${txHash})`)
}

/**
 * Saves the deployment manifest to deployments/<network>.json.
 * The deployments/ directory is created if it does not exist.
 * We write atomically via a temp file + rename so a partial write never
 * produces a corrupted JSON if the process is interrupted mid-write.
 */
function saveDeploymentManifest(
  networkName: string,
  manifest: DeploymentManifest,
): void {
  const dir = path.join(__dirname, "..", "deployments")
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const filePath = path.join(dir, `${networkName}.json`)
  const tmpPath = `${filePath}.tmp`
  const json = JSON.stringify(manifest, null, 2)

  fs.writeFileSync(tmpPath, json, "utf8")
  fs.renameSync(tmpPath, filePath)

  console.log(`\n  Deployment manifest saved to: ${filePath}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners()
  const network = await ethers.provider.getNetwork()
  const chainId = Number(network.chainId)

  console.log("\n=== Agent Settlement Protocol — Deployment ===")
  console.log(`  Network  : ${network.name} (chainId: ${chainId})`)
  console.log(`  Deployer : ${deployer.address}`)
  console.log(`  Balance  : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`)

  // Guard against accidental mainnet deployment before a security audit.
  // Base mainnet chain ID is 8453.
  if (chainId === 8453) {
    throw new Error(
      "MAINNET DEPLOYMENT BLOCKED — a professional security audit is required before deploying to Base mainnet (chain ID 8453).",
    )
  }

  const networkName = chainId === BASE_SEPOLIA_CHAIN_ID ? "base-sepolia" : network.name

  // Manual nonce tracking: start from the pending nonce and increment ourselves
  // after each confirmed transaction. This avoids all RPC propagation delays
  // ("nonce too low") and stale-nonce retries ("replacement transaction underpriced").
  let currentNonce = await ethers.provider.getTransactionCount(deployer.address, "pending")
  console.log(`  Starting nonce: ${currentNonce}\n`)

  const FLOOR = 100_000_000n // 0.1 gwei
  async function getFreshGasOverrides() {
    const fd = await ethers.provider.getFeeData()
    // +50% over the current base fee gives sufficient priority without overpaying.
    // The former 10x multiplier was appropriate for local devnets where fee data is
    // unreliable, but on mainnet it would result in catastrophically high transaction
    // costs — up to 10x the market rate per deployment transaction.
    const gasFields = fd.maxFeePerGas != null
      ? {
          maxFeePerGas: (fd.maxFeePerGas * 150n) / 100n > FLOOR
            ? (fd.maxFeePerGas * 150n) / 100n
            : FLOOR,
          maxPriorityFeePerGas: ((fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 150n) / 100n > FLOOR
            ? ((fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 150n) / 100n
            : FLOOR,
        }
      : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 150n / 100n > FLOOR
            ? (fd.gasPrice ?? 1_000_000_000n) * 150n / 100n
            : FLOOR }
    return { ...gasFields, nonce: currentNonce++ }
  }

  console.log("\n--- Deploying contracts ---\n")

  // ── 1. MockUSDC ─────────────────────────────────────────────────────────────
  // Deployed first as it has no constructor dependencies.
  // This is a test-only ERC-20 that allows free minting, replacing the
  // official USDC on testnet which requires whitelist access.
  let mockUSDCDeployment: ContractDeployment
  try {
    const MockUSDC = await ethers.getContractFactory("MockUSDC")
    const mockUSDC = await MockUSDC.deploy(await getFreshGasOverrides())
    await mockUSDC.waitForDeployment()
    const receipt = await mockUSDC.deploymentTransaction()!.wait(1)
    if (receipt === null || receipt.status === 0) {
      throw new Error("MockUSDC deployment transaction failed (status 0)")
    }
    mockUSDCDeployment = {
      address: await mockUSDC.getAddress(),
      txHash: receipt.hash,
    }
    logDeployment("MockUSDC", mockUSDCDeployment.address, mockUSDCDeployment.txHash)
  } catch (err) {
    console.error("\n  ERROR: MockUSDC deployment failed.")
    console.error(err)
    process.exit(1)
  }

  // ── 2. ProtocolToken ────────────────────────────────────────────────────────
  // No constructor dependencies. This is the governance and fee-distribution
  // token of the protocol.
  let protocolTokenDeployment: ContractDeployment
  try {
    const ProtocolToken = await ethers.getContractFactory("ProtocolToken")
    const protocolToken = await ProtocolToken.deploy(await getFreshGasOverrides())
    await protocolToken.waitForDeployment()
    const receipt = await protocolToken.deploymentTransaction()!.wait(1)
    if (receipt === null || receipt.status === 0) {
      throw new Error("ProtocolToken deployment transaction failed (status 0)")
    }
    protocolTokenDeployment = {
      address: await protocolToken.getAddress(),
      txHash: receipt.hash,
    }
    logDeployment("ProtocolToken", protocolTokenDeployment.address, protocolTokenDeployment.txHash)
  } catch (err) {
    console.error("\n  ERROR: ProtocolToken deployment failed.")
    console.error(err)
    process.exit(1)
  }

  // ── 3. EvaluatorRegistry ────────────────────────────────────────────────────
  // Depends on ProtocolToken for staking denominations.
  // The registry manages the decentralised evaluator staker network.
  let evaluatorRegistryDeployment: ContractDeployment
  let evaluatorRegistryAddress: string
  try {
    const EvaluatorRegistry = await ethers.getContractFactory("EvaluatorRegistry")
    const evaluatorRegistry = await EvaluatorRegistry.deploy(protocolTokenDeployment.address, await getFreshGasOverrides())
    await evaluatorRegistry.waitForDeployment()
    const receipt = await evaluatorRegistry.deploymentTransaction()!.wait(1)
    if (receipt === null || receipt.status === 0) {
      throw new Error("EvaluatorRegistry deployment transaction failed (status 0)")
    }
    evaluatorRegistryAddress = await evaluatorRegistry.getAddress()
    evaluatorRegistryDeployment = {
      address: evaluatorRegistryAddress,
      txHash: receipt.hash,
    }
    logDeployment("EvaluatorRegistry", evaluatorRegistryDeployment.address, evaluatorRegistryDeployment.txHash)
  } catch (err) {
    console.error("\n  ERROR: EvaluatorRegistry deployment failed.")
    console.error(err)
    process.exit(1)
  }

  // ── 4. AgentJobManager ──────────────────────────────────────────────────────
  // Core ERC-8183 implementation.
  // feeRecipient is set to the deployer wallet for the initial SaaS phase;
  // governance can rotate this address via ProtocolToken DAO post-launch.
  // MockUSDC is passed in _initialAllowedTokens to whitelist it at construction
  // (FINDING-007: token whitelist to prevent fee-on-transfer token attacks).
  let agentJobManagerDeployment: ContractDeployment
  let agentJobManagerAddress: string
  try {
    const AgentJobManager = await ethers.getContractFactory("AgentJobManager")
    const agentJobManager = await AgentJobManager.deploy(
      evaluatorRegistryAddress,
      FEE_RATE,
      deployer.address,   // feeRecipient = deployer wallet for initial SaaS phase
      ethers.ZeroAddress, // _reputationBridge — wired post-deployment via setReputationBridge()
      [mockUSDCDeployment.address], // _initialAllowedTokens — FINDING-007
      await getFreshGasOverrides(),
    )
    await agentJobManager.waitForDeployment()
    const receipt = await agentJobManager.deploymentTransaction()!.wait(1)
    if (receipt === null || receipt.status === 0) {
      throw new Error("AgentJobManager deployment transaction failed (status 0)")
    }
    agentJobManagerAddress = await agentJobManager.getAddress()
    agentJobManagerDeployment = {
      address: agentJobManagerAddress,
      txHash: receipt.hash,
    }
    logDeployment("AgentJobManager", agentJobManagerDeployment.address, agentJobManagerDeployment.txHash)
  } catch (err) {
    console.error("\n  ERROR: AgentJobManager deployment failed.")
    console.error(err)
    process.exit(1)
  }

  // ── 5. ReputationBridge ─────────────────────────────────────────────────────
  // Bridges ERC-8183 job outcomes to ERC-8004 reputation scores.
  // Depends on AgentJobManager to listen for completion/rejection events.
  let reputationBridgeDeployment: ContractDeployment
  let reputationBridgeAddress: string
  try {
    const ReputationBridge = await ethers.getContractFactory("ReputationBridge")
    // ReputationBridge constructor takes no arguments — jobManager is wired
    // via setJobManager() in the post-deployment configuration step below.
    const reputationBridge = await ReputationBridge.deploy(await getFreshGasOverrides())
    await reputationBridge.waitForDeployment()
    const receipt = await reputationBridge.deploymentTransaction()!.wait(1)
    if (receipt === null || receipt.status === 0) {
      throw new Error("ReputationBridge deployment transaction failed (status 0)")
    }
    reputationBridgeAddress = await reputationBridge.getAddress()
    reputationBridgeDeployment = {
      address: reputationBridgeAddress,
      txHash: receipt.hash,
    }
    logDeployment("ReputationBridge", reputationBridgeDeployment.address, reputationBridgeDeployment.txHash)
  } catch (err) {
    console.error("\n  ERROR: ReputationBridge deployment failed.")
    console.error(err)
    process.exit(1)
  }

  // ── Post-deployment configuration ───────────────────────────────────────────
  // These two calls wire the contracts together. They must both succeed;
  // a partial configuration would leave the protocol in an inoperable state.

  console.log("\n--- Post-deployment configuration ---\n")

  // Tell the EvaluatorRegistry which AgentJobManager contract it serves.
  // FINDING-005: setJobManager is now timelocked (GOVERNANCE_DELAY = 2 days).
  // This script calls proposeJobManager() which starts the 2-day countdown.
  // After 2 days, the deployer must call executeJobManager(agentJobManagerAddress)
  // to complete the wiring. Until then, assignEvaluator() will revert (no eligible
  // jobManager), meaning auto-assigned evaluator jobs will fail — this is acceptable
  // during the 2-day governance window before production launch.
  try {
    const evaluatorRegistry = await ethers.getContractAt(
      "EvaluatorRegistry",
      evaluatorRegistryAddress,
    )
    const tx = await evaluatorRegistry.proposeJobManager(agentJobManagerAddress, await getFreshGasOverrides())
    const receipt = await tx.wait(1)
    if (receipt === null || receipt.status === 0) {
      throw new Error("proposeJobManager transaction failed (status 0)")
    }
    logConfig(`EvaluatorRegistry.proposeJobManager(${agentJobManagerAddress}) — execute after 2-day GOVERNANCE_DELAY`, receipt.hash)
    console.log("  ⚠  IMPORTANT: Run scripts/executeGovernance.ts after 2 days to call executeJobManager().")
  } catch (err) {
    console.error("\n  ERROR: EvaluatorRegistry.proposeJobManager() failed.")
    console.error(err)
    process.exit(1)
  }

  // Propose the ReputationBridge address on AgentJobManager.
  // FINDING-001 fix: setReputationBridge is now timelocked (GOVERNANCE_DELAY = 2 days).
  // This script calls proposeReputationBridge() which starts the countdown.
  // After 2 days, run scripts/executeGovernance.ts to call executeReputationBridge().
  try {
    const agentJobManager = await ethers.getContractAt(
      "AgentJobManager",
      agentJobManagerAddress,
    )
    const tx = await agentJobManager.proposeReputationBridge(reputationBridgeAddress, await getFreshGasOverrides())
    const receipt = await tx.wait(1)
    if (receipt === null || receipt.status === 0) {
      throw new Error("proposeReputationBridge transaction failed (status 0)")
    }
    logConfig(`AgentJobManager.proposeReputationBridge(${reputationBridgeAddress}) — execute after 2-day GOVERNANCE_DELAY`, receipt.hash)
    console.log("  ⚠  IMPORTANT: Run scripts/executeGovernance.ts after 2 days to call executeReputationBridge().")
  } catch (err) {
    console.error("\n  ERROR: AgentJobManager.proposeReputationBridge() failed.")
    console.error(err)
    process.exit(1)
  }

  // Tell the ReputationBridge which AgentJobManager is authorized to call it,
  // so its onlyJobManager modifier accepts the correct caller.
  try {
    const reputationBridge = await ethers.getContractAt(
      "ReputationBridge",
      reputationBridgeAddress,
    )
    const tx = await reputationBridge.setJobManager(agentJobManagerAddress, await getFreshGasOverrides())
    const receipt = await tx.wait(1)
    if (receipt === null || receipt.status === 0) {
      throw new Error("ReputationBridge.setJobManager transaction failed (status 0)")
    }
    logConfig(`ReputationBridge.setJobManager(${agentJobManagerAddress})`, receipt.hash)
  } catch (err) {
    console.error("\n  ERROR: ReputationBridge.setJobManager() failed.")
    console.error(err)
    process.exit(1)
  }

  // ── Enable self-service mode for single-agent MVP ─────────────────────────
  // AUDIT-H1: selfServiceEnabled defaults to false in the contract (prevents
  // reputation farming). Enable here for the testnet MVP where the same wallet
  // acts as both client and provider.
  // ⚠ TODO: remove this step (or explicitly call setSelfServiceEnabled(false))
  //          before deploying to mainnet for multi-party production use.
  try {
    const agentJobManager = await ethers.getContractAt(
      "AgentJobManager",
      agentJobManagerAddress,
    )
    const tx = await agentJobManager.setSelfServiceEnabled(true, await getFreshGasOverrides())
    const receipt = await tx.wait(1)
    if (receipt === null || receipt.status === 0) {
      throw new Error("AgentJobManager.setSelfServiceEnabled transaction failed (status 0)")
    }
    logConfig(`AgentJobManager.setSelfServiceEnabled(true) — MVP single-agent mode`, receipt.hash)
    console.log("  ⚠  NOTE: disable selfServiceEnabled before mainnet production deployment.")
  } catch (err) {
    console.error("\n  ERROR: AgentJobManager.setSelfServiceEnabled() failed.")
    console.error(err)
    process.exit(1)
  }

  // ── Deployment manifest ──────────────────────────────────────────────────────
  // Persist all addresses and metadata so that the SDK and integration tests
  // can locate the contracts without re-querying the chain.

  const manifest: DeploymentManifest = {
    network: networkName,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      MockUSDC: mockUSDCDeployment,
      ProtocolToken: protocolTokenDeployment,
      EvaluatorRegistry: evaluatorRegistryDeployment,
      AgentJobManager: agentJobManagerDeployment,
      ReputationBridge: reputationBridgeDeployment,
    },
    config: {
      feeRate: Number(FEE_RATE),
      feeRecipient: deployer.address,
      minEvaluatorStake: MIN_EVALUATOR_STAKE,
    },
  }

  saveDeploymentManifest(networkName, manifest)

  console.log("\n=== Deployment complete ===\n")
}

// ─── Entry point ──────────────────────────────────────────────────────────────

main().catch((err: unknown) => {
  console.error("\n  FATAL: Unhandled error during deployment:")
  console.error(err)
  process.exitCode = 1
})
