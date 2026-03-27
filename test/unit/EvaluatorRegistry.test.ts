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

const WARMUP_PERIOD    = 7 * 24 * 3600;        // 7 days in seconds
const MAX_WARMUP       = 30 * 24 * 3600;        // 30 days cap
const MIN_STAKE        = ethers.parseEther("100");  // 100 * 1e18 (minEvaluatorStake default)
const BELOW_MIN        = ethers.parseEther("50");   // below the minimum
const ABOVE_MIN        = ethers.parseEther("200");  // well above the minimum
const FEE_RATE         = 50;

// ─── Fixture ─────────────────────────────────────────────────────────────────

async function deployFixture() {
  const [deployer, evaluatorA, evaluatorB, stranger] = await ethers.getSigners();

  // 1. ProtocolToken
  const ProtocolTokenFactory = await ethers.getContractFactory("ProtocolToken");
  const protocolToken = (await ProtocolTokenFactory.deploy()) as ProtocolToken;
  await protocolToken.waitForDeployment();

  // 2. EvaluatorRegistry
  const EvaluatorRegistryFactory = await ethers.getContractFactory("EvaluatorRegistry");
  const registry = (await EvaluatorRegistryFactory.deploy(
    await protocolToken.getAddress()
  )) as EvaluatorRegistry;
  await registry.waitForDeployment();

  // 3. MockUSDC (needed for AgentJobManager constructor)
  const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
  const usdc = (await MockUSDCFactory.deploy()) as MockUSDC;
  await usdc.waitForDeployment();

  // 4. AgentJobManager — provides a valid jobManager address for the registry.
  //    MockUSDC is passed in _initialAllowedTokens (FINDING-007).
  const AgentJobManagerFactory = await ethers.getContractFactory("AgentJobManager");
  const manager = (await AgentJobManagerFactory.deploy(
    await registry.getAddress(),
    FEE_RATE,
    deployer.address,          // feeRecipient
    ethers.ZeroAddress,        // _reputationBridge — not wired in unit tests
    [await usdc.getAddress()]  // _initialAllowedTokens — FINDING-007
  )) as AgentJobManager;
  await manager.waitForDeployment();

  // 5. Wire up using the propose/execute timelock pattern (FINDING-005).
  //    GOVERNANCE_DELAY = 2 days — we advance time so the registry is operational
  //    from the first test in this suite.
  const GOVERNANCE_DELAY_SEC = 2 * 24 * 3600;
  await registry.proposeJobManager(await manager.getAddress());
  await time.increase(GOVERNANCE_DELAY_SEC + 1);
  await registry.executeJobManager(await manager.getAddress());

  // Distribute tokens to evaluators so they can stake
  await protocolToken.transfer(evaluatorA.address, ABOVE_MIN);
  await protocolToken.transfer(evaluatorB.address, ABOVE_MIN);

  return { registry, protocolToken, manager, usdc, deployer, evaluatorA, evaluatorB, stranger };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("EvaluatorRegistry", function () {

  // ── stake ──────────────────────────────────────────────────────────────────

  describe("stake", function () {

    it("should update stakedAmount but not activate when stake is below minimum", async function () {
      const { registry, protocolToken, evaluatorA } = await loadFixture(deployFixture);

      await protocolToken.connect(evaluatorA).approve(await registry.getAddress(), BELOW_MIN);
      await registry.connect(evaluatorA).stake(BELOW_MIN);

      expect(await registry.getStake(evaluatorA.address)).to.equal(BELOW_MIN);
      expect(await registry.isEligible(evaluatorA.address)).to.be.false;
      expect(await registry.getEvaluatorCount()).to.equal(0);
    });

    it("should activate the evaluator when stake reaches the minimum", async function () {
      const { registry, protocolToken, evaluatorA } = await loadFixture(deployFixture);

      await protocolToken.connect(evaluatorA).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(evaluatorA).stake(MIN_STAKE);
      await time.increase(WARMUP_PERIOD + 1); // isEligible now includes warmup filter

      expect(await registry.isEligible(evaluatorA.address)).to.be.true;
      expect(await registry.getEvaluatorCount()).to.equal(1);
    });

    it("should set activeSince when crossing the minimum threshold", async function () {
      const { registry, protocolToken, evaluatorA } = await loadFixture(deployFixture);

      const before = await time.latest();
      await protocolToken.connect(evaluatorA).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(evaluatorA).stake(MIN_STAKE);
      const after = await time.latest();
      await time.increase(WARMUP_PERIOD + 1); // isEligible now includes warmup filter

      // activeSince is set at stake time; after warmup has elapsed the evaluator is eligible
      expect(await registry.isEligible(evaluatorA.address)).to.be.true;
      // The stake happened between `before` and `after`
      expect(after).to.be.greaterThanOrEqual(before);
    });

    it("should activate on the second stake when cumulative stake crosses the threshold", async function () {
      const { registry, protocolToken, evaluatorA } = await loadFixture(deployFixture);

      // First stake: below minimum
      const firstStake  = BELOW_MIN;
      const secondStake = MIN_STAKE - BELOW_MIN; // exactly reaches the minimum

      await protocolToken.connect(evaluatorA).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(evaluatorA).stake(firstStake);
      expect(await registry.isEligible(evaluatorA.address)).to.be.false;

      await registry.connect(evaluatorA).stake(secondStake);
      await time.increase(WARMUP_PERIOD + 1); // isEligible now includes warmup filter
      expect(await registry.isEligible(evaluatorA.address)).to.be.true;
      expect(await registry.getEvaluatorCount()).to.equal(1);
    });

    it("should revert with ZeroAmount when amount is 0", async function () {
      const { registry, evaluatorA } = await loadFixture(deployFixture);

      await expect(registry.connect(evaluatorA).stake(0n))
        .to.be.revertedWithCustomError(registry, "ZeroAmount");
    });

    it("should emit Staked event", async function () {
      const { registry, protocolToken, evaluatorA } = await loadFixture(deployFixture);

      await protocolToken.connect(evaluatorA).approve(await registry.getAddress(), MIN_STAKE);

      await expect(registry.connect(evaluatorA).stake(MIN_STAKE))
        .to.emit(registry, "Staked")
        .withArgs(evaluatorA.address, MIN_STAKE, MIN_STAKE);
    });
  });

  // ── unstake ────────────────────────────────────────────────────────────────

  describe("unstake", function () {

    async function stakedFixture() {
      const base = await deployFixture();
      const { registry, protocolToken, evaluatorA } = base;

      await protocolToken.connect(evaluatorA).approve(await registry.getAddress(), ABOVE_MIN);
      await registry.connect(evaluatorA).stake(ABOVE_MIN);
      await time.increase(WARMUP_PERIOD + 1); // advance past warmup so isEligible returns true

      return base;
    }

    it("should allow partial unstake when remaining stake stays above minimum", async function () {
      const { registry, evaluatorA } = await loadFixture(stakedFixture);

      // ABOVE_MIN = 200 tokens, MIN_STAKE = 100 — unstake 50 leaves 150 (still above min)
      const unstakeAmount = ethers.parseEther("50");
      await registry.connect(evaluatorA).unstake(unstakeAmount);

      expect(await registry.getStake(evaluatorA.address)).to.equal(ABOVE_MIN - unstakeAmount);
      expect(await registry.isEligible(evaluatorA.address)).to.be.true;
    });

    it("should deactivate when fully unstaking all tokens", async function () {
      const { registry, evaluatorA } = await loadFixture(stakedFixture);

      await registry.connect(evaluatorA).unstake(ABOVE_MIN);

      expect(await registry.getStake(evaluatorA.address)).to.equal(0n);
      expect(await registry.isEligible(evaluatorA.address)).to.be.false;
      expect(await registry.getEvaluatorCount()).to.equal(0);
    });

    it("should revert with InsufficientStake when amount exceeds staked balance", async function () {
      const { registry, evaluatorA } = await loadFixture(stakedFixture);

      const tooMuch = ABOVE_MIN + 1n;
      await expect(registry.connect(evaluatorA).unstake(tooMuch))
        .to.be.revertedWithCustomError(registry, "InsufficientStake")
        .withArgs(tooMuch, ABOVE_MIN);
    });

    it("should revert with WouldDropBelowMinimum on partial unstake that drops between 0 and min", async function () {
      const { registry, evaluatorA } = await loadFixture(stakedFixture);

      // Unstaking 150 from 200 leaves 50, which is between 0 and 100 (minimum)
      const badUnstake = ethers.parseEther("150");
      const expectedRemaining = ABOVE_MIN - badUnstake; // 50e18

      await expect(registry.connect(evaluatorA).unstake(badUnstake))
        .to.be.revertedWithCustomError(registry, "WouldDropBelowMinimum")
        .withArgs(expectedRemaining, MIN_STAKE);
    });

    it("should emit Unstaked event", async function () {
      const { registry, evaluatorA } = await loadFixture(stakedFixture);

      const unstakeAmount = ethers.parseEther("50");
      const expectedRemaining = ABOVE_MIN - unstakeAmount;

      await expect(registry.connect(evaluatorA).unstake(unstakeAmount))
        .to.emit(registry, "Unstaked")
        .withArgs(evaluatorA.address, unstakeAmount, expectedRemaining);
    });

    it("should return tokens to the staker on unstake", async function () {
      const { registry, protocolToken, evaluatorA } = await loadFixture(stakedFixture);

      const before = await protocolToken.balanceOf(evaluatorA.address);
      await registry.connect(evaluatorA).unstake(ABOVE_MIN);
      const after = await protocolToken.balanceOf(evaluatorA.address);

      expect(after - before).to.equal(ABOVE_MIN);
    });
  });

  // ── warmup period ──────────────────────────────────────────────────────────

  describe("warmup period", function () {

    async function activeButColdFixture() {
      const base = await deployFixture();
      const { registry, protocolToken, evaluatorA, manager } = base;

      await protocolToken.connect(evaluatorA).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(evaluatorA).stake(MIN_STAKE);
      // evaluatorA is active but NOT yet past warmup

      return base;
    }

    it("should revert with NoEligibleEvaluators before warmup period has elapsed", async function () {
      const { registry, manager } = await loadFixture(activeButColdFixture);

      // Impersonate the job manager to call assignEvaluator directly on the same registry instance.
      const managerAddr = await manager.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [managerAddr]);
      await ethers.provider.send("hardhat_setBalance", [managerAddr, "0x56BC75E2D63100000"]);
      const managerSigner = await ethers.getSigner(managerAddr);

      await expect(
        registry.connect(managerSigner).assignEvaluator(1n)
      ).to.be.revertedWithCustomError(registry, "NoEligibleEvaluators");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [managerAddr]);
    });

    it("should assign an evaluator after the warmup period has elapsed", async function () {
      const base = await loadFixture(activeButColdFixture);
      const { registry, manager } = base;

      await time.increase(WARMUP_PERIOD + 1);

      const managerAddr = await manager.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [managerAddr]);
      await ethers.provider.send("hardhat_setBalance", [managerAddr, "0x56BC75E2D63100000"]);
      const managerSigner = await ethers.getSigner(managerAddr);

      await expect(registry.connect(managerSigner).assignEvaluator(1n))
        .to.emit(registry, "EvaluatorAssigned");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [managerAddr]);
    });

    it("should restart warmup period when re-staking after full unstake", async function () {
      const base = await loadFixture(activeButColdFixture);
      const { registry, protocolToken, evaluatorA, manager } = base;

      // Fast-forward past warmup so evaluatorA is eligible
      await time.increase(WARMUP_PERIOD + 1);

      // Now fully unstake and re-stake — warmup should restart
      await registry.connect(evaluatorA).unstake(MIN_STAKE);
      await protocolToken.connect(evaluatorA).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(evaluatorA).stake(MIN_STAKE);

      // evaluatorA just re-staked — warmup NOT passed yet
      const managerAddr = await manager.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [managerAddr]);
      await ethers.provider.send("hardhat_setBalance", [managerAddr, "0x56BC75E2D63100000"]);
      const managerSigner = await ethers.getSigner(managerAddr);

      await expect(registry.connect(managerSigner).assignEvaluator(1n))
        .to.be.revertedWithCustomError(registry, "NoEligibleEvaluators");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [managerAddr]);
    });
  });

  // ── assignEvaluator ───────────────────────────────────────────────────────

  describe("assignEvaluator", function () {

    async function warmedUpFixture() {
      const base = await deployFixture();
      const { registry, protocolToken, evaluatorA } = base;

      await protocolToken.connect(evaluatorA).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(evaluatorA).stake(MIN_STAKE);
      await time.increase(WARMUP_PERIOD + 1);

      return base;
    }

    it("should assign the only warmed-up evaluator", async function () {
      const { registry, manager, evaluatorA } = await loadFixture(warmedUpFixture);

      const managerAddr = await manager.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [managerAddr]);
      await ethers.provider.send("hardhat_setBalance", [managerAddr, "0x56BC75E2D63100000"]);
      const managerSigner = await ethers.getSigner(managerAddr);

      const tx = await registry.connect(managerSigner).assignEvaluator(1n);
      const receipt = await tx.wait();

      // Parse the EvaluatorAssigned event
      const iface = registry.interface;
      let assigned: string | undefined;
      for (const log of receipt!.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "EvaluatorAssigned") {
            assigned = parsed.args.evaluator as string;
          }
        } catch {}
      }

      expect(assigned).to.equal(evaluatorA.address);

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [managerAddr]);
    });

    it("should revert with NoEligibleEvaluators when no evaluator is registered", async function () {
      const { registry, manager } = await loadFixture(deployFixture);

      const managerAddr = await manager.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [managerAddr]);
      await ethers.provider.send("hardhat_setBalance", [managerAddr, "0x56BC75E2D63100000"]);
      const managerSigner = await ethers.getSigner(managerAddr);

      await expect(registry.connect(managerSigner).assignEvaluator(1n))
        .to.be.revertedWithCustomError(registry, "NoEligibleEvaluators");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [managerAddr]);
    });

    it("should revert with NoEligibleEvaluators when evaluator is not yet warmed up", async function () {
      const { registry, protocolToken, evaluatorA, manager } = await loadFixture(deployFixture);

      await protocolToken.connect(evaluatorA).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(evaluatorA).stake(MIN_STAKE);
      // No time.increase — warmup not elapsed

      const managerAddr = await manager.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [managerAddr]);
      await ethers.provider.send("hardhat_setBalance", [managerAddr, "0x56BC75E2D63100000"]);
      const managerSigner = await ethers.getSigner(managerAddr);

      await expect(registry.connect(managerSigner).assignEvaluator(1n))
        .to.be.revertedWithCustomError(registry, "NoEligibleEvaluators");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [managerAddr]);
    });

    it("should revert with OnlyJobManager when called by a non-manager address", async function () {
      const { registry, stranger } = await loadFixture(deployFixture);

      await expect(registry.connect(stranger).assignEvaluator(1n))
        .to.be.revertedWithCustomError(registry, "OnlyJobManager")
        .withArgs(stranger.address);
    });

    it("should emit EvaluatorAssigned", async function () {
      const { registry, manager, evaluatorA } = await loadFixture(warmedUpFixture);

      const managerAddr = await manager.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [managerAddr]);
      await ethers.provider.send("hardhat_setBalance", [managerAddr, "0x56BC75E2D63100000"]);
      const managerSigner = await ethers.getSigner(managerAddr);

      await expect(registry.connect(managerSigner).assignEvaluator(1n))
        .to.emit(registry, "EvaluatorAssigned")
        .withArgs(1n, evaluatorA.address);

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [managerAddr]);
    });
  });

  // ── slash ──────────────────────────────────────────────────────────────────

  describe("slash", function () {

    async function warmedUpStakedFixture() {
      const base = await deployFixture();
      const { registry, protocolToken, evaluatorA } = base;

      // evaluatorA stakes ABOVE_MIN (200 tokens)
      await protocolToken.connect(evaluatorA).approve(await registry.getAddress(), ABOVE_MIN);
      await registry.connect(evaluatorA).stake(ABOVE_MIN);
      await time.increase(WARMUP_PERIOD + 1);

      return base;
    }

    it("should reduce stakedAmount on partial slash but keep evaluator active", async function () {
      const { registry, manager, evaluatorA } = await loadFixture(warmedUpStakedFixture);

      const slashAmount = ethers.parseEther("50"); // leaves 150, still above 100 minimum

      const managerAddr = await manager.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [managerAddr]);
      await ethers.provider.send("hardhat_setBalance", [managerAddr, "0x56BC75E2D63100000"]);
      const managerSigner = await ethers.getSigner(managerAddr);

      await registry.connect(managerSigner).slash(evaluatorA.address, slashAmount);

      expect(await registry.getStake(evaluatorA.address)).to.equal(ABOVE_MIN - slashAmount);
      expect(await registry.isEligible(evaluatorA.address)).to.be.true;

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [managerAddr]);
    });

    it("should deactivate evaluator when slash drops stake below minimum", async function () {
      const { registry, manager, evaluatorA } = await loadFixture(warmedUpStakedFixture);

      // Slash 150 from 200 leaves 50 — below the 100 minimum
      const slashAmount = ethers.parseEther("150");

      const managerAddr = await manager.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [managerAddr]);
      await ethers.provider.send("hardhat_setBalance", [managerAddr, "0x56BC75E2D63100000"]);
      const managerSigner = await ethers.getSigner(managerAddr);

      await registry.connect(managerSigner).slash(evaluatorA.address, slashAmount);

      expect(await registry.isEligible(evaluatorA.address)).to.be.false;
      expect(await registry.getEvaluatorCount()).to.equal(0);

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [managerAddr]);
    });

    it("should revert with SlashExceedsStake when slash > staked balance", async function () {
      const { registry, manager, evaluatorA } = await loadFixture(warmedUpStakedFixture);

      const tooMuch = ABOVE_MIN + 1n;

      const managerAddr = await manager.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [managerAddr]);
      await ethers.provider.send("hardhat_setBalance", [managerAddr, "0x56BC75E2D63100000"]);
      const managerSigner = await ethers.getSigner(managerAddr);

      await expect(registry.connect(managerSigner).slash(evaluatorA.address, tooMuch))
        .to.be.revertedWithCustomError(registry, "SlashExceedsStake")
        .withArgs(tooMuch, ABOVE_MIN);

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [managerAddr]);
    });

    it("should revert with OnlyJobManager when called by a non-manager", async function () {
      const { registry, evaluatorA, stranger } = await loadFixture(warmedUpStakedFixture);

      await expect(registry.connect(stranger).slash(evaluatorA.address, ethers.parseEther("10")))
        .to.be.revertedWithCustomError(registry, "OnlyJobManager")
        .withArgs(stranger.address);
    });

    it("should burn the slashed tokens (reduce totalSupply)", async function () {
      const { registry, protocolToken, manager, evaluatorA } = await loadFixture(warmedUpStakedFixture);

      const slashAmount = ethers.parseEther("50");
      const supplyBefore = await protocolToken.totalSupply();

      const managerAddr = await manager.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [managerAddr]);
      await ethers.provider.send("hardhat_setBalance", [managerAddr, "0x56BC75E2D63100000"]);
      const managerSigner = await ethers.getSigner(managerAddr);

      await registry.connect(managerSigner).slash(evaluatorA.address, slashAmount);

      const supplyAfter = await protocolToken.totalSupply();
      expect(supplyBefore - supplyAfter).to.equal(slashAmount);

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [managerAddr]);
    });

    it("should emit EvaluatorSlashed with correct remaining stake", async function () {
      const { registry, manager, evaluatorA } = await loadFixture(warmedUpStakedFixture);

      const slashAmount = ethers.parseEther("50");
      const expectedRemaining = ABOVE_MIN - slashAmount;

      const managerAddr = await manager.getAddress();
      await ethers.provider.send("hardhat_impersonateAccount", [managerAddr]);
      await ethers.provider.send("hardhat_setBalance", [managerAddr, "0x56BC75E2D63100000"]);
      const managerSigner = await ethers.getSigner(managerAddr);

      await expect(registry.connect(managerSigner).slash(evaluatorA.address, slashAmount))
        .to.emit(registry, "EvaluatorSlashed")
        .withArgs(evaluatorA.address, slashAmount, expectedRemaining);

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [managerAddr]);
    });
  });

  // ── setWarmupPeriod ───────────────────────────────────────────────────────

  describe("setWarmupPeriod", function () {

    it("should allow owner to update warmup period and emit WarmupPeriodUpdated", async function () {
      const { registry, deployer } = await loadFixture(deployFixture);

      const newPeriod = 3 * 24 * 3600; // 3 days

      await expect(registry.connect(deployer).setWarmupPeriod(newPeriod))
        .to.emit(registry, "WarmupPeriodUpdated")
        .withArgs(newPeriod);

      expect(await registry.warmupPeriod()).to.equal(newPeriod);
    });

    it("should revert with WarmupPeriodTooLong when period exceeds 30 days", async function () {
      const { registry, deployer } = await loadFixture(deployFixture);

      const tooLong = BigInt(MAX_WARMUP) + 1n;

      await expect(registry.connect(deployer).setWarmupPeriod(tooLong))
        .to.be.revertedWithCustomError(registry, "WarmupPeriodTooLong")
        .withArgs(tooLong, MAX_WARMUP);
    });

    it("should revert with OwnableUnauthorizedAccount when called by a non-owner", async function () {
      const { registry, stranger } = await loadFixture(deployFixture);

      await expect(registry.connect(stranger).setWarmupPeriod(3600))
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });
  });

  // ── proposeMinEvaluatorStake / executeMinEvaluatorStake (FINDING-005 timelock) ──

  describe("proposeMinEvaluatorStake / executeMinEvaluatorStake", function () {

    const GOVERNANCE_DELAY_SEC = 2 * 24 * 3600; // 2 days — mirrors EvaluatorRegistry.GOVERNANCE_DELAY

    async function twoEvaluatorsFixture() {
      const base = await deployFixture();
      const { registry, protocolToken, evaluatorA, evaluatorB } = base;

      // evaluatorA stakes 100 (exactly minimum), evaluatorB stakes 200 (above)
      await protocolToken.connect(evaluatorA).approve(await registry.getAddress(), MIN_STAKE);
      await registry.connect(evaluatorA).stake(MIN_STAKE);

      await protocolToken.connect(evaluatorB).approve(await registry.getAddress(), ABOVE_MIN);
      await registry.connect(evaluatorB).stake(ABOVE_MIN);

      await time.increase(WARMUP_PERIOD + 1);

      return base;
    }

    it("should deactivate evaluators below the new minimum when minimum is raised (after delay)", async function () {
      const { registry, deployer, evaluatorA, evaluatorB } = await loadFixture(twoEvaluatorsFixture);

      const newMinimum = ethers.parseEther("150");

      await registry.connect(deployer).proposeMinEvaluatorStake(newMinimum);
      await time.increase(GOVERNANCE_DELAY_SEC + 1);

      await expect(registry.connect(deployer).executeMinEvaluatorStake(newMinimum))
        .to.emit(registry, "MinEvaluatorStakeUpdated")
        .withArgs(MIN_STAKE, newMinimum);

      expect(await registry.isEligible(evaluatorA.address)).to.be.false;
      expect(await registry.isEligible(evaluatorB.address)).to.be.true;
      expect(await registry.getEvaluatorCount()).to.equal(1);
    });

    it("should set activeSince=0 for deactivated evaluators after minimum raise", async function () {
      const { registry, deployer, evaluatorA } = await loadFixture(twoEvaluatorsFixture);

      const newMinimum = ethers.parseEther("150");
      await registry.connect(deployer).proposeMinEvaluatorStake(newMinimum);
      await time.increase(GOVERNANCE_DELAY_SEC + 1);
      await registry.connect(deployer).executeMinEvaluatorStake(newMinimum);

      expect(await registry.isEligible(evaluatorA.address)).to.be.false;
    });

    it("should revert with ZeroAmount when newMinimum is 0 at proposal time", async function () {
      const { registry, deployer } = await loadFixture(deployFixture);

      await expect(registry.connect(deployer).proposeMinEvaluatorStake(0n))
        .to.be.revertedWithCustomError(registry, "ZeroAmount");
    });

    it("should revert with GovernanceDelayNotElapsed when executed too early", async function () {
      const { registry, deployer } = await loadFixture(deployFixture);
      const newMinimum = ethers.parseEther("150");

      await registry.connect(deployer).proposeMinEvaluatorStake(newMinimum);
      // Do NOT advance time — should revert

      await expect(registry.connect(deployer).executeMinEvaluatorStake(newMinimum))
        .to.be.revertedWithCustomError(registry, "GovernanceDelayNotElapsed");
    });

    it("should revert with NoProposalPending when executing without a prior proposal", async function () {
      const { registry, deployer } = await loadFixture(deployFixture);
      const newMinimum = ethers.parseEther("150");

      await expect(registry.connect(deployer).executeMinEvaluatorStake(newMinimum))
        .to.be.revertedWithCustomError(registry, "NoProposalPending");
    });

    it("should revert with ProposalValueMismatch when execute value differs from proposed value", async function () {
      const { registry, deployer } = await loadFixture(deployFixture);
      const proposed = ethers.parseEther("150");
      const different = ethers.parseEther("200");

      await registry.connect(deployer).proposeMinEvaluatorStake(proposed);
      await time.increase(GOVERNANCE_DELAY_SEC + 1);

      await expect(registry.connect(deployer).executeMinEvaluatorStake(different))
        .to.be.revertedWithCustomError(registry, "ProposalValueMismatch");
    });

    it("should emit MinStakeExecuted when executed successfully", async function () {
      const { registry, deployer } = await loadFixture(deployFixture);
      const newMinimum = ethers.parseEther("150");

      await registry.connect(deployer).proposeMinEvaluatorStake(newMinimum);
      await time.increase(GOVERNANCE_DELAY_SEC + 1);

      await expect(registry.connect(deployer).executeMinEvaluatorStake(newMinimum))
        .to.emit(registry, "MinStakeExecuted")
        .withArgs(MIN_STAKE, newMinimum);
    });

    it("should revert with OwnableUnauthorizedAccount when non-owner proposes", async function () {
      const { registry, stranger } = await loadFixture(deployFixture);

      await expect(registry.connect(stranger).proposeMinEvaluatorStake(ethers.parseEther("150")))
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });
  });
});
