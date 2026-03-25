import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { ProtocolToken } from "../../typechain-types";

// ─── Constants ────────────────────────────────────────────────────────────────

const INITIAL_SUPPLY  = ethers.parseEther("100000000"); // 100 million
const MINTER_ROLE     = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
const DEFAULT_ADMIN   = ethers.ZeroHash; // bytes32(0)

// ─── Fixture ──────────────────────────────────────────────────────────────────

async function deployTokenFixture() {
  const [deployer, alice, bob, stranger] = await ethers.getSigners();

  const ProtocolTokenFactory = await ethers.getContractFactory("ProtocolToken");
  const token = (await ProtocolTokenFactory.deploy()) as ProtocolToken;
  await token.waitForDeployment();

  return { token, deployer, alice, bob, stranger };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ProtocolToken", function () {

  // ─── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("has the correct name", async function () {
      const { token } = await loadFixture(deployTokenFixture);
      expect(await token.name()).to.equal("Verdict");
    });

    it("has the correct symbol", async function () {
      const { token } = await loadFixture(deployTokenFixture);
      expect(await token.symbol()).to.equal("VRT");
    });

    it("has 18 decimals", async function () {
      const { token } = await loadFixture(deployTokenFixture);
      expect(await token.decimals()).to.equal(18n);
    });

    it("mints INITIAL_SUPPLY to the deployer", async function () {
      const { token, deployer } = await loadFixture(deployTokenFixture);
      expect(await token.balanceOf(deployer.address)).to.equal(INITIAL_SUPPLY);
    });

    it("totalSupply equals INITIAL_SUPPLY after deployment", async function () {
      const { token } = await loadFixture(deployTokenFixture);
      expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY);
    });

    it("deployer has MINTER_ROLE", async function () {
      const { token, deployer } = await loadFixture(deployTokenFixture);
      expect(await token.hasRole(MINTER_ROLE, deployer.address)).to.be.true;
    });

    it("deployer has DEFAULT_ADMIN_ROLE", async function () {
      const { token, deployer } = await loadFixture(deployTokenFixture);
      expect(await token.hasRole(DEFAULT_ADMIN, deployer.address)).to.be.true;
    });

    it("deployer is the Ownable owner", async function () {
      const { token, deployer } = await loadFixture(deployTokenFixture);
      expect(await token.owner()).to.equal(deployer.address);
    });
  });

  // ─── mint() ─────────────────────────────────────────────────────────────────

  describe("mint", function () {
    it("MINTER_ROLE can mint tokens to any address", async function () {
      const { token, alice } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther("1000");
      await token.mint(alice.address, amount);
      expect(await token.balanceOf(alice.address)).to.equal(amount);
    });

    it("increases totalSupply by the minted amount", async function () {
      const { token, alice } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther("500");
      const before = await token.totalSupply();
      await token.mint(alice.address, amount);
      expect(await token.totalSupply()).to.equal(before + amount);
    });

    it("reverts UnauthorizedMinter when called without MINTER_ROLE", async function () {
      const { token, alice, stranger } = await loadFixture(deployTokenFixture);
      await expect(token.connect(stranger).mint(alice.address, ethers.parseEther("1")))
        .to.be.revertedWithCustomError(token, "UnauthorizedMinter")
        .withArgs(stranger.address);
    });

    it("reverts ZeroMintAmount when amount is 0", async function () {
      const { token, alice } = await loadFixture(deployTokenFixture);
      await expect(token.mint(alice.address, 0n))
        .to.be.revertedWithCustomError(token, "ZeroMintAmount");
    });

    it("minting to address(0) reverts (ERC20 restriction)", async function () {
      const { token } = await loadFixture(deployTokenFixture);
      await expect(token.mint(ethers.ZeroAddress, ethers.parseEther("1")))
        .to.be.reverted;
    });

    it("non-minter after role revocation cannot mint", async function () {
      const { token, deployer, alice } = await loadFixture(deployTokenFixture);
      // Revoke minter role from deployer
      await token.revokeRole(MINTER_ROLE, deployer.address);
      await expect(token.mint(alice.address, ethers.parseEther("1")))
        .to.be.revertedWithCustomError(token, "UnauthorizedMinter")
        .withArgs(deployer.address);
    });
  });

  // ─── burn() / burnFrom() ─────────────────────────────────────────────────────

  describe("burn and burnFrom", function () {
    it("holder can burn own tokens", async function () {
      const { token, deployer } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther("1000");
      const before = await token.balanceOf(deployer.address);
      await token.burn(amount);
      expect(await token.balanceOf(deployer.address)).to.equal(before - amount);
    });

    it("burn decreases totalSupply", async function () {
      const { token } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther("100");
      const before = await token.totalSupply();
      await token.burn(amount);
      expect(await token.totalSupply()).to.equal(before - amount);
    });

    it("burnFrom works with allowance", async function () {
      const { token, deployer, alice } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther("200");
      // Transfer some tokens to alice, then allow deployer to burn them
      await token.transfer(alice.address, amount);
      await token.connect(alice).approve(deployer.address, amount);
      await token.burnFrom(alice.address, amount);
      expect(await token.balanceOf(alice.address)).to.equal(0n);
    });

    it("burnFrom reverts without sufficient allowance", async function () {
      const { token, deployer, alice } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther("100");
      await token.transfer(alice.address, amount);
      // No approval — should revert
      await expect(token.burnFrom(alice.address, amount)).to.be.reverted;
    });
  });

  // ─── Role management ─────────────────────────────────────────────────────────

  describe("Role management", function () {
    it("DEFAULT_ADMIN_ROLE can grant MINTER_ROLE to another address", async function () {
      const { token, alice } = await loadFixture(deployTokenFixture);
      await token.grantRole(MINTER_ROLE, alice.address);
      expect(await token.hasRole(MINTER_ROLE, alice.address)).to.be.true;
    });

    it("newly granted minter can mint", async function () {
      const { token, alice, bob } = await loadFixture(deployTokenFixture);
      await token.grantRole(MINTER_ROLE, alice.address);
      await token.connect(alice).mint(bob.address, ethers.parseEther("42"));
      expect(await token.balanceOf(bob.address)).to.equal(ethers.parseEther("42"));
    });

    it("DEFAULT_ADMIN_ROLE can revoke MINTER_ROLE", async function () {
      const { token, alice } = await loadFixture(deployTokenFixture);
      await token.grantRole(MINTER_ROLE, alice.address);
      await token.revokeRole(MINTER_ROLE, alice.address);
      expect(await token.hasRole(MINTER_ROLE, alice.address)).to.be.false;
    });

    it("non-admin cannot grant roles", async function () {
      const { token, stranger, alice } = await loadFixture(deployTokenFixture);
      await expect(token.connect(stranger).grantRole(MINTER_ROLE, alice.address))
        .to.be.reverted;
    });
  });

  // ─── ERC20Votes ──────────────────────────────────────────────────────────────

  describe("ERC20Votes", function () {
    it("clock() returns the current block.timestamp", async function () {
      const { token } = await loadFixture(deployTokenFixture);
      const blockTs = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      const clockTs = await token.clock();
      // Clock and block.timestamp should be very close (within a second)
      expect(clockTs).to.be.closeTo(blockTs, 1n);
    });

    it("CLOCK_MODE() returns 'mode=timestamp'", async function () {
      const { token } = await loadFixture(deployTokenFixture);
      expect(await token.CLOCK_MODE()).to.equal("mode=timestamp");
    });

    it("voting power is 0 before delegation", async function () {
      const { token, deployer } = await loadFixture(deployTokenFixture);
      // Tokens are held but not delegated — votes are 0 until delegate() is called
      expect(await token.getVotes(deployer.address)).to.equal(0n);
    });

    it("voting power equals balance after self-delegation", async function () {
      const { token, deployer } = await loadFixture(deployTokenFixture);
      await token.delegate(deployer.address);
      expect(await token.getVotes(deployer.address)).to.equal(INITIAL_SUPPLY);
    });

    it("delegating to another address transfers voting power", async function () {
      const { token, deployer, alice } = await loadFixture(deployTokenFixture);
      await token.delegate(alice.address);
      expect(await token.getVotes(alice.address)).to.equal(INITIAL_SUPPLY);
      expect(await token.getVotes(deployer.address)).to.equal(0n);
    });

    it("voting power checkpoint is created after transfer", async function () {
      const { token, deployer, alice } = await loadFixture(deployTokenFixture);
      await token.delegate(deployer.address);
      const amount = ethers.parseEther("1000");

      await token.transfer(alice.address, amount);
      // Deployer lost 1000 votes
      expect(await token.getVotes(deployer.address)).to.equal(INITIAL_SUPPLY - amount);
    });
  });

  // ─── ERC20Permit (nonces) ────────────────────────────────────────────────────

  describe("ERC20Permit", function () {
    it("nonce starts at 0 for a fresh address", async function () {
      const { token, alice } = await loadFixture(deployTokenFixture);
      expect(await token.nonces(alice.address)).to.equal(0n);
    });

    it("DOMAIN_SEPARATOR is set (non-zero)", async function () {
      const { token } = await loadFixture(deployTokenFixture);
      const separator = await token.DOMAIN_SEPARATOR();
      expect(separator).to.not.equal(ethers.ZeroHash);
    });
  });

  // ─── Standard ERC20 transfers ────────────────────────────────────────────────

  describe("ERC20 transfers", function () {
    it("transfer moves tokens between accounts", async function () {
      const { token, deployer, alice } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther("500");
      await token.transfer(alice.address, amount);
      expect(await token.balanceOf(alice.address)).to.equal(amount);
      expect(await token.balanceOf(deployer.address)).to.equal(INITIAL_SUPPLY - amount);
    });

    it("transfer emits a Transfer event", async function () {
      const { token, deployer, alice } = await loadFixture(deployTokenFixture);
      const amount = ethers.parseEther("100");
      await expect(token.transfer(alice.address, amount))
        .to.emit(token, "Transfer")
        .withArgs(deployer.address, alice.address, amount);
    });

    it("transfer reverts when sender has insufficient balance", async function () {
      const { token, alice, bob } = await loadFixture(deployTokenFixture);
      // alice has no tokens
      await expect(token.connect(alice).transfer(bob.address, 1n)).to.be.reverted;
    });
  });
});
