// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PortfolioYieldToken
 * @dev Standard ERC-20 token representing yield within the private vault.
 */
contract PortfolioYieldToken is ERC20, Ownable {
    constructor(address initialOwner) ERC20("Gorilla in Pink Mask", "GPM") Ownable(initialOwner) {
        // Mint exactly 50,000,000 tokens to the specified Owner/Multisig upon deployment.
        _mint(initialOwner, 50_000_000 * 10 ** decimals());
    }
}
