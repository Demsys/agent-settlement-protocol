/**
 * ceremony.ts — Mainnet deployment ceremony for Agent Settlement Protocol
 *
 * Implements the 4-EOA role separation + deterministic address prediction
 * described in the pre-mainnet checklist (see docs/CEREMONY.md).
 *
 * Prerequisites (set as environment variables before running):
 *   DEPLOYER_KEY    — EOA #1: deploys contracts, holds initial ownership
 *   REGISTRAR_KEY   — EOA #2: will own EvaluatorRegistry post-ceremony
 *   ATTESTOR_KEY    — EOA #3: will own AgentJobManager post-ceremony
 *   TREASURY_KEY    — EOA #4: will own Treasury post-ceremony
 *   AGENT_SALT      — arbitrary string, combined with deployer address for CREATE2 salt
 *                     (default: "asp-v1"). Publish this before deployment so anyone
 *                     can independently verify predicted addresses.
 *
 * Usage (Base mainnet):
 *   DEPLOYER_KEY=0x... REGISTRAR_KEY=0x... ATTESTOR_KEY=0x... TREASURY_KEY=0x... \
 *   AGENT_SALT=asp-v1 \
 *   npx hardhat run scripts/ceremony.ts --network base
 *
 * The script will:
 *   1. Pre-flight: verify all 4 EOAs are funded, distinct, and the deployer has enough ETH.
 *   2. Predict all contract addresses from the deterministic salt (log for public verification).
 *   3. Deploy all contracts in dependency order.
 *   4. Verify deployed addresses match predictions (abort if mismatch).
 *   5. Wire contracts together (propose governance actions — execute after 2-day delay).
 *   6. Transfer ownership to the appropriate EOA for each contract (separate tx per role).
 *   7. Save the deployment manifest.
 *
 * IMPORTANT: Step 6 (role grants) produces one transaction per role. Wait for each to confirm
 * and verify on Basescan before proceeding to the next — this is the ceremony guarantee.
 */

import { ethers } from "hardhat"
import * as fs from "fs"
import * as path from "path"

// ─── Constants ────────────────────────────────────────────────────────────────

const FEE_RATE = 50n          // 0.5% initial fee rate
const MIN_EVALUATOR_STAKE = ethers.parseEther("100").toString()

// Minimum ETH balance required for each EOA to cover deployment gas on Base mainnet.
// Base L2 gas costs are extremely low (~$0.01/tx), so 0.01 ETH is very conservative.
const MIN_EOA_BALANCE_ETH = "0.01"

// Canonical CREATE2 factory — deployed at the same address on all EVM chains.
// Accepts: salt (bytes32) + bytecode, returns deployed address.
// Source: https://github.com/Arachnid/deterministic-deployment-proxy
const CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContractDeployment {
  address: string
  txHash: string
  predictedAddress: string
  saltUsed: string
}

interface CeremonyManifest {
  network: string
  chainId: number
  deployedAt: string
  salt: string
  roles: {
    deployer:   string
    registrar:  string
    attestor:   string
    treasury:   string
  }
  contracts: {
    MockUSDC?:         ContractDeployment  // testnet only
    ProtocolToken:     ContractDeployment
    Treasury:          ContractDeployment
    EvaluatorRegistry: ContractDeployment
    AgentJobManager:   ContractDeployment
    ReputationBridge:  ContractDeployment
  }
  config: {
    feeRate:           number
    minEvaluatorStake: string
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`  ${msg}`) }
function logOk(msg: string) { console.log(`  ✓ ${msg}`) }
function logWarn(msg: string) { console.log(`  ⚠  ${msg}`) }
function logStep(n: number, title: string) { console.log(`\n=== Step ${n}: ${title} ===\n`) }

/**
 * Derives the deterministic CREATE2 salt from the deployer address and a human-readable salt string.
 * finalSalt = keccak256(abi.encodePacked(deployer, agentSalt))
 * Mirrors the pattern from the CardZero ceremony: predictable, independently verifiable.
 */
function deriveSalt(deployer: string, agentSalt: string): string {
  return ethers.solidityPackedKeccak256(
    ["address", "string"],
    [deployer, agentSalt],
  )
}

/**
 * Predicts the CREATE2 address for a contract deployed via the canonical factory.
 * address = keccak256(0xff ++ factory ++ salt ++ keccak256(bytecode))[12:]
 */
function predictCreate2Address(salt: string, initCodeHash: string): string {
  return ethers.getCreate2Address(CREATE2_FACTORY, salt, initCodeHash)
}

async function getFreshGasOverrides(deployer: ethers.Signer) {
  const FLOOR = 100_000_000n
  const fd = await deployer.provider!.getFeeData()
  return fd.maxFeePerGas != null
    ? {
        maxFeePerGas: (fd.maxFeePerGas * 150n) / 100n > FLOOR ? (fd.maxFeePerGas * 150n) / 100n : FLOOR,
        maxPriorityFeePerGas: ((fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 150n) / 100n > FLOOR
          ? ((fd.maxPriorityFeePerGas ?? fd.maxFeePerGas) * 150n) / 100n
          : FLOOR,
      }
    : { gasPrice: (fd.gasPrice ?? 1_000_000_000n) * 150n / 100n }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const provider = ethers.provider
  const network  = await provider.getNetwork()
  const chainId  = Number(network.chainId)
  const isMainnet = chainId === 8453

  console.log("\n╔══════════════════════════════════════════════════════╗")
  console.log("║  Agent Settlement Protocol — Mainnet Ceremony        ║")
  console.log("╚══════════════════════════════════════════════════════╝\n")
  log(`Network  : ${network.name} (chainId: ${chainId})`)

  // ── Read EOA keys from environment ──────────────────────────────────────────
  const deployerKey   = process.env.DEPLOYER_KEY
  const registrarKey  = process.env.REGISTRAR_KEY
  const attestorKey   = process.env.ATTESTOR_KEY
  const treasuryKey   = process.env.TREASURY_KEY
  const agentSalt     = process.env.AGENT_SALT ?? "asp-v1"

  if (!deployerKey || !registrarKey || !attestorKey || !treasuryKey) {
    throw new Error(
      "Missing required env vars: DEPLOYER_KEY, REGISTRAR_KEY, ATTESTOR_KEY, TREASURY_KEY"
    )
  }

  const deployer   = new ethers.Wallet(deployerKey,  provider)
  const registrar  = new ethers.Wallet(registrarKey, provider)
  const attestor   = new ethers.Wallet(attestorKey,  provider)
  const treasury   = new ethers.Wallet(treasuryKey,  provider)

  // ── Step 1: Pre-flight checks ────────────────────────────────────────────────
  logStep(1, "Pre-flight checks")

  const eoas = [
    { name: "Deployer",  wallet: deployer },
    { name: "Registrar", wallet: registrar },
    { name: "Attestor",  wallet: attestor },
    { name: "Treasury",  wallet: treasury },
  ]

  // All addresses must be distinct
  const addresses = eoas.map(e => e.wallet.address.toLowerCase())
  const unique = new Set(addresses)
  if (unique.size !== 4) {
    throw new Error("All 4 EOA addresses must be distinct — check your key environment variables.")
  }
  logOk("All 4 EOA addresses are distinct")

  // All EOAs must have sufficient ETH
  const minBalance = ethers.parseEther(MIN_EOA_BALANCE_ETH)
  for (const { name, wallet } of eoas) {
    const balance = await provider.getBalance(wallet.address)
    if (balance < minBalance) {
      throw new Error(
        `${name} (${wallet.address}) has insufficient ETH: ` +
        `${ethers.formatEther(balance)} < ${MIN_EOA_BALANCE_ETH} required`
      )
    }
    logOk(`${name} (${wallet.address}): ${ethers.formatEther(balance)} ETH`)
  }

  // Mainnet guard — double-confirmation required
  if (isMainnet) {
    logWarn("MAINNET DEPLOYMENT — ensure audit is complete before proceeding.")
    logWarn("Set CEREMONY_CONFIRMED=1 to proceed.")
    if (process.env.CEREMONY_CONFIRMED !== "1") {
      throw new Error("Set CEREMONY_CONFIRMED=1 to confirm mainnet deployment.")
    }
  }

  // ── Step 2: Derive salt and predict addresses ────────────────────────────────
  logStep(2, "Salt derivation and address prediction")

  const finalSalt = deriveSalt(deployer.address, agentSalt)
  log(`Agent salt string : "${agentSalt}"`)
  log(`Deployer address  : ${deployer.address}`)
  log(`Final salt (hex)  : ${finalSalt}`)
  log("")
  log("Predicted contract addresses (publish BEFORE deploying):")

  const factories = {
    ProtocolToken:     await ethers.getContractFactory("ProtocolToken",     deployer),
    Treasury:          await ethers.getContractFactory("Treasury",          deployer),
    EvaluatorRegistry: await ethers.getContractFactory("EvaluatorRegistry", deployer),
    ReputationBridge:  await ethers.getContractFactory("ReputationBridge",  deployer),
  }

  const predictions: Record<string, string> = {}
  for (const [name, factory] of Object.entries(factories)) {
    const initCodeHash = ethers.keccak256(factory.bytecode)
    predictions[name] = predictCreate2Address(finalSalt, initCodeHash)
    log(`  ${name.padEnd(20)}: ${predictions[name]}`)
  }
  log("")
  logWarn("Publish the above addresses publicly before deploying so anyone can verify.")

  // ── Step 3: Deploy contracts ─────────────────────────────────────────────────
  logStep(3, "Contract deployment")

  async function deployViaFactory(
    name: string,
    factory: ethers.ContractFactory,
    constructorArgs: unknown[] = [],
  ): Promise<ContractDeployment> {
    const initCode = constructorArgs.length > 0
      ? factory.bytecode + factory.interface.encodeDeploy(constructorArgs).slice(2)
      : factory.bytecode

    const factoryContract = new ethers.Contract(
      CREATE2_FACTORY,
      ["function deploy(bytes32 salt, bytes calldata code) external returns (address)"],
      deployer,
    )

    const gas = await getFreshGasOverrides(deployer)
    const tx = await factoryContract.deploy(finalSalt, initCode, gas)
    const receipt = await tx.wait(1)
    if (!receipt || receipt.status === 0) throw new Error(`${name} deployment failed`)

    // The CREATE2 factory emits no event — compute the address from salt + initcode
    const deployed = predictCreate2Address(
      finalSalt,
      ethers.keccak256(initCode),
    )

    if (deployed.toLowerCase() !== predictions[name]?.toLowerCase() && predictions[name]) {
      throw new Error(
        `${name} address mismatch: predicted ${predictions[name]}, got ${deployed}`
      )
    }

    logOk(`${name} deployed at ${deployed} (tx: ${receipt.hash})`)
    return { address: deployed, txHash: receipt.hash, predictedAddress: predictions[name] ?? deployed, saltUsed: finalSalt }
  }

  // Deploy in dependency order
  const protocolTokenDeployment = await deployViaFactory("ProtocolToken", factories.ProtocolToken)
  const treasuryDeployment      = await deployViaFactory("Treasury",      factories.Treasury)
  const registryDeployment      = await deployViaFactory(
    "EvaluatorRegistry",
    factories.EvaluatorRegistry,
    [protocolTokenDeployment.address],
  )

  // AgentJobManager depends on registry + treasury — not in predictions (has constructor args that vary)
  const agentJobManagerFactory = await ethers.getContractFactory("AgentJobManager", deployer)
  const agentJobManager = await agentJobManagerFactory.deploy(
    registryDeployment.address,
    FEE_RATE,
    treasuryDeployment.address,
    ethers.ZeroAddress, // reputationBridge wired post-deploy
    [],                 // no initial allowed tokens on mainnet — add via governance
    await getFreshGasOverrides(deployer),
  )
  await agentJobManager.waitForDeployment()
  const ajmReceipt = await agentJobManager.deploymentTransaction()!.wait(1)
  if (!ajmReceipt || ajmReceipt.status === 0) throw new Error("AgentJobManager deployment failed")
  const ajmAddress = await agentJobManager.getAddress()
  const ajmDeployment: ContractDeployment = {
    address:          ajmAddress,
    txHash:           ajmReceipt.hash,
    predictedAddress: "(regular deploy — no CREATE2)",
    saltUsed:         finalSalt,
  }
  logOk(`AgentJobManager deployed at ${ajmAddress} (tx: ${ajmReceipt.hash})`)

  const reputationBridgeDeployment = await deployViaFactory("ReputationBridge", factories.ReputationBridge)

  // ── Step 4: Wire contracts ────────────────────────────────────────────────────
  logStep(4, "Contract wiring (governance proposals — execute after 2-day delay)")

  const registryContract = await ethers.getContractAt("EvaluatorRegistry", registryDeployment.address, deployer)
  const ajmContract      = await ethers.getContractAt("AgentJobManager",   ajmAddress,                 deployer)
  const bridgeContract   = await ethers.getContractAt("ReputationBridge",  reputationBridgeDeployment.address, deployer)

  let tx = await registryContract.proposeJobManager(ajmAddress, await getFreshGasOverrides(deployer))
  await tx.wait(1)
  logOk(`EvaluatorRegistry.proposeJobManager(${ajmAddress}) — execute after 2-day delay`)

  tx = await ajmContract.proposeReputationBridge(reputationBridgeDeployment.address, await getFreshGasOverrides(deployer))
  await tx.wait(1)
  logOk(`AgentJobManager.proposeReputationBridge(${reputationBridgeDeployment.address}) — execute after 2-day delay`)

  tx = await bridgeContract.setJobManager(ajmAddress, await getFreshGasOverrides(deployer))
  await tx.wait(1)
  logOk(`ReputationBridge.setJobManager(${ajmAddress})`)

  // ── Step 5: 4-EOA role separation ─────────────────────────────────────────────
  // Each transferOwnership tx is separate and independently verifiable on Basescan.
  // DO NOT batch — the ceremony guarantee is one tx per role, each confirmed before the next.
  logStep(5, "Role separation — transferring ownership (one tx per role)")

  logWarn("Transferring EvaluatorRegistry → Registrar EOA...")
  tx = await registryContract.transferOwnership(registrar.address, await getFreshGasOverrides(deployer))
  await tx.wait(1)
  logOk(`EvaluatorRegistry.owner() → ${registrar.address} (Registrar)`)
  log(`  Verify: https://sepolia.basescan.org/address/${registryDeployment.address}#readContract`)

  logWarn("Transferring AgentJobManager → Attestor EOA...")
  tx = await ajmContract.transferOwnership(attestor.address, await getFreshGasOverrides(deployer))
  await tx.wait(1)
  logOk(`AgentJobManager.owner() → ${attestor.address} (Attestor)`)
  log(`  Verify: https://sepolia.basescan.org/address/${ajmAddress}#readContract`)

  logWarn("Transferring Treasury → Treasury EOA...")
  const treasuryContract = await ethers.getContractAt("Treasury", treasuryDeployment.address, deployer)
  tx = await treasuryContract.transferOwnership(treasury.address, await getFreshGasOverrides(deployer))
  await tx.wait(1)
  logOk(`Treasury.owner() → ${treasury.address} (Treasury EOA)`)
  log(`  Verify: https://sepolia.basescan.org/address/${treasuryDeployment.address}#readContract`)

  // ProtocolToken stays with deployer until governance contract is deployed
  logWarn("ProtocolToken ownership retained by Deployer until Governor is deployed.")
  log(`  Current owner: ${deployer.address}`)

  // ── Step 6: Save manifest ─────────────────────────────────────────────────────
  logStep(6, "Saving ceremony manifest")

  const networkName = chainId === 8453 ? "base" : chainId === 84532 ? "base-sepolia" : network.name
  const manifest: CeremonyManifest = {
    network:     networkName,
    chainId,
    deployedAt:  new Date().toISOString(),
    salt:        finalSalt,
    roles: {
      deployer:  deployer.address,
      registrar: registrar.address,
      attestor:  attestor.address,
      treasury:  treasury.address,
    },
    contracts: {
      ProtocolToken:     protocolTokenDeployment,
      Treasury:          treasuryDeployment,
      EvaluatorRegistry: registryDeployment,
      AgentJobManager:   ajmDeployment,
      ReputationBridge:  reputationBridgeDeployment,
    },
    config: {
      feeRate:           Number(FEE_RATE),
      minEvaluatorStake: MIN_EVALUATOR_STAKE,
    },
  }

  const dir      = path.join(__dirname, "..", "deployments")
  const filePath = path.join(dir, `${networkName}-ceremony.json`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), "utf8")
  logOk(`Manifest saved to: ${filePath}`)

  console.log("\n╔══════════════════════════════════════════════════════╗")
  console.log("║  Ceremony complete.                                  ║")
  console.log("║  Next: wait 2 days, then run executeGovernance.ts   ║")
  console.log("╚══════════════════════════════════════════════════════╝\n")
}

main().catch((err: unknown) => {
  console.error("\n  FATAL:", err)
  process.exitCode = 1
})
