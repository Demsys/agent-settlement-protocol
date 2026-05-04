import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type {
  AgentJobManager,
  EvaluatorRegistry,
  ProtocolToken,
  MockUSDC,
} from "../../typechain-types";

// ─── Constants ───────────────────────────────────────────────────────────────

const WARMUP_PERIOD   = 7 * 24 * 3600;
const FEE_RATE        = 50;  // 0.5% — same as unit tests
const FIVE_USDC       = ethers.parseUnits("5", 6);  // 5_000_000
const MIN_STAKE       = ethers.parseEther("100");
const DELIVERABLE     = ethers.keccak256(ethers.toUtf8Bytes("deliverable-integration-v1"));
const REASON          = ethers.keccak256(ethers.toUtf8Bytes("eval-report-integration-v1"));

// ─── Job status enum mirrors Solidity ────────────────────────────────────────

const JobStatus = {
  Open:      0n,
  Funded:    1n,
  Submitted: 2n,
  Completed: 3n,
  Rejected:  4n,
  Expired:   5n,
} as const;

// ─── Full deployment fixture ──────────────────────────────────────────────────

/**
 * Deploys the complete protocol stack and wires all contracts together.
 * The deployer stakes ProtocolToken and waits for the warmup period so
 * they are eligible as the auto-assigned evaluator.
 *
 * Roles in the integration tests:
 *   deployer = evaluator (staked and warmed up in registry)
 *   alice    = client
 *   bob      = provider
 */
async function fullDeployFixture() {
  const [deployer, alice, bob, carol] = await ethers.getSigners();

  // ── 1. Deploy ProtocolToken ───────────────────────────────────────────────
  const ProtocolTokenFactory = await ethers.getContractFactory("ProtocolToken");
  const protocolToken = (await ProtocolTokenFactory.deploy()) as ProtocolToken;
  await protocolToken.waitForDeployment();

  // ── 2. Deploy EvaluatorRegistry ──────────────────────────────────────────
  const EvaluatorRegistryFactory = await ethers.getContractFactory("EvaluatorRegistry");
  const registry = (await EvaluatorRegistryFactory.deploy(
    await protocolToken.getAddress()
  )) as EvaluatorRegistry;
  await registry.waitForDeployment();

  // ── 3. Deploy MockUSDC — must come before AgentJobManager so its address
  //       can be passed in _initialAllowedTokens (FINDING-007 whitelist fix).
  const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
  const usdc = (await MockUSDCFactory.deploy()) as MockUSDC;
  await usdc.waitForDeployment();

  // ── 4. Deploy AgentJobManager ─────────────────────────────────────────────
  //    feeRecipient = deployer (acting as protocol treasury in these tests).
  //    MockUSDC is whitelisted at construction (FINDING-007).
  const AgentJobManagerFactory = await ethers.getContractFactory("AgentJobManager");
  const manager = (await AgentJobManagerFactory.deploy(
    await registry.getAddress(),
    FEE_RATE,
    deployer.address,
    ethers.ZeroAddress,        // _reputationBridge — wired post-deployment via setReputationBridge
    [await usdc.getAddress()]  // _initialAllowedTokens — FINDING-007
  )) as AgentJobManager;
  await manager.waitForDeployment();

  // ── 5. Wire EvaluatorRegistry → AgentJobManager using the timelock pattern (FINDING-005).
  //    GOVERNANCE_DELAY = 2 days. We advance time here; the staking + warmup below adds
  //    another WARMUP_PERIOD on top, so the total time advance is intentional.
  const GOVERNANCE_DELAY_SEC = 2 * 24 * 3600;
  await registry.proposeJobManager(await manager.getAddress());
  await time.increase(GOVERNANCE_DELAY_SEC + 1);
  await registry.executeJobManager(await manager.getAddress());

  // ── 6. Deployer stakes and waits for warmup ───────────────────────────────
  await protocolToken.approve(await registry.getAddress(), MIN_STAKE);
  await registry.stake(MIN_STAKE);
  await time.increase(WARMUP_PERIOD + 1);

  return { manager, registry, protocolToken, usdc, deployer, alice, bob, carol };
}

// ─── Integration tests ────────────────────────────────────────────────────────

describe("Integration: full protocol flow", function () {

  /**
   * Scenario 1 — Happy path: complete job lifecycle
   *
   * 1. Deployer (evaluator) is staked and warmed up
   * 2. Alice (client) creates a job for Bob (provider) with auto-assigned evaluator
   * 3. Alice calls setBudget → fund
   * 4. Bob submits a deliverable
   * 5. Deployer (evaluator) calls complete
   * 6. Verify: Bob received 4.975 USDC, deployer received 0.025 USDC fee (feeRate=50bps)
   * 7. Verify: status == Completed, budget == 0
   */
  it("should complete a full happy-path job with auto-assigned evaluator", async function () {
    const { manager, usdc, deployer, alice, bob } = await loadFixture(fullDeployFixture);

    // ── Step 1: Alice creates a job for Bob with auto-assigned evaluator ─────
    const deadline = BigInt(await time.latest()) + 3600n;
    await manager.connect(alice).createJob(
      bob.address,
      ethers.ZeroAddress,  // auto-assign evaluator from registry
      await usdc.getAddress(),
      deadline
    );

    let job = await manager.getJob(1n);
    expect(job.status).to.equal(JobStatus.Open);
    expect(job.evaluator).to.equal(ethers.ZeroAddress);

    // ── Step 2: Alice sets the budget ────────────────────────────────────────
    await manager.connect(alice).setBudget(1n, FIVE_USDC);

    // ── Step 3: Alice mints USDC, approves, and funds ─────────────────────────
    await usdc.mint(alice.address, FIVE_USDC);
    await usdc.connect(alice).approve(await manager.getAddress(), FIVE_USDC);

    await expect(manager.connect(alice).fund(1n, FIVE_USDC))
      .to.emit(manager, "JobFunded")
      .withArgs(1n, FIVE_USDC);

    job = await manager.getJob(1n);
    expect(job.status).to.equal(JobStatus.Funded);
    // Evaluator should now be assigned (not address(0))
    expect(job.evaluator).to.not.equal(ethers.ZeroAddress);

    // ── Step 4: Bob submits a deliverable ─────────────────────────────────────
    await expect(manager.connect(bob).submit(1n, DELIVERABLE))
      .to.emit(manager, "JobSubmitted")
      .withArgs(1n, DELIVERABLE);

    job = await manager.getJob(1n);
    expect(job.status).to.equal(JobStatus.Submitted);
    expect(job.deliverable).to.equal(DELIVERABLE);

    // ── Step 5: Deployer (the auto-assigned evaluator) completes the job ──────
    const bobBalanceBefore      = await usdc.balanceOf(bob.address);
    const deployerBalanceBefore = await usdc.balanceOf(deployer.address);

    await expect(manager.connect(deployer).complete(1n, REASON))
      .to.emit(manager, "JobCompleted");

    // ── Step 6: Verify balances ───────────────────────────────────────────────
    // feeRate = 50 basis points = 0.5%
    // fee     = 5_000_000 * 50 / 10000 = 25_000
    // payment = 5_000_000 - 25_000   = 4_975_000

    const expectedFee     = FIVE_USDC * 50n / 10000n;  // 25_000
    const expectedPayment = FIVE_USDC - expectedFee;    // 4_975_000

    const bobBalanceAfter      = await usdc.balanceOf(bob.address);
    const deployerBalanceAfter = await usdc.balanceOf(deployer.address);

    expect(bobBalanceAfter - bobBalanceBefore).to.equal(
      expectedPayment,
      "Bob should receive 4.975 USDC"
    );
    expect(deployerBalanceAfter - deployerBalanceBefore).to.equal(
      expectedFee,
      "Deployer (feeRecipient) should receive 0.025 USDC"
    );

    // ── Step 7: Verify terminal state ─────────────────────────────────────────
    job = await manager.getJob(1n);
    expect(job.status).to.equal(JobStatus.Completed);
    expect(job.budget).to.equal(0n);

    // Contract should have no USDC left (everything paid out)
    expect(await usdc.balanceOf(await manager.getAddress())).to.equal(0n);
  });

  /**
   * Scenario 2 — Reject and reopen: a failed job is rejected and then reopened
   * for a second attempt with a new provider, completing successfully.
   *
   * 1. Alice creates a job for Bob
   * 2. Alice funds the job; evaluator is auto-assigned (deployer)
   * 3. Evaluator rejects the funded job (e.g., Bob never submitted)
   * 4. Refund is accumulated in pendingRefunds for Alice
   * 5. Alice reopens the job with Carol as new provider
   * 6. Alice setBudget + fund the reopened job
   * 7. Carol submits a deliverable
   * 8. Deployer (new evaluator assigned at re-fund) completes the job
   * 9. Carol receives payment, deployer receives fee
   * 10. Alice claims her original refund from step 4
   */
  it("should handle reject + reopen + new successful cycle", async function () {
    const { manager, usdc, deployer, alice, bob, carol } = await loadFixture(fullDeployFixture);

    const usdcAddr    = await usdc.getAddress();
    const managerAddr = await manager.getAddress();

    // ── Cycle 1 setup ─────────────────────────────────────────────────────────
    const deadline1 = BigInt(await time.latest()) + 3600n;
    await manager.connect(alice).createJob(
      bob.address,
      ethers.ZeroAddress,
      usdcAddr,
      deadline1
    );

    await manager.connect(alice).setBudget(1n, FIVE_USDC);
    await usdc.mint(alice.address, FIVE_USDC);
    await usdc.connect(alice).approve(managerAddr, FIVE_USDC);
    await manager.connect(alice).fund(1n, FIVE_USDC);

    let job = await manager.getJob(1n);
    expect(job.status).to.equal(JobStatus.Funded);

    // ── Evaluator rejects the funded job ─────────────────────────────────────
    await expect(manager.connect(deployer).reject(1n, REASON))
      .to.emit(manager, "JobRejected")
      .withArgs(1n, alice.address, REASON);

    job = await manager.getJob(1n);
    expect(job.status).to.equal(JobStatus.Rejected);
    expect(job.budget).to.equal(0n);

    // Refund is registered for Alice — net of fee (feeRate=50bps charged on rejection)
    // fee = FIVE_USDC * 50 / 10_000 = 25_000; alice receives budget - fee
    const rejectFee = FIVE_USDC * 50n / 10000n;
    const pendingAfterReject = await manager.getPendingRefund(alice.address, usdcAddr);
    expect(pendingAfterReject).to.equal(FIVE_USDC - rejectFee);

    // ── Alice reopens the job with Carol as new provider ──────────────────────
    const deadline2 = BigInt(await time.latest()) + 3600n;
    await expect(manager.connect(alice).reopen(1n, carol.address, deadline2))
      .to.emit(manager, "JobReopened")
      .withArgs(1n, alice.address, carol.address, deadline2);

    job = await manager.getJob(1n);
    expect(job.status).to.equal(JobStatus.Open);
    expect(job.provider).to.equal(carol.address);
    expect(job.evaluator).to.equal(ethers.ZeroAddress);  // reset for fresh assignment
    expect(job.budget).to.equal(0n);

    // ── Cycle 2: Alice funds the reopened job ─────────────────────────────────
    // Alice's original refund is still claimable separately — it is NOT reused here.
    // This is intentional per the reopen() security design: pending refunds are independent.
    const pendingStillPresent = await manager.getPendingRefund(alice.address, usdcAddr);
    expect(pendingStillPresent).to.equal(
      FIVE_USDC - rejectFee,
      "Pending refund (net of rejection fee) should still be claimable after reopen"
    );

    await manager.connect(alice).setBudget(1n, FIVE_USDC);
    await usdc.mint(alice.address, FIVE_USDC);
    await usdc.connect(alice).approve(managerAddr, FIVE_USDC);
    await manager.connect(alice).fund(1n, FIVE_USDC);

    job = await manager.getJob(1n);
    expect(job.status).to.equal(JobStatus.Funded);
    expect(job.evaluator).to.not.equal(ethers.ZeroAddress);

    // ── Carol submits a deliverable ───────────────────────────────────────────
    const deliverable2 = ethers.keccak256(ethers.toUtf8Bytes("carol-deliverable-v1"));
    await expect(manager.connect(carol).submit(1n, deliverable2))
      .to.emit(manager, "JobSubmitted")
      .withArgs(1n, deliverable2);

    // ── Deployer (evaluator) completes cycle 2 ────────────────────────────────
    const carolBalanceBefore    = await usdc.balanceOf(carol.address);
    const deployerBalanceBefore = await usdc.balanceOf(deployer.address);

    await expect(manager.connect(deployer).complete(1n, REASON))
      .to.emit(manager, "JobCompleted");

    const expectedFee     = FIVE_USDC * 50n / 10000n;
    const expectedPayment = FIVE_USDC - expectedFee;

    expect(await usdc.balanceOf(carol.address) - carolBalanceBefore).to.equal(expectedPayment);
    expect(await usdc.balanceOf(deployer.address) - deployerBalanceBefore).to.equal(expectedFee);

    job = await manager.getJob(1n);
    expect(job.status).to.equal(JobStatus.Completed);
    expect(job.budget).to.equal(0n);

    // ── Alice claims her refund from cycle 1 ──────────────────────────────────
    const aliceBalanceBefore = await usdc.balanceOf(alice.address);

    await expect(manager.connect(alice).claimRefund(usdcAddr))
      .to.emit(manager, "RefundClaimed")
      .withArgs(alice.address, usdcAddr, FIVE_USDC - rejectFee);

    expect(await usdc.balanceOf(alice.address) - aliceBalanceBefore).to.equal(FIVE_USDC - rejectFee);

    // After claiming, pending refund should be zero
    const pendingAfterClaim = await manager.getPendingRefund(alice.address, usdcAddr);
    expect(pendingAfterClaim).to.equal(0n);

    // Final contract balance: should be zero (all funds paid out or refunded)
    expect(await usdc.balanceOf(managerAddr)).to.equal(0n);
  });
});
