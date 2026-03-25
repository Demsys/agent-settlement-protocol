import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import type { ReputationBridge, MockERC8004Registry } from "../../typechain-types";

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_ID    = 42n;
const REASON    = ethers.keccak256(ethers.toUtf8Bytes("evaluation-report-v1"));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function deployBridgeFixture() {
  const [owner, jobManagerSigner, providerSigner, evaluatorSigner, stranger] =
    await ethers.getSigners();

  const BridgeFactory = await ethers.getContractFactory("ReputationBridge");
  const bridge = (await BridgeFactory.deploy()) as ReputationBridge;
  await bridge.waitForDeployment();

  const MockRegistryFactory = await ethers.getContractFactory("MockERC8004Registry");
  const mockRegistry = (await MockRegistryFactory.deploy()) as MockERC8004Registry;
  await mockRegistry.waitForDeployment();

  return {
    bridge,
    mockRegistry,
    owner,
    jobManagerSigner,
    providerSigner,
    evaluatorSigner,
    stranger,
  };
}

/** Bridge with jobManager configured but no registry yet. */
async function configuredBridgeFixture() {
  const base = await deployBridgeFixture();
  await base.bridge.setJobManager(base.jobManagerSigner.address);
  return base;
}

/** Bridge fully wired: jobManager + registry configured. */
async function fullyWiredBridgeFixture() {
  const base = await configuredBridgeFixture();
  await base.bridge.setReputationRegistry(await base.mockRegistry.getAddress());
  return base;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReputationBridge", function () {

  // ─── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("jobManager starts as address(0)", async function () {
      const { bridge } = await loadFixture(deployBridgeFixture);
      expect(await bridge.jobManager()).to.equal(ethers.ZeroAddress);
    });

    it("reputationRegistry starts as address(0)", async function () {
      const { bridge } = await loadFixture(deployBridgeFixture);
      expect(await bridge.reputationRegistry()).to.equal(ethers.ZeroAddress);
    });

    it("deployer is the owner", async function () {
      const { bridge, owner } = await loadFixture(deployBridgeFixture);
      expect(await bridge.owner()).to.equal(owner.address);
    });
  });

  // ─── setJobManager ───────────────────────────────────────────────────────────

  describe("setJobManager", function () {
    it("stores the new jobManager address", async function () {
      const { bridge, jobManagerSigner } = await loadFixture(deployBridgeFixture);
      await bridge.setJobManager(jobManagerSigner.address);
      expect(await bridge.jobManager()).to.equal(jobManagerSigner.address);
    });

    it("can overwrite an existing jobManager address", async function () {
      const { bridge, jobManagerSigner, stranger } = await loadFixture(deployBridgeFixture);
      await bridge.setJobManager(jobManagerSigner.address);
      await bridge.setJobManager(stranger.address);
      expect(await bridge.jobManager()).to.equal(stranger.address);
    });

    it("reverts ZeroAddress when address(0) is passed", async function () {
      const { bridge } = await loadFixture(deployBridgeFixture);
      await expect(bridge.setJobManager(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(bridge, "ZeroAddress")
        .withArgs("jobManager");
    });

    it("reverts OwnableUnauthorizedAccount when called by non-owner", async function () {
      const { bridge, stranger, jobManagerSigner } = await loadFixture(deployBridgeFixture);
      await expect(bridge.connect(stranger).setJobManager(jobManagerSigner.address))
        .to.be.revertedWithCustomError(bridge, "OwnableUnauthorizedAccount");
    });
  });

  // ─── setReputationRegistry ───────────────────────────────────────────────────

  describe("setReputationRegistry", function () {
    it("stores the registry address", async function () {
      const { bridge, mockRegistry } = await loadFixture(deployBridgeFixture);
      const addr = await mockRegistry.getAddress();
      await bridge.setReputationRegistry(addr);
      expect(await bridge.reputationRegistry()).to.equal(addr);
    });

    it("accepts address(0) to disable forwarding", async function () {
      const { bridge, mockRegistry } = await loadFixture(deployBridgeFixture);
      await bridge.setReputationRegistry(await mockRegistry.getAddress());
      await bridge.setReputationRegistry(ethers.ZeroAddress);
      expect(await bridge.reputationRegistry()).to.equal(ethers.ZeroAddress);
    });

    it("can overwrite an existing registry address", async function () {
      const { bridge, mockRegistry, stranger } = await loadFixture(deployBridgeFixture);
      await bridge.setReputationRegistry(await mockRegistry.getAddress());
      await bridge.setReputationRegistry(stranger.address);
      expect(await bridge.reputationRegistry()).to.equal(stranger.address);
    });

    it("reverts OwnableUnauthorizedAccount when called by non-owner", async function () {
      const { bridge, mockRegistry, stranger } = await loadFixture(deployBridgeFixture);
      await expect(
        bridge.connect(stranger).setReputationRegistry(await mockRegistry.getAddress())
      ).to.be.revertedWithCustomError(bridge, "OwnableUnauthorizedAccount");
    });
  });

  // ─── Access control on recordJobOutcome ──────────────────────────────────────

  describe("recordJobOutcome — access control", function () {
    it("reverts OnlyJobManager when called by a stranger", async function () {
      const { bridge, stranger, providerSigner, evaluatorSigner } =
        await loadFixture(configuredBridgeFixture);
      await expect(
        bridge
          .connect(stranger)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON)
      )
        .to.be.revertedWithCustomError(bridge, "OnlyJobManager")
        .withArgs(stranger.address);
    });

    it("reverts OnlyJobManager when called by the owner (not the jobManager)", async function () {
      const { bridge, owner, providerSigner, evaluatorSigner } =
        await loadFixture(configuredBridgeFixture);
      await expect(
        bridge
          .connect(owner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON)
      )
        .to.be.revertedWithCustomError(bridge, "OnlyJobManager");
    });

    it("succeeds when called by the configured jobManager", async function () {
      // registry is address(0) → silent success; should not revert
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(configuredBridgeFixture);
      await expect(
        bridge
          .connect(jobManagerSigner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON)
      ).to.not.be.reverted;
    });
  });

  // ─── Registry = address(0): silent success ───────────────────────────────────

  describe("recordJobOutcome — registry is address(0)", function () {
    it("does not revert on completed=true", async function () {
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(configuredBridgeFixture);
      await expect(
        bridge
          .connect(jobManagerSigner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON)
      ).to.not.be.reverted;
    });

    it("does not revert on completed=false", async function () {
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(configuredBridgeFixture);
      await expect(
        bridge
          .connect(jobManagerSigner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, false, REASON)
      ).to.not.be.reverted;
    });

    it("emits no OutcomeRecorded events", async function () {
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(configuredBridgeFixture);
      await expect(
        bridge
          .connect(jobManagerSigner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON)
      ).to.not.emit(bridge, "OutcomeRecorded");
    });

    it("emits no ReputationUpdateFailed events", async function () {
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(configuredBridgeFixture);
      await expect(
        bridge
          .connect(jobManagerSigner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON)
      ).to.not.emit(bridge, "ReputationUpdateFailed");
    });
  });

  // ─── completed = true ─────────────────────────────────────────────────────────

  describe("recordJobOutcome — completed=true", function () {
    it("emits OutcomeRecorded(jobId, provider, positive=true)", async function () {
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(fullyWiredBridgeFixture);
      await expect(
        bridge
          .connect(jobManagerSigner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON)
      )
        .to.emit(bridge, "OutcomeRecorded")
        .withArgs(JOB_ID, providerSigner.address, true);
    });

    it("emits OutcomeRecorded(jobId, evaluator, positive=true)", async function () {
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(fullyWiredBridgeFixture);
      await expect(
        bridge
          .connect(jobManagerSigner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON)
      )
        .to.emit(bridge, "OutcomeRecorded")
        .withArgs(JOB_ID, evaluatorSigner.address, true);
    });

    it("calls registry exactly twice (provider + evaluator)", async function () {
      const { bridge, mockRegistry, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(fullyWiredBridgeFixture);
      await bridge
        .connect(jobManagerSigner)
        .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON);
      expect(await mockRegistry.getCallCount()).to.equal(2n);
    });

    it("first registry call is for provider with positive=true", async function () {
      const { bridge, mockRegistry, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(fullyWiredBridgeFixture);
      await bridge
        .connect(jobManagerSigner)
        .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON);
      const call = await mockRegistry.getCall(0);
      expect(call.agent).to.equal(providerSigner.address);
      expect(call.counterpart).to.equal(evaluatorSigner.address);
      expect(call.positive).to.be.true;
      expect(call.jobId).to.equal(JOB_ID);
    });

    it("second registry call is for evaluator with positive=true", async function () {
      const { bridge, mockRegistry, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(fullyWiredBridgeFixture);
      await bridge
        .connect(jobManagerSigner)
        .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON);
      const call = await mockRegistry.getCall(1);
      expect(call.agent).to.equal(evaluatorSigner.address);
      expect(call.counterpart).to.equal(providerSigner.address);
      expect(call.positive).to.be.true;
    });
  });

  // ─── completed = false (rejected) ────────────────────────────────────────────

  describe("recordJobOutcome — completed=false (rejected)", function () {
    it("emits OutcomeRecorded(jobId, provider, positive=false)", async function () {
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(fullyWiredBridgeFixture);
      await expect(
        bridge
          .connect(jobManagerSigner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, false, REASON)
      )
        .to.emit(bridge, "OutcomeRecorded")
        .withArgs(JOB_ID, providerSigner.address, false);
    });

    it("calls registry exactly once (provider only, no evaluator signal)", async function () {
      const { bridge, mockRegistry, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(fullyWiredBridgeFixture);
      await bridge
        .connect(jobManagerSigner)
        .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, false, REASON);
      expect(await mockRegistry.getCallCount()).to.equal(1n);
    });

    it("the single registry call targets the provider with positive=false", async function () {
      const { bridge, mockRegistry, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(fullyWiredBridgeFixture);
      await bridge
        .connect(jobManagerSigner)
        .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, false, REASON);
      const call = await mockRegistry.getCall(0);
      expect(call.agent).to.equal(providerSigner.address);
      expect(call.positive).to.be.false;
    });

    it("does not emit OutcomeRecorded for the evaluator", async function () {
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(fullyWiredBridgeFixture);
      const tx = await bridge
        .connect(jobManagerSigner)
        .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, false, REASON);
      const receipt = await tx.wait();
      const outcomeEvents = receipt!.logs
        .map((log) => {
          try { return bridge.interface.parseLog(log); } catch { return null; }
        })
        .filter((e) => e?.name === "OutcomeRecorded");
      // Only one OutcomeRecorded — for the provider, not the evaluator
      expect(outcomeEvents).to.have.length(1);
      expect(outcomeEvents[0]!.args[1]).to.equal(providerSigner.address);
    });
  });

  // ─── Reverting registry ──────────────────────────────────────────────────────

  describe("recordJobOutcome — reverting registry", function () {
    async function revertingRegistryFixture() {
      const base = await fullyWiredBridgeFixture();
      await base.mockRegistry.setShouldRevert(true);
      return base;
    }

    it("does NOT revert even when registry reverts (completed=true)", async function () {
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(revertingRegistryFixture);
      await expect(
        bridge
          .connect(jobManagerSigner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON)
      ).to.not.be.reverted;
    });

    it("does NOT revert even when registry reverts (completed=false)", async function () {
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(revertingRegistryFixture);
      await expect(
        bridge
          .connect(jobManagerSigner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, false, REASON)
      ).to.not.be.reverted;
    });

    it("emits ReputationUpdateFailed for provider on completed=true", async function () {
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(revertingRegistryFixture);
      await expect(
        bridge
          .connect(jobManagerSigner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON)
      )
        .to.emit(bridge, "ReputationUpdateFailed")
        .withArgs(JOB_ID, providerSigner.address, anyValue);
    });

    it("emits ReputationUpdateFailed for evaluator on completed=true", async function () {
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(revertingRegistryFixture);
      await expect(
        bridge
          .connect(jobManagerSigner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON)
      )
        .to.emit(bridge, "ReputationUpdateFailed")
        .withArgs(JOB_ID, evaluatorSigner.address, anyValue);
    });

    it("emits ReputationUpdateFailed for provider on completed=false", async function () {
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(revertingRegistryFixture);
      await expect(
        bridge
          .connect(jobManagerSigner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, false, REASON)
      )
        .to.emit(bridge, "ReputationUpdateFailed")
        .withArgs(JOB_ID, providerSigner.address, anyValue);
    });

    it("emits no OutcomeRecorded when registry always reverts", async function () {
      const { bridge, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(revertingRegistryFixture);
      await expect(
        bridge
          .connect(jobManagerSigner)
          .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON)
      ).to.not.emit(bridge, "OutcomeRecorded");
    });

    it("no registry calls are stored when registry reverts", async function () {
      const { bridge, mockRegistry, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(revertingRegistryFixture);
      await bridge
        .connect(jobManagerSigner)
        .recordJobOutcome(JOB_ID, providerSigner.address, evaluatorSigner.address, true, REASON);
      // The mock reverts, so nothing is stored
      expect(await mockRegistry.getCallCount()).to.equal(0n);
    });
  });

  // ─── Multiple jobs accumulate correctly in the registry ──────────────────────

  describe("recordJobOutcome — multiple calls", function () {
    it("accumulates all outcome calls across multiple jobs", async function () {
      const { bridge, mockRegistry, jobManagerSigner, providerSigner, evaluatorSigner } =
        await loadFixture(fullyWiredBridgeFixture);

      // Job 1 completed → 2 calls
      await bridge
        .connect(jobManagerSigner)
        .recordJobOutcome(1n, providerSigner.address, evaluatorSigner.address, true, REASON);
      // Job 2 rejected → 1 call
      await bridge
        .connect(jobManagerSigner)
        .recordJobOutcome(2n, providerSigner.address, evaluatorSigner.address, false, REASON);
      // Job 3 completed → 2 calls

      await bridge
        .connect(jobManagerSigner)
        .recordJobOutcome(3n, providerSigner.address, evaluatorSigner.address, true, REASON);

      expect(await mockRegistry.getCallCount()).to.equal(5n);
    });
  });
});
