// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

// ─── OpenZeppelin imports ────────────────────────────────────────────────────
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Treasury
 * @notice Receives protocol fee revenue (USDC) and queues buyback-and-burn
 *         operations for VRT (the native protocol token).
 *
 * @dev Design principles:
 *      - Passive receipt: no callback or fallback needed. AgentJobManager sends
 *        USDC directly via safeTransfer during complete() and reject(). This
 *        contract simply holds the balance until governance acts.
 *      - Governance-controlled disbursement: only the owner (initially the
 *        protocol multisig, later the DAO) may initiate buybacks or withdraw funds.
 *      - Testnet stub: buybackAndBurn() emits BuybackQueued but performs no swap.
 *        Mainnet will integrate Aerodrome Finance (the leading DEX on Base) to
 *        execute a USDC → VRT swap and call VRT.burn() on the received tokens.
 *        This separation keeps the testnet contract simple and prevents any
 *        accidental interaction with production liquidity pools during development.
 *
 *      Token flow (mainnet — not yet implemented):
 *        Treasury (USDC) → Aerodrome Router → VRT → burn()
 *
 *      Security guarantees:
 *      - All transfers use SafeERC20 (handles non-standard ERC-20s like USDT).
 *      - withdraw() is the emergency escape hatch for governance to recover funds
 *        if needed (e.g., wrong token sent, contract migration).
 *      - No reentrancy guard needed: this contract initiates outbound transfers
 *        only in onlyOwner functions. There is no public entry point that receives
 *        value and calls back into an untrusted contract.
 *
 * @custom:security This contract holds protocol fee revenue. Only the owner
 *                  (multisig or DAO) may move funds out. Do not grant ownership
 *                  to an EOA in production.
 */
contract Treasury is Ownable {
    using SafeERC20 for IERC20;

    // ─── Events ───────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when a buyback is queued by governance.
     * @dev On testnet: this is the only action taken by buybackAndBurn().
     *      On mainnet: emitted just before the Aerodrome swap executes.
     * @param token  ERC-20 token to spend in the buyback (typically USDC).
     * @param amount Amount of `token` approved for the swap.
     */
    event BuybackQueued(address indexed token, uint256 amount);

    /**
     * @notice Reserved event signature for the mainnet buyback execution.
     * @dev Declared here so that off-chain indexers and the TypeScript SDK can
     *      register listeners before mainnet integration is live. Not emitted
     *      until the Aerodrome integration is implemented and audited.
     * @param token      ERC-20 token spent in the buyback (USDC).
     * @param tokenSpent Actual amount of `token` consumed by the swap.
     * @param vrtBurned  Amount of VRT received from the swap and subsequently burned.
     */
    event BuybackExecuted(
        address indexed token,
        uint256 tokenSpent,
        uint256 vrtBurned
    );

    /**
     * @notice Emitted when the owner withdraws tokens from the treasury.
     * @param token     ERC-20 token address.
     * @param to        Recipient of the withdrawn tokens.
     * @param amount    Amount transferred.
     */
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    // ─── Deployment type flag ─────────────────────────────────────────────────

    /**
     * @notice True when this is a testnet stub deployment that does not execute real swaps.
     * @dev Set to `true` at construction and immutable thereafter. Governance scripts and
     *      monitoring tools must check this flag before sending funds to the Treasury or
     *      relying on buybackAndBurn() to produce real token burns.
     *      On mainnet, this contract must be replaced by a fully-implemented version with
     *      IS_STUB hardcoded to `false`. Deploying this stub to mainnet and passing funds
     *      to it would result in USDC accumulating with no on-chain burn — a silent loss
     *      of protocol value.
     */
    bool public immutable IS_STUB = true;

    // ─── Constructor ──────────────────────────────────────────────────────────

    /**
     * @notice Deploys the Treasury and assigns initial ownership.
     * @dev Ownership is transferred to the deployer (msg.sender via Ownable).
     *      In production, immediately transfer ownership to the protocol multisig
     *      or DAO timelock after deployment.
     */
    constructor() Ownable(msg.sender) {}

    // ─── Governance functions ─────────────────────────────────────────────────

    /**
     * @notice Queues a buyback-and-burn of VRT using the specified token balance.
     * @dev TESTNET STUB: on testnet, this function only emits BuybackQueued and
     *      returns immediately. No swap, no burn, no external calls.
     *
     *      MAINNET (not yet implemented): this function will:
     *        1. Approve `amount` of `token` to the Aerodrome Router on Base.
     *        2. Call the Aerodrome Router to swap `token` (USDC) for VRT.
     *        3. Call VRT.burn() on the full received amount.
     *        4. Emit BuybackExecuted(token, tokenSpent, vrtBurned).
     *      The Aerodrome integration requires an audit before activation.
     *      A governance proposal will upgrade this contract when ready.
     *
     *      Why Aerodrome: Aerodrome is the dominant DEX on Base (Coinbase L2),
     *      offering the deepest USDC liquidity and native veVELO incentive
     *      alignment. It is the natural choice for on-chain buybacks on Base.
     *
     * @param token  Address of the ERC-20 token to spend (typically USDC).
     *               Must be held by this contract in at least `amount`.
     * @param amount Amount of `token` to allocate to the buyback.
     *               Must be > 0 and <= this contract's balance of `token`.
     */
    function buybackAndBurn(address token, uint256 amount) external onlyOwner {
        // CHECKS
        // Validate inputs before any state change or external interaction.
        // We prefer an explicit revert over letting safeTransfer fail silently
        // with a misleading error message.
        require(token != address(0), "Treasury: zero token address");
        require(amount > 0, "Treasury: zero amount");

        // TESTNET STUB — emit the intent, do nothing else.
        // Remove this block and implement the Aerodrome swap when deploying to mainnet.
        emit BuybackQueued(token, amount);

        // MAINNET: replace this function body with Aerodrome USDC→VRT swap + ProtocolToken.burn()
        // This stub must never be deployed to mainnet without implementing the swap logic.
        // IS_STUB = true signals that this is a testnet deployment.

        // ── MAINNET IMPLEMENTATION (not active) ──────────────────────────────
        // address aerodromeRouter = 0x...; // Base mainnet Aerodrome Router
        // IERC20(token).safeApprove(aerodromeRouter, amount);
        // uint256 vrtReceived = IAerodromeRouter(aerodromeRouter).swapExactTokensForTokens(
        //     amount, minAmountOut, path, address(this), block.timestamp
        // );
        // IProtocolToken(vrtAddress).burn(vrtReceived);
        // emit BuybackExecuted(token, amount, vrtReceived);
        // ─────────────────────────────────────────────────────────────────────
    }

    /**
     * @notice Withdraws tokens from the treasury to an arbitrary address.
     * @dev Emergency safety hatch for governance. Allows recovery of:
     *      - Tokens sent to this contract by mistake.
     *      - Protocol fee revenue that needs to be redirected (e.g., pre-buyback
     *        manual distribution to stakers during the testnet phase).
     *      - Contract migration: move funds to a new Treasury implementation.
     *
     *      Security note: this function deliberately has no timelock because it is
     *      already restricted to onlyOwner. The owner (multisig or DAO) is the
     *      ultimate security boundary. Adding a separate timelock here would
     *      duplicate the DAO's own execution delay and add complexity without
     *      meaningful security gain. If the owner is compromised, a timelock on
     *      withdraw() would not help — the attacker could simply bypass it via other
     *      owner-gated functions.
     *
     * @param token   ERC-20 token address to withdraw. Must not be address(0).
     * @param amount  Amount to withdraw. Must be > 0 and <= this contract's balance.
     * @param to      Recipient address. Must not be address(0).
     */
    function withdraw(
        address token,
        uint256 amount,
        address to
    ) external onlyOwner {
        // CHECKS
        require(token  != address(0), "Treasury: zero token address");
        require(to     != address(0), "Treasury: zero recipient");
        require(amount >  0,          "Treasury: zero amount");

        // INTERACTIONS — SafeERC20 handles non-standard return values (USDT etc.)
        // No state to update (CEI: no Effects step needed here — this contract
        // has no internal accounting; the ERC-20 balance IS the state).
        IERC20(token).safeTransfer(to, amount);

        emit Withdrawn(token, to, amount);
    }
}
