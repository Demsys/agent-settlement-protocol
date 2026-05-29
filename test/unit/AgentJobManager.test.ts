import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import type {
  AgentJobManager,
  EvaluatorRegistry,
  ProtocolToken,
  MockUSDC,
} from "../../typechain-types";

// ─── Constants ───────────────────────────────────────────────────────────────

const WARMUP_PERIOD   = 7 * 24 * 3600; // 7 days in seconds
const MIN_DEADLINE    = 5 * 60;         // 5 minutes in seconds
const FEE_RATE        = 50;             // 0.5%
const ONE_USDC        = ethers.parseUnits("1", 6);
const FIVE_USDC       = ethers.parseUnits("5", 6);
const HUNDRED_TOKENS  = ethers.parseEther("100");
const BYTES32_ZERO    = ethers.ZeroHash;
const DELIVERABLE     = ethers.keccak256(ethers.toUtf8Bytes("deliverable-v1"));
const REASON          = ethers.keccak256(ethers.toUtf8Bytes("eval-report-v1"));

// ─── Job status enum mirrors Solidity's IAgentJobManager.JobStatus ───────────

const JobStatus = {
  Open:      0n,
  Funded:    1n,
  Submitted: 2n,
  Completed: 3n,
  Rejected:  4n,
  Expired:   5n,
} as const;

// ─── Base fixture ─────────────────────────────────────────────────────────────

/**
 * Deploys the full contract stack in the correct order and wires them together.
 * Does NOT stake or warm up any evaluator — individual tests handle that.
 */
const GOVERNANCE_DELAY = 2 * 24 * 3600; // 2 days in seconds — mirrors AgentJobManager.GOVERNANCE_DELAY

async function deployFixture() {
  const [deployer, client, provider, evaluator, stranger] =
    await ethers.getSigners();

  // 1. Deploy ProtocolToken
  const ProtocolTokenFactory = await ethers.getContractFactory("ProtocolToken");
  const protocolToken = (await ProtocolTokenFactory.deploy()) as ProtocolToken;
  await protocolToken.waitForDeployment();

  // 2. Deploy EvaluatorRegistry
  const EvaluatorRegistryFactory = await ethers.getContractFactory("EvaluatorRegistry");
  const registry = (await EvaluatorRegistryFactory.deploy(
    await protocolToken.getAddress()
  )) as EvaluatorRegistry;
  await registry.waitForDeployment();

  // 3. Deploy MockUSDC — must be deployed BEFORE AgentJobManager so its address
  //    can be passed in _initialAllowedTokens (FINDING-007 whitelist fix).
  const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
  const usdc = (await MockUSDCFactory.deploy()) as MockUSDC;
  await usdc.waitForDeployment();

  // 4. Deploy AgentJobManager — feeRecipient = deployer for simplicity.
  //    MockUSDC is whitelisted at construction (FINDING-007).
  const AgentJobManagerFactory = await ethers.getContractFactory("AgentJobManager");
  const manager = (await AgentJobManagerFactory.deploy(
    await registry.getAddress(),
    FEE_RATE,
    deployer.address,
    ethers.ZeroAddress,        // _reputationBridge — not wired in unit tests
    [await usdc.getAddress()]  // _initialAllowedTokens — FINDING-007
  )) as AgentJobManager;
  await manager.waitForDeployment();

  // 5. Wire EvaluatorRegistry to AgentJobManager using the propose/execute pattern
  //    (FINDING-005 timelock). We advance time past GOVERNANCE_DELAY here so that
  //    the rest of the tests start with a fully operational registry.
  await registry.proposeJobManager(await manager.getAddress());
  await time.increase(GOVERNANCE_DELAY + 1);
  await registry.executeJobManager(await manager.getAddress());

  // 6. FINDING #1 fix: stake the `evaluator` signer in EvaluatorRegistry so that
  //    createJob() with an explicit evaluator passes the isEligible() check.
  //    We distribute tokens and advance past the warmup period (7 days) so the
  //    evaluator is fully eligible when tests call createJob(... evaluator.address ...).
  await protocolToken.transfer(evaluator.address, HUNDRED_TOKENS);
  await protocolToken.connect(evaluator).approve(await registry.getAddress(), HUNDRED_TOKENS);
  await registry.connect(evaluator).stake(HUNDRED_TOKENS);
  await time.increase(WARMUP_PERIOD + 1);

  return { manager, registry, protocolToken, usdc, deployer, client, provider, evaluator, stranger };
}

/**
 * Extension of deployFixture: the deployer also stakes and waits for the warmup
 * period so that auto-assigned evaluator tests can fund jobs successfully.
 */
async function deployWithWarmedUpEvaluatorFixture() {
  const base = await deployFixture();
  const { registry, protocolToken, deployer } = base;

  // Approve and stake enough tokens to be active
  await protocolToken.approve(await registry.getAddress(), HUNDRED_TOKENS);
  await registry.stake(HUNDRED_TOKENS);

  // Fast-forward past the warmup period
  await time.increase(WARMUP_PERIOD + 1);

  return base;
}

/**
 * Helper: creates a job with an explicit evaluator and a deadline 1 hour from now.
 */
async function createExplicitJob(
  manager: AgentJobManager,
  client: { address: string } & Awaited<ReturnType<typeof ethers.getSigner>>,
  providerAddr: string,
  evaluatorAddr: string,
  tokenAddr: string
): Promise<bigint> {
  const deadline = BigInt(await time.latest()) + 3600n;
  const tx = await manager.connect(client).createJob(
    providerAddr,
    evaluatorAddr,
    tokenAddr,
    deadline
  );
  const receipt = await tx.wait();
  // Extract jobId from the JobCreated event
  const iface = manager.interface;
  for (const log of receipt!.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "JobCreated") return parsed.args.jobId as bigint;
    } catch {}
  }
  throw new Error("JobCreated event not found");
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("AgentJobManager", function () {

  // ── createJob ──────────────────────────────────────────────────────────────

  describe("createJob", function () {

    it("should create a job with an explicit evaluator and emit JobCreated with jobId=1", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + 3600n;

      await expect(
        manager.connect(client).createJob(
          provider.address,
          evaluator.address,
          await usdc.getAddress(),
          deadline
        )
      )
        .to.emit(manager, "JobCreated")
        .withArgs(1n, client.address, provider.address, evaluator.address, await usdc.getAddress(), deadline);

      const job = await manager.getJob(1n);
      expect(job.status).to.equal(JobStatus.Open);
      expect(job.client).to.equal(client.address);
      expect(job.provider).to.equal(provider.address);
      expect(job.evaluator).to.equal(evaluator.address);
    });

    it("should create a job with address(0) as evaluator (auto-assign path)", async function () {
      const { manager, usdc, client, provider } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + 3600n;

      await expect(
        manager.connect(client).createJob(
          provider.address,
          ethers.ZeroAddress,
          await usdc.getAddress(),
          deadline
        )
      ).to.emit(manager, "JobCreated");

      const job = await manager.getJob(1n);
      // evaluator is address(0) at creation — will be resolved during fund()
      expect(job.evaluator).to.equal(ethers.ZeroAddress);
    });

    it("should revert with ZeroAddress when provider is address(0)", async function () {
      const { manager, usdc, client } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + 3600n;

      await expect(
        manager.connect(client).createJob(
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          await usdc.getAddress(),
          deadline
        )
      ).to.be.revertedWithCustomError(manager, "ZeroAddress").withArgs("provider");
    });

    it("should revert with ZeroAddress when token is address(0)", async function () {
      const { manager, client, provider } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + 3600n;

      await expect(
        manager.connect(client).createJob(
          provider.address,
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          deadline
        )
      ).to.be.revertedWithCustomError(manager, "ZeroAddress").withArgs("token");
    });

    it("should revert SelfAssignment when client == provider", async function () {
      const { manager, usdc, client } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + 3600n;

      // AUDIT-H1: client == provider is unconditionally forbidden — no bypass exists.
      await expect(
        manager.connect(client).createJob(
          client.address,
          ethers.ZeroAddress,
          await usdc.getAddress(),
          deadline
        )
      ).to.be.revertedWithCustomError(manager, "SelfAssignment").withArgs("provider");
    });

    it("should revert with SelfAssignment when evaluator == client", async function () {
      const { manager, usdc, client, provider } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + 3600n;

      await expect(
        manager.connect(client).createJob(
          provider.address,
          client.address,  // evaluator == client
          await usdc.getAddress(),
          deadline
        )
      ).to.be.revertedWithCustomError(manager, "SelfAssignment").withArgs("evaluator");
    });

    it("should revert with SelfAssignment when evaluator == provider", async function () {
      const { manager, usdc, client, provider } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + 3600n;

      await expect(
        manager.connect(client).createJob(
          provider.address,
          provider.address, // evaluator == provider
          await usdc.getAddress(),
          deadline
        )
      ).to.be.revertedWithCustomError(manager, "SelfAssignment").withArgs("evaluator");
    });

    it("should revert with DeadlineTooSoon when deadline is too close", async function () {
      const { manager, usdc, client, provider } = await loadFixture(deployFixture);
      // deadline = now + 60s < MIN_DEADLINE_OFFSET (5 minutes)
      const deadline = BigInt(await time.latest()) + 60n;

      await expect(
        manager.connect(client).createJob(
          provider.address,
          ethers.ZeroAddress,
          await usdc.getAddress(),
          deadline
        )
      ).to.be.revertedWithCustomError(manager, "DeadlineTooSoon");
    });

    it("should assign jobId=1 and jobId=2 for two successive jobs", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      const deadline = BigInt(await time.latest()) + 3600n;

      const tx1 = await manager.connect(client).createJob(
        provider.address, evaluator.address, await usdc.getAddress(), deadline
      );
      const r1 = await tx1.wait();

      const tx2 = await manager.connect(client).createJob(
        provider.address, evaluator.address, await usdc.getAddress(), deadline
      );
      const r2 = await tx2.wait();

      type TxLogs = NonNullable<Awaited<ReturnType<typeof tx1.wait>>>["logs"];
      const parse = (logs: TxLogs) => {
        for (const log of logs) {
          try {
            const p = manager.interface.parseLog(log);
            if (p?.name === "JobCreated") return p.args.jobId as bigint;
          } catch {}
        }
        throw new Error("no JobCreated");
      };

      expect(parse(r1!.logs)).to.equal(1n);
      expect(parse(r2!.logs)).to.equal(2n);
    });
  });

  // ── setBudget ──────────────────────────────────────────────────────────────

  describe("setBudget", function () {

    it("should allow the client to set the budget on an Open job", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      await expect(manager.connect(client).setBudget(1n, FIVE_USDC))
        .to.emit(manager, "BudgetSet")
        .withArgs(1n, FIVE_USDC);

      const job = await manager.getJob(1n);
      expect(job.budget).to.equal(FIVE_USDC);
    });

    it("should allow the provider to set the budget on an Open job", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      await expect(manager.connect(provider).setBudget(1n, FIVE_USDC))
        .to.emit(manager, "BudgetSet")
        .withArgs(1n, FIVE_USDC);
    });

    it("should revert with NotAuthorized when stranger calls setBudget", async function () {
      const { manager, usdc, client, provider, evaluator, stranger } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      await expect(manager.connect(stranger).setBudget(1n, FIVE_USDC))
        .to.be.revertedWithCustomError(manager, "NotAuthorized");
    });

    it("should revert with InvalidJobStatus when job is already Funded", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);

      await expect(manager.connect(client).setBudget(1n, FIVE_USDC))
        .to.be.revertedWithCustomError(manager, "InvalidJobStatus")
        .withArgs(1n, JobStatus.Funded);
    });

    it("should emit BudgetSet with the correct amount", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      await expect(manager.connect(client).setBudget(1n, ONE_USDC))
        .to.emit(manager, "BudgetSet")
        .withArgs(1n, ONE_USDC);
    });
  });

  // ── fund ───────────────────────────────────────────────────────────────────

  describe("fund", function () {

    it("should complete the setBudget → approve → fund flow and emit JobFunded", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);

      await expect(manager.connect(client).fund(1n, FIVE_USDC))
        .to.emit(manager, "JobFunded")
        .withArgs(1n, FIVE_USDC);

      const job = await manager.getJob(1n);
      expect(job.status).to.equal(JobStatus.Funded);
    });

    it("should assign a non-zero evaluator when auto-assign path is used", async function () {
      const { manager, usdc, client, provider } =
        await loadFixture(deployWithWarmedUpEvaluatorFixture);

      const deadline = BigInt(await time.latest()) + 3600n;
      await manager.connect(client).createJob(
        provider.address,
        ethers.ZeroAddress,  // auto-assign
        await usdc.getAddress(),
        deadline
      );

      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);

      const job = await manager.getJob(1n);
      expect(job.evaluator).to.not.equal(ethers.ZeroAddress);
    });

    it("should revert with BudgetNotSet when budget is 0", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      // No setBudget call

      await expect(manager.connect(client).fund(1n, 0n))
        .to.be.revertedWithCustomError(manager, "BudgetNotSet")
        .withArgs(1n);
    });

    it("should revert with BudgetMismatch when expectedBudget does not match", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);

      const wrongAmount = ethers.parseUnits("4", 6);
      await expect(manager.connect(client).fund(1n, wrongAmount))
        .to.be.revertedWithCustomError(manager, "BudgetMismatch")
        .withArgs(FIVE_USDC, wrongAmount);
    });

    it("should revert with NotAuthorized when caller is not the client", async function () {
      const { manager, usdc, client, provider, evaluator, stranger } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(stranger.address, FIVE_USDC);
      await usdc.connect(stranger).approve(await manager.getAddress(), FIVE_USDC);

      await expect(manager.connect(stranger).fund(1n, FIVE_USDC))
        .to.be.revertedWithCustomError(manager, "NotAuthorized");
    });

    it("should revert with InvalidJobStatus when job is already Funded", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC * 2n);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC * 2n);
      await manager.connect(client).fund(1n, FIVE_USDC);

      await expect(manager.connect(client).fund(1n, FIVE_USDC))
        .to.be.revertedWithCustomError(manager, "InvalidJobStatus")
        .withArgs(1n, JobStatus.Funded);
    });

    it("should transfer tokens into the contract on fund", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);

      const balance = await usdc.balanceOf(await manager.getAddress());
      expect(balance).to.equal(FIVE_USDC);
    });
  });

  // ── submit ─────────────────────────────────────────────────────────────────

  describe("submit", function () {

    async function fundedJobFixture() {
      const base = await deployFixture();
      const { manager, usdc, client, provider, evaluator } = base;

      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);

      return base;
    }

    it("should transition job to Submitted and emit JobSubmitted", async function () {
      const { manager, provider } = await loadFixture(fundedJobFixture);

      await expect(manager.connect(provider).submit(1n, DELIVERABLE))
        .to.emit(manager, "JobSubmitted")
        .withArgs(1n, DELIVERABLE);

      const job = await manager.getJob(1n);
      expect(job.status).to.equal(JobStatus.Submitted);
      expect(job.deliverable).to.equal(DELIVERABLE);
    });

    it("should revert with NotAuthorized when caller is not the provider", async function () {
      const { manager, stranger } = await loadFixture(fundedJobFixture);

      await expect(manager.connect(stranger).submit(1n, DELIVERABLE))
        .to.be.revertedWithCustomError(manager, "NotAuthorized");
    });

    it("should revert with InvalidJobStatus when job is not Funded", async function () {
      const { manager, provider } = await loadFixture(fundedJobFixture);

      // Submit once to move to Submitted state
      await manager.connect(provider).submit(1n, DELIVERABLE);

      await expect(manager.connect(provider).submit(1n, DELIVERABLE))
        .to.be.revertedWithCustomError(manager, "InvalidJobStatus")
        .withArgs(1n, JobStatus.Submitted);
    });

    it("should revert with ZeroDeliverable when deliverable is bytes32(0)", async function () {
      const { manager, provider } = await loadFixture(fundedJobFixture);

      await expect(manager.connect(provider).submit(1n, BYTES32_ZERO))
        .to.be.revertedWithCustomError(manager, "ZeroDeliverable")
        .withArgs(1n);
    });

    it("should revert with DeadlinePassed when submitting after the deadline", async function () {
      const { manager, provider } = await loadFixture(fundedJobFixture);

      const job = await manager.getJob(1n);
      // Advance time past the deadline
      await time.increaseTo(Number(job.deadline) + 1);

      await expect(manager.connect(provider).submit(1n, DELIVERABLE))
        .to.be.revertedWithCustomError(manager, "DeadlinePassed");
    });

    it("should succeed when submitting exactly at the deadline block", async function () {
      const { manager, provider } = await loadFixture(fundedJobFixture);

      const job = await manager.getJob(1n);
      // The contract uses `block.timestamp > deadline` (strict greater-than), so a submission
      // in the block whose timestamp equals the deadline is still valid.
      // time.increaseTo(N) sets the *next* block's timestamp. We set it to deadline - 1 so
      // the next mined block (the submit tx) lands at exactly `deadline`.
      await time.increaseTo(Number(job.deadline) - 1);

      await expect(manager.connect(provider).submit(1n, DELIVERABLE))
        .to.emit(manager, "JobSubmitted");
    });
  });

  // ── complete ───────────────────────────────────────────────────────────────

  describe("complete", function () {

    async function submittedJobFixture() {
      const base = await deployFixture();
      const { manager, usdc, client, provider, evaluator } = base;

      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);
      await manager.connect(provider).submit(1n, DELIVERABLE);

      return base;
    }

    it("should pay provider and fee recipient, emit JobCompleted", async function () {
      const { manager, usdc, client, provider, evaluator, deployer } =
        await loadFixture(submittedJobFixture);

      const providerBefore   = await usdc.balanceOf(provider.address);
      const evaluatorBefore  = await usdc.balanceOf(evaluator.address);
      const treasuryBefore   = await usdc.balanceOf(deployer.address); // deployer == treasury

      await expect(manager.connect(evaluator).complete(1n, REASON))
        .to.emit(manager, "JobCompleted");

      // feeRate=50 → fee = 5_000_000 * 50 / 10000 = 25_000, payment = 4_975_000
      // evaluatorFee = fee * 8000 / 10000 = 20_000 (80%)
      // treasuryFee  = fee - evaluatorFee  =  5_000 (20%)
      const fee             = FIVE_USDC * 50n / 10000n;        // 25_000
      const expectedPayment = FIVE_USDC - fee;                  // 4_975_000
      const evaluatorFee    = fee * 8000n / 10000n;             // 20_000
      const treasuryFee     = fee - evaluatorFee;               // 5_000

      expect(await usdc.balanceOf(provider.address)  - providerBefore).to.equal(expectedPayment);
      expect(await usdc.balanceOf(evaluator.address) - evaluatorBefore).to.equal(evaluatorFee);
      expect(await usdc.balanceOf(deployer.address)  - treasuryBefore).to.equal(treasuryFee);

      const job = await manager.getJob(1n);
      expect(job.status).to.equal(JobStatus.Completed);
    });

    it("should compute exact fee: budget=1_000_000, feeRate=50 → fee=5000, payment=995000", async function () {
      const { manager, usdc, client, provider, evaluator, deployer } =
        await loadFixture(deployFixture);

      // Create a job with 1 USDC budget
      const budget = ONE_USDC; // 1_000_000
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, budget);
      await usdc.mint(client.address, budget);
      await usdc.connect(client).approve(await manager.getAddress(), budget);
      await manager.connect(client).fund(1n, budget);
      await manager.connect(provider).submit(1n, DELIVERABLE);

      const providerBefore  = await usdc.balanceOf(provider.address);
      const evaluatorBefore = await usdc.balanceOf(evaluator.address);
      const treasuryBefore  = await usdc.balanceOf(deployer.address); // deployer == treasury

      await manager.connect(evaluator).complete(1n, REASON);

      // fee = 1_000_000 * 50 / 10_000 = 5_000, payment = 995_000
      // evaluatorFee = 5_000 * 8_000 / 10_000 = 4_000 (80%)
      // treasuryFee  = 5_000 - 4_000           = 1_000 (20%)
      expect(await usdc.balanceOf(provider.address)  - providerBefore).to.equal(995000n);
      expect(await usdc.balanceOf(evaluator.address) - evaluatorBefore).to.equal(4000n);
      expect(await usdc.balanceOf(deployer.address)  - treasuryBefore).to.equal(1000n);
    });

    it("should not transfer to feeRecipient when feeRate=0", async function () {
      const { manager, usdc, client, provider, evaluator, deployer } =
        await loadFixture(deployFixture);

      // Set feeRate to 0 using the two-step timelock pattern (FINDING-005).
      await manager.connect(deployer).proposeFeeRate(0);
      await time.increase(GOVERNANCE_DELAY + 1);
      await manager.connect(deployer).executeFeeRate(0);

      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);
      await manager.connect(provider).submit(1n, DELIVERABLE);

      const feeBefore = await usdc.balanceOf(deployer.address);
      await manager.connect(evaluator).complete(1n, REASON);
      const feeAfter = await usdc.balanceOf(deployer.address);

      // No fee transfer when feeRate=0
      expect(feeAfter).to.equal(feeBefore);

      // Provider receives full amount
      expect(await usdc.balanceOf(provider.address)).to.equal(FIVE_USDC);
    });

    it("should revert with NotAuthorized when caller is not the evaluator", async function () {
      const { manager, stranger } = await loadFixture(submittedJobFixture);

      await expect(manager.connect(stranger).complete(1n, REASON))
        .to.be.revertedWithCustomError(manager, "NotAuthorized");
    });

    it("should revert with InvalidJobStatus when job is not Submitted", async function () {
      const { manager, evaluator, client, provider, usdc } = await loadFixture(deployFixture);

      // Job is in Funded state (not Submitted)
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);

      await expect(manager.connect(evaluator).complete(1n, REASON))
        .to.be.revertedWithCustomError(manager, "InvalidJobStatus")
        .withArgs(1n, JobStatus.Funded);
    });

    it("should set budget to zero after complete", async function () {
      const { manager, evaluator } = await loadFixture(submittedJobFixture);

      await manager.connect(evaluator).complete(1n, REASON);

      const job = await manager.getJob(1n);
      expect(job.budget).to.equal(0n);
    });
  });

  // ── reject ─────────────────────────────────────────────────────────────────

  describe("reject", function () {

    async function fundedJobFixture() {
      const base = await deployFixture();
      const { manager, usdc, client, provider, evaluator } = base;

      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);

      return base;
    }

    async function submittedJobFixture() {
      const base = await fundedJobFixture();
      await base.manager.connect(base.provider).submit(1n, DELIVERABLE);
      return base;
    }

    it("should allow client to reject an Open job with no refund", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      await expect(manager.connect(client).reject(1n, REASON))
        .to.emit(manager, "JobRejected")
        .withArgs(1n, client.address, REASON);

      const job = await manager.getJob(1n);
      expect(job.status).to.equal(JobStatus.Rejected);
      expect(job.budget).to.equal(0n);
    });

    it("should allow evaluator to reject a Funded job and register refund", async function () {
      const { manager, usdc, client, evaluator } = await loadFixture(fundedJobFixture);

      await expect(manager.connect(evaluator).reject(1n, REASON))
        .to.emit(manager, "JobRejected")
        .withArgs(1n, client.address, REASON);

      // feeRate=50 → fee = FIVE_USDC * 50 / 10_000 = 25_000
      // client refund = budget - fee = FIVE_USDC - 25_000
      const fee     = FIVE_USDC * 50n / 10000n;
      const pending = await manager.getPendingRefund(client.address, await usdc.getAddress());
      expect(pending).to.equal(FIVE_USDC - fee);
    });

    it("should allow evaluator to reject a Submitted job and register refund", async function () {
      const { manager, usdc, client, evaluator } = await loadFixture(submittedJobFixture);

      await expect(manager.connect(evaluator).reject(1n, REASON))
        .to.emit(manager, "JobRejected")
        .withArgs(1n, client.address, REASON);

      // feeRate=50 → fee = FIVE_USDC * 50 / 10_000 = 25_000
      // client refund = budget - fee = FIVE_USDC - 25_000
      const fee     = FIVE_USDC * 50n / 10000n;
      const pending = await manager.getPendingRefund(client.address, await usdc.getAddress());
      expect(pending).to.equal(FIVE_USDC - fee);
    });

    it("should revert with NotAuthorized when client tries to reject a Funded job", async function () {
      const { manager, client } = await loadFixture(fundedJobFixture);

      await expect(manager.connect(client).reject(1n, REASON))
        .to.be.revertedWithCustomError(manager, "NotAuthorized");
    });

    it("should revert with NotAuthorized when evaluator tries to reject an Open job", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      await expect(manager.connect(evaluator).reject(1n, REASON))
        .to.be.revertedWithCustomError(manager, "NotAuthorized");
    });

    it("should revert with DeadlineAlreadyPassed when evaluator rejects after deadline (Funded)", async function () {
      const { manager, evaluator } = await loadFixture(fundedJobFixture);

      const job = await manager.getJob(1n);
      await time.increaseTo(Number(job.deadline) + 1);

      await expect(manager.connect(evaluator).reject(1n, REASON))
        .to.be.revertedWithCustomError(manager, "DeadlineAlreadyPassed")
        .withArgs(1n);
    });

    it("should revert with DeadlineAlreadyPassed when evaluator rejects after deadline (Submitted)", async function () {
      const { manager, evaluator } = await loadFixture(submittedJobFixture);

      // Need to set deadline exactly on submission time; advance past it
      const job = await manager.getJob(1n);
      await time.increaseTo(Number(job.deadline) + 1);

      await expect(manager.connect(evaluator).reject(1n, REASON))
        .to.be.revertedWithCustomError(manager, "DeadlineAlreadyPassed")
        .withArgs(1n);
    });

    it("should emit JobRejected", async function () {
      const { manager, evaluator, client } = await loadFixture(fundedJobFixture);

      await expect(manager.connect(evaluator).reject(1n, REASON))
        .to.emit(manager, "JobRejected")
        .withArgs(1n, client.address, REASON);
    });
  });

  // ── claimExpired ──────────────────────────────────────────────────────────

  describe("claimExpired", function () {

    async function fundedJobFixture() {
      const base = await deployFixture();
      const { manager, usdc, client, provider, evaluator } = base;

      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);

      return base;
    }

    async function submittedJobFixture() {
      const base = await fundedJobFixture();
      await base.manager.connect(base.provider).submit(1n, DELIVERABLE);
      return base;
    }

    it("should expire a Funded job after deadline and register refund", async function () {
      const { manager, usdc, client } = await loadFixture(fundedJobFixture);

      const job = await manager.getJob(1n);
      await time.increaseTo(Number(job.deadline) + 1);

      await expect(manager.connect(client).claimExpired(1n))
        .to.emit(manager, "JobExpired")
        .withArgs(1n, client.address);

      const expired = await manager.getJob(1n);
      expect(expired.status).to.equal(JobStatus.Expired);

      const pending = await manager.getPendingRefund(client.address, await usdc.getAddress());
      expect(pending).to.equal(FIVE_USDC);
    });

    it("should expire a Submitted job after deadline and register refund (FINDING-004)", async function () {
      const { manager, usdc, client } = await loadFixture(submittedJobFixture);

      const job = await manager.getJob(1n);
      await time.increaseTo(Number(job.deadline) + 1);

      await expect(manager.connect(client).claimExpired(1n))
        .to.emit(manager, "JobExpired")
        .withArgs(1n, client.address);

      const expired = await manager.getJob(1n);
      expect(expired.status).to.equal(JobStatus.Expired);

      const pending = await manager.getPendingRefund(client.address, await usdc.getAddress());
      expect(pending).to.equal(FIVE_USDC);
    });

    it("should revert with DeadlineNotPassed when called before deadline", async function () {
      const { manager, client } = await loadFixture(fundedJobFixture);

      await expect(manager.connect(client).claimExpired(1n))
        .to.be.revertedWithCustomError(manager, "DeadlineNotPassed");
    });

    it("should revert with NotAuthorized when caller is not the client", async function () {
      const { manager, stranger } = await loadFixture(fundedJobFixture);

      const job = await manager.getJob(1n);
      await time.increaseTo(Number(job.deadline) + 1);

      await expect(manager.connect(stranger).claimExpired(1n))
        .to.be.revertedWithCustomError(manager, "NotAuthorized");
    });

    it("should revert with InvalidJobStatus when job is Open", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      await expect(manager.connect(client).claimExpired(1n))
        .to.be.revertedWithCustomError(manager, "InvalidJobStatus")
        .withArgs(1n, JobStatus.Open);
    });
  });

  // ── claimRefund ────────────────────────────────────────────────────────────

  describe("claimRefund", function () {

    async function rejectedFundedJobFixture() {
      const base = await deployFixture();
      const { manager, usdc, client, provider, evaluator } = base;

      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);
      await manager.connect(evaluator).reject(1n, REASON);

      return base;
    }

    it("should transfer tokens to client after reject Funded", async function () {
      const { manager, usdc, client } = await loadFixture(rejectedFundedJobFixture);

      const before = await usdc.balanceOf(client.address);
      await manager.connect(client).claimRefund(await usdc.getAddress());
      const after = await usdc.balanceOf(client.address);

      // feeRate=50 → fee = FIVE_USDC * 50 / 10_000 = 25_000
      // client receives budget - fee (evaluator kept the fee on rejection)
      const fee = FIVE_USDC * 50n / 10000n;
      expect(after - before).to.equal(FIVE_USDC - fee);

      const pending = await manager.getPendingRefund(client.address, await usdc.getAddress());
      expect(pending).to.equal(0n);
    });

    it("should transfer tokens to client after reject Submitted", async function () {
      const base = await loadFixture(rejectedFundedJobFixture);
      const { manager, usdc, client, provider, evaluator } = base;

      // Create a second job — submit it then reject it
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      const budget2 = ethers.parseUnits("3", 6);
      await manager.connect(client).setBudget(2n, budget2);
      await usdc.mint(client.address, budget2);
      await usdc.connect(client).approve(await manager.getAddress(), budget2);
      await manager.connect(client).fund(2n, budget2);
      await manager.connect(provider).submit(2n, DELIVERABLE);
      await manager.connect(evaluator).reject(2n, REASON);

      const before = await usdc.balanceOf(client.address);
      await manager.connect(client).claimRefund(await usdc.getAddress());
      const after = await usdc.balanceOf(client.address);

      // Both refunds are net of fees (feeRate=50 bps):
      //   job1 refund = FIVE_USDC - (FIVE_USDC * 50 / 10_000)
      //   job2 refund = budget2   - (budget2   * 50 / 10_000)
      const fee1 = FIVE_USDC * 50n / 10000n;
      const fee2 = budget2   * 50n / 10000n;
      expect(after - before).to.equal((FIVE_USDC - fee1) + (budget2 - fee2));
    });

    it("should accumulate refunds from two rejected jobs", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);

      // Job 1
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC * 2n);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC * 2n);
      await manager.connect(client).fund(1n, FIVE_USDC);
      await manager.connect(evaluator).reject(1n, REASON);

      // Job 2
      const deadline = BigInt(await time.latest()) + 3600n;
      await manager.connect(client).createJob(
        provider.address, evaluator.address, await usdc.getAddress(), deadline
      );
      await manager.connect(client).setBudget(2n, FIVE_USDC);
      await manager.connect(client).fund(2n, FIVE_USDC);
      await manager.connect(evaluator).reject(2n, REASON);

      // feeRate=50 → fee per job = FIVE_USDC * 50 / 10_000 = 25_000
      // each refund = FIVE_USDC - 25_000; total pending = 2 * (FIVE_USDC - 25_000)
      const feePerJob = FIVE_USDC * 50n / 10000n;
      const refundPerJob = FIVE_USDC - feePerJob;

      const pending = await manager.getPendingRefund(client.address, await usdc.getAddress());
      expect(pending).to.equal(refundPerJob * 2n);

      const before = await usdc.balanceOf(client.address);
      await manager.connect(client).claimRefund(await usdc.getAddress());
      const after = await usdc.balanceOf(client.address);

      expect(after - before).to.equal(refundPerJob * 2n);
    });

    it("should revert with NothingToRefund when no pending balance", async function () {
      const { manager, usdc, client } = await loadFixture(deployFixture);

      await expect(manager.connect(client).claimRefund(await usdc.getAddress()))
        .to.be.revertedWithCustomError(manager, "NothingToRefund");
    });
  });

  // ── extendDeadline ─────────────────────────────────────────────────────────

  describe("extendDeadline", function () {

    async function fundedJobFixture() {
      const base = await deployFixture();
      const { manager, usdc, client, provider, evaluator } = base;

      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);

      return base;
    }

    it("should extend the deadline of a Funded job and emit DeadlineExtended", async function () {
      const { manager, client } = await loadFixture(fundedJobFixture);

      const job = await manager.getJob(1n);
      const oldDeadline = job.deadline;
      const newDeadline = oldDeadline + 3600n;

      await expect(manager.connect(client).extendDeadline(1n, newDeadline))
        .to.emit(manager, "DeadlineExtended")
        .withArgs(1n, oldDeadline, newDeadline);

      const updated = await manager.getJob(1n);
      expect(updated.deadline).to.equal(newDeadline);
    });

    it("should revert with InvalidJobStatus on a Submitted job", async function () {
      const { manager, client, provider } = await loadFixture(fundedJobFixture);

      await manager.connect(provider).submit(1n, DELIVERABLE);
      const job = await manager.getJob(1n);
      const newDeadline = job.deadline + 3600n;

      await expect(manager.connect(client).extendDeadline(1n, newDeadline))
        .to.be.revertedWithCustomError(manager, "InvalidJobStatus")
        .withArgs(1n, JobStatus.Submitted);
    });

    it("should revert with InvalidJobStatus on an Open job", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      const job = await manager.getJob(1n);
      const newDeadline = job.deadline + 3600n;

      await expect(manager.connect(client).extendDeadline(1n, newDeadline))
        .to.be.revertedWithCustomError(manager, "InvalidJobStatus")
        .withArgs(1n, JobStatus.Open);
    });

    it("should revert with NotAuthorized when stranger calls extendDeadline", async function () {
      const { manager, stranger } = await loadFixture(fundedJobFixture);

      const job = await manager.getJob(1n);
      const newDeadline = job.deadline + 3600n;

      await expect(manager.connect(stranger).extendDeadline(1n, newDeadline))
        .to.be.revertedWithCustomError(manager, "NotAuthorized");
    });

    it("should revert with DeadlineNotExtended when newDeadline <= current deadline", async function () {
      const { manager, client } = await loadFixture(fundedJobFixture);

      const job = await manager.getJob(1n);
      // newDeadline == currentDeadline → not strictly greater
      await expect(manager.connect(client).extendDeadline(1n, job.deadline))
        .to.be.revertedWithCustomError(manager, "DeadlineNotExtended");
    });

    it("should revert with DeadlineTooFar when newDeadline > block.timestamp + 30 days", async function () {
      const { manager, client } = await loadFixture(fundedJobFixture);

      const tooFar = BigInt(await time.latest()) + BigInt(31 * 24 * 3600);

      await expect(manager.connect(client).extendDeadline(1n, tooFar))
        .to.be.revertedWithCustomError(manager, "DeadlineTooFar");
    });

    it("should revert with DeadlineTooSoon when newDeadline < block.timestamp + MIN_DEADLINE_OFFSET", async function () {
      const { manager, client } = await loadFixture(fundedJobFixture);

      // Advance time so that the current deadline is now in the past but still > current deadline
      // We need newDeadline > currentDeadline but < block.timestamp + 5 minutes.
      // This scenario: job deadline is 1 hour from creation. Advance time to deadline - 4 minutes.
      // Then propose newDeadline = current + 1 minute (which is > old deadline but < now + 5min).
      const job = await manager.getJob(1n);
      await time.increaseTo(Number(job.deadline) - 240); // 4 minutes before deadline

      // newDeadline is 1 second after current deadline but 4 minutes from "now" (< 5min offset)
      const newDeadline = job.deadline + 1n;

      await expect(manager.connect(client).extendDeadline(1n, newDeadline))
        .to.be.revertedWithCustomError(manager, "DeadlineTooSoon");
    });
  });

  // ── reopen ─────────────────────────────────────────────────────────────────

  describe("reopen", function () {

    async function rejectedJobFixture() {
      const base = await deployFixture();
      const { manager, usdc, client, provider, evaluator } = base;

      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);
      await manager.connect(evaluator).reject(1n, REASON);

      return base;
    }

    it("should reopen a Rejected job with a new provider and emit JobReopened", async function () {
      const { manager, client, stranger } = await loadFixture(rejectedJobFixture);

      const newDeadline = BigInt(await time.latest()) + 3600n;

      await expect(manager.connect(client).reopen(1n, stranger.address, newDeadline))
        .to.emit(manager, "JobReopened")
        .withArgs(1n, client.address, stranger.address, newDeadline);

      const job = await manager.getJob(1n);
      expect(job.status).to.equal(JobStatus.Open);
      expect(job.provider).to.equal(stranger.address);
      expect(job.evaluator).to.equal(ethers.ZeroAddress);
      expect(job.budget).to.equal(0n);
    });

    it("should allow setBudget + fund after reopen", async function () {
      const { manager, usdc, client, stranger } = await loadFixture(rejectedJobFixture);

      const newDeadline = BigInt(await time.latest()) + 3600n;
      await manager.connect(client).reopen(1n, stranger.address, newDeadline);

      // Now the job is Open again — setBudget should work
      await expect(manager.connect(client).setBudget(1n, FIVE_USDC))
        .to.emit(manager, "BudgetSet");
    });

    it("should revert with InvalidJobStatus on a Completed job", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);

      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);
      await manager.connect(provider).submit(1n, DELIVERABLE);
      await manager.connect(evaluator).complete(1n, REASON);

      const newDeadline = BigInt(await time.latest()) + 3600n;
      await expect(manager.connect(client).reopen(1n, provider.address, newDeadline))
        .to.be.revertedWithCustomError(manager, "InvalidJobStatus")
        .withArgs(1n, JobStatus.Completed);
    });

    it("should revert with InvalidJobStatus on an Open job", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());

      const newDeadline = BigInt(await time.latest()) + 3600n;
      await expect(manager.connect(client).reopen(1n, provider.address, newDeadline))
        .to.be.revertedWithCustomError(manager, "InvalidJobStatus")
        .withArgs(1n, JobStatus.Open);
    });

    it("should revert with NotAuthorized when stranger calls reopen", async function () {
      const { manager, provider, stranger } = await loadFixture(rejectedJobFixture);

      const newDeadline = BigInt(await time.latest()) + 3600n;
      await expect(manager.connect(stranger).reopen(1n, provider.address, newDeadline))
        .to.be.revertedWithCustomError(manager, "NotAuthorized");
    });

    it("should revert with ZeroAddress when newProvider is address(0)", async function () {
      const { manager, client } = await loadFixture(rejectedJobFixture);

      const newDeadline = BigInt(await time.latest()) + 3600n;
      await expect(manager.connect(client).reopen(1n, ethers.ZeroAddress, newDeadline))
        .to.be.revertedWithCustomError(manager, "ZeroAddress")
        .withArgs("newProvider");
    });

    it("should revert with SelfAssignment when newProvider == client", async function () {
      const { manager, client } = await loadFixture(rejectedJobFixture);

      const newDeadline = BigInt(await time.latest()) + 3600n;
      await expect(manager.connect(client).reopen(1n, client.address, newDeadline))
        .to.be.revertedWithCustomError(manager, "SelfAssignment")
        .withArgs("newProvider");
    });
  });

  // ── Invariants ─────────────────────────────────────────────────────────────

  // ── evaluationFee governance + fixed-fee mode ──────────────────────────────

  describe("evaluationFee", function () {

    // Shared fixture: a Submitted job with 5 USDC budget, ready for complete()/reject()
    async function submittedJobFixture() {
      const base = await deployFixture();
      const { manager, usdc, client, provider, evaluator } = base;
      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);
      await manager.connect(provider).submit(1n, DELIVERABLE);
      return base;
    }

    // ── proposeEvaluationFee ──────────────────────────────────────────────────

    describe("proposeEvaluationFee", function () {

      it("should emit EvaluationFeeProposed with correct args", async function () {
        const { manager, deployer } = await loadFixture(deployFixture);
        const newFee = 500_000n; // 0.50 USDC

        await expect(manager.connect(deployer).proposeEvaluationFee(newFee))
          .to.emit(manager, "EvaluationFeeProposed")
          .withArgs(0n, newFee, anyValue);
      });

      it("should revert with OwnableUnauthorizedAccount when stranger proposes", async function () {
        const { manager, stranger } = await loadFixture(deployFixture);
        await expect(manager.connect(stranger).proposeEvaluationFee(500_000n))
          .to.be.revertedWithCustomError(manager, "OwnableUnauthorizedAccount");
      });

    });

    // ── executeEvaluationFee ──────────────────────────────────────────────────

    describe("executeEvaluationFee", function () {

      it("should update evaluationFee and emit EvaluationFeeUpdated after delay", async function () {
        const { manager, deployer } = await loadFixture(deployFixture);
        const newFee = 500_000n;

        await manager.connect(deployer).proposeEvaluationFee(newFee);
        await time.increase(GOVERNANCE_DELAY + 1);

        await expect(manager.connect(deployer).executeEvaluationFee(newFee))
          .to.emit(manager, "EvaluationFeeUpdated")
          .withArgs(0n, newFee);

        expect(await manager.evaluationFee()).to.equal(newFee);
      });

      it("should revert with NoProposalPending when no proposal exists", async function () {
        const { manager, deployer } = await loadFixture(deployFixture);
        const key = ethers.keccak256(ethers.toUtf8Bytes("evaluationFee"));

        await expect(manager.connect(deployer).executeEvaluationFee(500_000n))
          .to.be.revertedWithCustomError(manager, "NoProposalPending")
          .withArgs(key);
      });

      it("should revert with GovernanceDelayNotElapsed before delay expires", async function () {
        const { manager, deployer } = await loadFixture(deployFixture);

        await manager.connect(deployer).proposeEvaluationFee(500_000n);
        await time.increase(GOVERNANCE_DELAY - 10); // still 10 seconds short

        await expect(manager.connect(deployer).executeEvaluationFee(500_000n))
          .to.be.revertedWithCustomError(manager, "GovernanceDelayNotElapsed");
      });

      it("should revert with ProposalValueMismatch when value does not match proposal", async function () {
        const { manager, deployer } = await loadFixture(deployFixture);

        await manager.connect(deployer).proposeEvaluationFee(500_000n);
        await time.increase(GOVERNANCE_DELAY + 1);

        await expect(manager.connect(deployer).executeEvaluationFee(999_999n))
          .to.be.revertedWithCustomError(manager, "ProposalValueMismatch");
      });

      it("should allow setting evaluationFee back to 0 (revert to proportional mode)", async function () {
        const { manager, deployer } = await loadFixture(deployFixture);

        // Set to non-zero
        await manager.connect(deployer).proposeEvaluationFee(500_000n);
        await time.increase(GOVERNANCE_DELAY + 1);
        await manager.connect(deployer).executeEvaluationFee(500_000n);

        // Reset to zero
        await manager.connect(deployer).proposeEvaluationFee(0n);
        await time.increase(GOVERNANCE_DELAY + 1);
        await manager.connect(deployer).executeEvaluationFee(0n);

        expect(await manager.evaluationFee()).to.equal(0n);
      });

      it("should revert with OwnableUnauthorizedAccount when stranger executes", async function () {
        const { manager, deployer, stranger } = await loadFixture(deployFixture);

        await manager.connect(deployer).proposeEvaluationFee(500_000n);
        await time.increase(GOVERNANCE_DELAY + 1);

        await expect(manager.connect(stranger).executeEvaluationFee(500_000n))
          .to.be.revertedWithCustomError(manager, "OwnableUnauthorizedAccount");
      });

    });

    // ── fixed-fee mode: complete() ────────────────────────────────────────────

    describe("fixed-fee mode in complete()", function () {

      async function fixedFeeFixture() {
        const base = await submittedJobFixture();
        const { manager, deployer } = base;
        // Set evaluationFee = 1 USDC (1_000_000 units)
        await manager.connect(deployer).proposeEvaluationFee(ONE_USDC);
        await time.increase(GOVERNANCE_DELAY + 1);
        await manager.connect(deployer).executeEvaluationFee(ONE_USDC);
        return base;
      }

      it("should use fixed fee instead of proportional on complete()", async function () {
        const { manager, usdc, provider, evaluator, deployer } = await loadFixture(fixedFeeFixture);

        const providerBefore  = await usdc.balanceOf(provider.address);
        const evaluatorBefore = await usdc.balanceOf(evaluator.address);
        const treasuryBefore  = await usdc.balanceOf(deployer.address);

        await manager.connect(evaluator).complete(1n, REASON);

        // evaluationFee = 1_000_000, budget = 5_000_000
        // evaluatorFee  = 1_000_000 * 8_000 / 10_000 = 800_000 (80%)
        // treasuryFee   = 1_000_000 - 800_000         = 200_000 (20%)
        // providerPay   = 5_000_000 - 1_000_000       = 4_000_000
        const fee          = ONE_USDC; // 1_000_000
        const evaluatorFee = fee * 8000n / 10000n; // 800_000
        const treasuryFee  = fee - evaluatorFee;   // 200_000

        expect(await usdc.balanceOf(provider.address)  - providerBefore).to.equal(FIVE_USDC - fee);
        expect(await usdc.balanceOf(evaluator.address) - evaluatorBefore).to.equal(evaluatorFee);
        expect(await usdc.balanceOf(deployer.address)  - treasuryBefore).to.equal(treasuryFee);
      });

      it("should emit FeeDistributed with fixed-fee amounts on complete()", async function () {
        const { manager, usdc, evaluator, deployer } = await loadFixture(fixedFeeFixture);

        const fee          = ONE_USDC;
        const evaluatorFee = fee * 8000n / 10000n;
        const treasuryFee  = fee - evaluatorFee;

        await expect(manager.connect(evaluator).complete(1n, REASON))
          .to.emit(manager, "FeeDistributed")
          .withArgs(1n, evaluator.address, evaluatorFee, treasuryFee);
      });

    });

    // ── fixed-fee mode: reject() ──────────────────────────────────────────────

    describe("fixed-fee mode in reject()", function () {

      async function fixedFeeSubmittedFixture() {
        // Set evaluationFee BEFORE creating the job — governance delay (2 days) would
        // push the clock past the 1-hour deadline in submittedJobFixture.
        const base = await deployFixture();
        const { manager, usdc, client, provider, evaluator, deployer } = base;

        await manager.connect(deployer).proposeEvaluationFee(ONE_USDC);
        await time.increase(GOVERNANCE_DELAY + 1);
        await manager.connect(deployer).executeEvaluationFee(ONE_USDC);

        // Create and fund the job after the governance delay so the deadline is fresh.
        await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
        await manager.connect(client).setBudget(1n, FIVE_USDC);
        await usdc.mint(client.address, FIVE_USDC);
        await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
        await manager.connect(client).fund(1n, FIVE_USDC);
        await manager.connect(provider).submit(1n, DELIVERABLE);

        return base;
      }

      it("should use fixed fee on reject() and refund client net of fee", async function () {
        const { manager, usdc, client, evaluator, deployer } = await loadFixture(fixedFeeSubmittedFixture);

        const clientBefore    = await usdc.balanceOf(client.address);
        const evaluatorBefore = await usdc.balanceOf(evaluator.address);
        const treasuryBefore  = await usdc.balanceOf(deployer.address);

        await manager.connect(evaluator).reject(1n, REASON);
        await manager.connect(client).claimRefund(await usdc.getAddress());

        // evaluationFee = 1_000_000, budget = 5_000_000
        // evaluatorFee = 800_000, treasuryFee = 200_000
        // client refund = 5_000_000 - 1_000_000 = 4_000_000
        const fee          = ONE_USDC;
        const evaluatorFee = fee * 8000n / 10000n;
        const treasuryFee  = fee - evaluatorFee;

        expect(await usdc.balanceOf(client.address)    - clientBefore).to.equal(FIVE_USDC - fee);
        expect(await usdc.balanceOf(evaluator.address) - evaluatorBefore).to.equal(evaluatorFee);
        expect(await usdc.balanceOf(deployer.address)  - treasuryBefore).to.equal(treasuryFee);
      });

      it("should emit FeeDistributed with fixed-fee amounts on reject()", async function () {
        const { manager, evaluator } = await loadFixture(fixedFeeSubmittedFixture);

        const fee          = ONE_USDC;
        const evaluatorFee = fee * 8000n / 10000n;
        const treasuryFee  = fee - evaluatorFee;

        await expect(manager.connect(evaluator).reject(1n, REASON))
          .to.emit(manager, "FeeDistributed")
          .withArgs(1n, evaluator.address, evaluatorFee, treasuryFee);
      });

    });

    // ── fixed fee cap: evaluationFee > budget ─────────────────────────────────

    describe("evaluationFee capped at budget", function () {

      it("should cap fee at budget when evaluationFee > budget on complete()", async function () {
        const { manager, usdc, client, provider, evaluator, deployer } = await loadFixture(deployFixture);

        // Set evaluationFee = 10 USDC > job budget (1 USDC)
        const hugeFee = ethers.parseUnits("10", 6);
        await manager.connect(deployer).proposeEvaluationFee(hugeFee);
        await time.increase(GOVERNANCE_DELAY + 1);
        await manager.connect(deployer).executeEvaluationFee(hugeFee);

        const budget = ONE_USDC; // 1 USDC
        await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
        await manager.connect(client).setBudget(1n, budget);
        await usdc.mint(client.address, budget);
        await usdc.connect(client).approve(await manager.getAddress(), budget);
        await manager.connect(client).fund(1n, budget);
        await manager.connect(provider).submit(1n, DELIVERABLE);

        const providerBefore  = await usdc.balanceOf(provider.address);
        const evaluatorBefore = await usdc.balanceOf(evaluator.address);
        const treasuryBefore  = await usdc.balanceOf(deployer.address);

        await manager.connect(evaluator).complete(1n, REASON);

        // fee capped to budget = 1_000_000
        // evaluatorFee = 1_000_000 * 8_000 / 10_000 = 800_000
        // treasuryFee  = 200_000
        // providerPay  = 1_000_000 - 1_000_000 = 0
        const cappedFee    = budget;
        const evaluatorFee = cappedFee * 8000n / 10000n;
        const treasuryFee  = cappedFee - evaluatorFee;

        expect(await usdc.balanceOf(provider.address)  - providerBefore).to.equal(0n);
        expect(await usdc.balanceOf(evaluator.address) - evaluatorBefore).to.equal(evaluatorFee);
        expect(await usdc.balanceOf(deployer.address)  - treasuryBefore).to.equal(treasuryFee);
      });

    });

  });

  describe("Invariants", function () {

    it("budget should be zero after Completed state", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);

      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);
      await manager.connect(provider).submit(1n, DELIVERABLE);
      await manager.connect(evaluator).complete(1n, REASON);

      expect((await manager.getJob(1n)).budget).to.equal(0n);
    });

    it("budget should be zero after Rejected state", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);

      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);
      await manager.connect(evaluator).reject(1n, REASON);

      expect((await manager.getJob(1n)).budget).to.equal(0n);
    });

    it("budget should be zero after Expired state", async function () {
      const { manager, usdc, client, provider, evaluator } = await loadFixture(deployFixture);

      await createExplicitJob(manager, client, provider.address, evaluator.address, await usdc.getAddress());
      await manager.connect(client).setBudget(1n, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(1n, FIVE_USDC);

      const job = await manager.getJob(1n);
      await time.increaseTo(Number(job.deadline) + 1);
      await manager.connect(client).claimExpired(1n);

      expect((await manager.getJob(1n)).budget).to.equal(0n);
    });

    it("sum of active budgets equals USDC balance of the contract", async function () {
      const { manager, usdc, client, provider, evaluator, stranger } = await loadFixture(deployFixture);

      const budget1 = FIVE_USDC;
      const budget2 = ethers.parseUnits("3", 6);

      // Create and fund two jobs
      const deadline = BigInt(await time.latest()) + 3600n;

      await manager.connect(client).createJob(provider.address, evaluator.address, await usdc.getAddress(), deadline);
      await manager.connect(client).setBudget(1n, budget1);

      await manager.connect(stranger).createJob(provider.address, evaluator.address, await usdc.getAddress(), deadline);
      await manager.connect(stranger).setBudget(2n, budget2);

      await usdc.mint(client.address, budget1);
      await usdc.mint(stranger.address, budget2);
      await usdc.connect(client).approve(await manager.getAddress(), budget1);
      await usdc.connect(stranger).approve(await manager.getAddress(), budget2);

      await manager.connect(client).fund(1n, budget1);
      await manager.connect(stranger).fund(2n, budget2);

      const contractBalance = await usdc.balanceOf(await manager.getAddress());
      expect(contractBalance).to.equal(budget1 + budget2);
    });
  });

  // ── attested complete() ────────────────────────────────────────────────────

  describe("attested complete()", function () {

    const ATTESTATION_HASH = ethers.keccak256(ethers.toUtf8Bytes("manifest_hash_v1"));
    const PROOF            = ethers.toUtf8Bytes("dummy-proof-payload");

    /**
     * Fixture: deploys everything, then creates, funds, and submits a job.
     * Returns a MockAttestationVerifier (initially configured to pass) and
     * the jobId so individual tests can call the attested complete() directly.
     */
    async function attestedCompleteFixture() {
      const base = await loadFixture(deployFixture);
      const { manager, usdc, client, provider, evaluator } = base;

      // Deploy mock verifier configured to pass
      const MockVerifierFactory = await ethers.getContractFactory("MockAttestationVerifier");
      const verifier = await MockVerifierFactory.deploy(true);
      await verifier.waitForDeployment();

      // Create, fund, and submit the job
      const jobId = await createExplicitJob(
        manager, client, provider.address, evaluator.address, await usdc.getAddress()
      );
      await manager.connect(client).setBudget(jobId, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(jobId, FIVE_USDC);
      await manager.connect(provider).submit(jobId, DELIVERABLE);

      return { ...base, verifier, jobId };
    }

    it("completes the job and stores attestationHash as job.reason", async function () {
      const { manager, evaluator, verifier, jobId } = await loadFixture(attestedCompleteFixture);

      await manager.connect(evaluator)["complete(uint256,bytes32,address,bytes)"](
        jobId, ATTESTATION_HASH, await verifier.getAddress(), PROOF
      );

      const job = await manager.getJob(jobId);
      expect(job.status).to.equal(JobStatus.Completed);
      expect(job.reason).to.equal(ATTESTATION_HASH);
      expect(job.budget).to.equal(0n);
    });

    it("emits JobCompleted and FeeDistributed events", async function () {
      const { manager, evaluator, verifier, jobId } = await loadFixture(attestedCompleteFixture);

      const expectedFee        = FIVE_USDC * BigInt(FEE_RATE) / 10_000n;
      const expectedPayment    = FIVE_USDC - expectedFee;
      const expectedEvalFee    = expectedFee * 8_000n / 10_000n;
      const expectedTreasuryFee = expectedFee - expectedEvalFee;

      await expect(
        manager.connect(evaluator)["complete(uint256,bytes32,address,bytes)"](
          jobId, ATTESTATION_HASH, await verifier.getAddress(), PROOF
        )
      )
        .to.emit(manager, "JobCompleted")
        .withArgs(jobId, anyValue, expectedPayment, expectedFee)
        .and.to.emit(manager, "FeeDistributed")
        .withArgs(jobId, evaluator.address, expectedEvalFee, expectedTreasuryFee);
    });

    it("reverts with AttestationFailed when verifier returns false", async function () {
      const { manager, evaluator, verifier, jobId } = await loadFixture(attestedCompleteFixture);

      await verifier.setResult(false);

      await expect(
        manager.connect(evaluator)["complete(uint256,bytes32,address,bytes)"](
          jobId, ATTESTATION_HASH, await verifier.getAddress(), PROOF
        )
      ).to.be.revertedWithCustomError(manager, "AttestationFailed")
        .withArgs(jobId, await verifier.getAddress());
    });

    it("reverts with ZeroAddress when verifier is address(0)", async function () {
      const { manager, evaluator, jobId } = await loadFixture(attestedCompleteFixture);

      await expect(
        manager.connect(evaluator)["complete(uint256,bytes32,address,bytes)"](
          jobId, ATTESTATION_HASH, ethers.ZeroAddress, PROOF
        )
      ).to.be.revertedWithCustomError(manager, "ZeroAddress")
        .withArgs("verifier");
    });

    it("reverts with NotAuthorized when called by non-evaluator", async function () {
      const { manager, stranger, verifier, jobId } = await loadFixture(attestedCompleteFixture);

      await expect(
        manager.connect(stranger)["complete(uint256,bytes32,address,bytes)"](
          jobId, ATTESTATION_HASH, await verifier.getAddress(), PROOF
        )
      ).to.be.revertedWithCustomError(manager, "NotAuthorized")
        .withArgs(stranger.address, jobId, "evaluator");
    });

    it("reverts with InvalidJobStatus when job is not Submitted", async function () {
      const { manager, client, provider, evaluator, usdc, verifier } =
        await loadFixture(attestedCompleteFixture);

      // Create a job and stop at Funded state (do not submit)
      const jobId2 = await createExplicitJob(
        manager, client, provider.address, evaluator.address, await usdc.getAddress()
      );
      await manager.connect(client).setBudget(jobId2, FIVE_USDC);
      await usdc.mint(client.address, FIVE_USDC);
      await usdc.connect(client).approve(await manager.getAddress(), FIVE_USDC);
      await manager.connect(client).fund(jobId2, FIVE_USDC);
      // Still Funded — not yet Submitted

      await expect(
        manager.connect(evaluator)["complete(uint256,bytes32,address,bytes)"](
          jobId2, ATTESTATION_HASH, await verifier.getAddress(), PROOF
        )
      ).to.be.revertedWithCustomError(manager, "InvalidJobStatus")
        .withArgs(jobId2, JobStatus.Funded);
    });

    it("transfers the correct payment to the provider after fee deduction", async function () {
      const { manager, evaluator, provider, usdc, verifier, jobId } =
        await loadFixture(attestedCompleteFixture);

      const expectedFee     = FIVE_USDC * BigInt(FEE_RATE) / 10_000n;
      const expectedPayment = FIVE_USDC - expectedFee;
      const balanceBefore   = await usdc.balanceOf(provider.address);

      await manager.connect(evaluator)["complete(uint256,bytes32,address,bytes)"](
        jobId, ATTESTATION_HASH, await verifier.getAddress(), PROOF
      );

      expect(await usdc.balanceOf(provider.address)).to.equal(balanceBefore + expectedPayment);
    });
  });
});
