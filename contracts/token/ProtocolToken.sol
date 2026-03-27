// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

// ─── OpenZeppelin imports ────────────────────────────────────────────────────
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
// AUDIT-M8: Ownable removed — it was imported but never used (no onlyOwner modifier
// in this contract). Having both Ownable and AccessControl created two parallel admin
// channels that could diverge. Pure AccessControl via DEFAULT_ADMIN_ROLE is sufficient.

/**
 * @title ProtocolToken
 * @notice Native ERC-20 token of the Agent Settlement Protocol.
 *         Used for evaluator staking, protocol fee distribution, and on-chain governance.
 * @dev Inherits ERC20Votes for compatibility with OpenZeppelin Governor (future DAO).
 *      ERC20Permit is required by ERC20Votes for the EIP-712 domain separator.
 *      The fee distribution logic (50% burn, 50% stakers) lives in the contracts
 *      that receive fees — this contract only exposes the standard burn() function
 *      from ERC20Burnable and a MINTER_ROLE-gated mint().
 *
 *      Clock mode: this contract uses block.timestamp (not block numbers) for
 *      ERC20Votes checkpoints, which is safer on L2s where block numbers can
 *      be produced at variable rates by the sequencer.
 *
 * @custom:security Minting is restricted to MINTER_ROLE (granted by the owner after
 *                  initial supply is minted to the deployer). The deployer (Ownable owner)
 *                  can grant/revoke MINTER_ROLE via AccessControl.
 */
contract ProtocolToken is ERC20, ERC20Burnable, ERC20Permit, ERC20Votes, AccessControl {

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice Role identifier for addresses authorized to mint new tokens.
    /// @dev Keccak256 of "MINTER_ROLE". AccessControl standard pattern.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Initial supply minted to the deployer at construction (100 million tokens).
    uint256 public constant INITIAL_SUPPLY = 100_000_000 * 1e18;

    /// @notice Hard cap on total supply (1 billion tokens = 10× initial supply).
    /// @dev AUDIT-M9: without a cap, a compromised MINTER_ROLE key could hyperinflate
    ///      the supply and destroy all token value, manipulate ERC20Votes governance,
    ///      and corrupt the staking economics of EvaluatorRegistry.
    ///      1 billion leaves 10× room for future staking rewards / ecosystem grants
    ///      while hard-bounding catastrophic inflation.
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e18;

    // ─── Errors ───────────────────────────────────────────────────────────────

    /// @notice Thrown when mint() is called by an address without MINTER_ROLE.
    error UnauthorizedMinter(address caller);

    /// @notice Thrown when mint() is called with a zero amount.
    error ZeroMintAmount();

    /// @notice Thrown when mint() would push totalSupply above MAX_SUPPLY.
    error MintExceedsMaxSupply(uint256 attempted, uint256 maximum);

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @notice Deploys the ProtocolToken and mints the full initial supply to the deployer.
     * @dev The deployer receives:
     *      - Ownable ownership (can grant/revoke roles via AccessControl)
     *      - DEFAULT_ADMIN_ROLE (can manage all roles)
     *      - MINTER_ROLE (can mint additional supply)
     *      - The full INITIAL_SUPPLY of tokens
     *
     *      Ownable is initialized with msg.sender as the initial owner.
     *      AccessControl roles are granted explicitly after super constructors.
     */
    constructor()
        ERC20("Verdict", "VRT")
        ERC20Permit("Verdict")
    {
        // Grant admin and minter roles to the deployer.
        // The deployer will later grant MINTER_ROLE to the fee distribution contract
        // and optionally revoke their own MINTER_ROLE for decentralization.
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);

        // Mint the initial supply to the deployer for initial distribution,
        // liquidity seeding, and ecosystem grants.
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    // ─── External functions ───────────────────────────────────────────────────

    /**
     * @notice Mints new tokens to a given address. Restricted to MINTER_ROLE.
     * @dev Only addresses granted MINTER_ROLE by the DEFAULT_ADMIN_ROLE can call this.
     *      After the initial distribution phase, this function should only be callable
     *      by governance-approved contracts (e.g., staking reward distribution).
     *      We use a custom error check rather than the AccessControl modifier
     *      to emit a more informative error with the caller's address.
     * @param to     Recipient of the newly minted tokens.
     * @param amount Number of tokens to mint (in wei, 18 decimals).
     */
    function mint(address to, uint256 amount) external {
        // CHECKS
        if (!hasRole(MINTER_ROLE, msg.sender)) revert UnauthorizedMinter(msg.sender);
        if (amount == 0) revert ZeroMintAmount();
        // AUDIT-M9: hard cap prevents a compromised minter from hyperinflating supply.
        if (totalSupply() + amount > MAX_SUPPLY) revert MintExceedsMaxSupply(totalSupply() + amount, MAX_SUPPLY);

        // EFFECTS + INTERACTIONS (mint has no external call risk — it only updates
        // internal balances and checkpoints; no reentrancy vector here)
        _mint(to, amount);
    }

    // ─── ERC20Votes clock overrides ───────────────────────────────────────────

    /**
     * @notice Returns the current timestamp used as the voting clock.
     * @dev Overrides the default block-number clock from ERC20Votes.
     *      On Base (Optimism L2), block numbers are produced by the sequencer
     *      and may not map 1:1 to elapsed time. Using block.timestamp is more
     *      predictable for governance proposal windows.
     * @return Current block timestamp as uint48.
     */
    function clock() public view override returns (uint48) {
        // Safe cast: block.timestamp fits in uint48 until the year 8.9 million.
        return uint48(block.timestamp);
    }

    /**
     * @notice Returns the EIP-6372 clock mode string for this contract.
     * @dev Required by ERC20Votes when overriding clock(). The Governor contract
     *      reads this to know whether to interpret voting windows in blocks or seconds.
     * @return EIP-6372 clock mode descriptor string.
     */
    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    // ─── Required overrides (diamond inheritance resolution) ──────────────────

    /**
     * @dev Internal hook called on every transfer, mint, and burn.
     *      Required override because both ERC20 and ERC20Votes define _update().
     *      ERC20Votes._update() updates voting power checkpoints — must be called.
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    /**
     * @dev Returns the nonce used for EIP-712 permit signatures.
     *      Required override because both ERC20Permit and Nonces define nonces().
     */
    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
