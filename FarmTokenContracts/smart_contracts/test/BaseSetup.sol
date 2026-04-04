// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PortfolioYieldToken.sol";
import "../src/PrivateNFTVault.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

// Mock NFT collection for testing batch operations
contract MockERC721 is ERC721 {
    constructor() ERC721("Mock Asset", "MOCK") {}

    function mintBatch(address to, uint256 count) external {
        for (uint256 i = 1; i <= count; i++) {
            _mint(to, i);
        }
    }
}

abstract contract BaseSetup is Test {
    PortfolioYieldToken pyt;
    PrivateNFTVault vault;
    MockERC721 mockNFT;

    address owner = address(this); // The test contract is the owner/multisig
    address unauthorizedUser = address(0xDEAD);

    function setUp() public virtual {
        mockNFT = new MockERC721();
        pyt = new PortfolioYieldToken();

        vault = new PrivateNFTVault(address(mockNFT), address(pyt));

        // Transfer some PYT to vault so it can pay out rewards
        pyt.transfer(address(vault), 1_000_000 * 10 ** 18);
    }
}
