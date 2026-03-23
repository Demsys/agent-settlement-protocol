// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Simulated USDC token for Hardhat tests and Base Sepolia demos.
 * @dev THIS CONTRACT IS FOR TESTING PURPOSES ONLY. DO NOT DEPLOY TO MAINNET.
 *      Intentionally has no access control on mint() so any test account
 *      can freely obtain tokens without a faucet or privileged setup.
 *      Decimals are set to 6 to match the real USDC contract (Circle).
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "USDC") {}

    /**
     * @notice Mints `amount` tokens to `to`. No restrictions — anyone can call this.
     * @dev Deliberately unrestricted for test convenience. Never use in production.
     * @param to    Recipient address.
     * @param amount Amount of tokens to mint, expressed in the token's smallest unit
     *               (i.e. 1 USDC = 1_000_000 because decimals() == 6).
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @notice Returns the number of decimals used to represent token amounts.
     * @dev Overrides the ERC20 default of 18 to match real USDC (6 decimals).
     * @return 6
     */
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
