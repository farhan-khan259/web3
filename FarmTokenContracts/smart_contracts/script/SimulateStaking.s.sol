// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PortfolioYieldToken.sol";
import "../src/PrivateNFTVault.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

// A Mock ERC721 is deployed here so the Vault can be initialized during a local fork test.
contract MockPolygonNFT is ERC721 {
    constructor() ERC721("PolygonFarmNFT", "PFNFT") {}

    function mintBatch(address to, uint256 count) external {
        for (uint256 i = 1; i <= count; i++) {
            _mint(to, i);
        }
    }
}

contract SimulateStaking is Script {
    function run() external {
        // Read the deployer private key
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(
                0x21ef7727cbed74022a5f88482734b5edd024652528e9797b9c23f30761447449
            )
        );
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy the Mock NFT
        MockPolygonNFT nft = new MockPolygonNFT();
        console.log("MockPolygonNFT deployed at:", address(nft));

        // 2. Deploy Reward Token (GPM)
        PortfolioYieldToken gpm = new PortfolioYieldToken(deployer);
        console.log("Gorilla in Pink Mask (GPM) Token deployed at:", address(gpm));

        // 3. Deploy the Private NFT Vault (Soft Staking)
        PrivateNFTVault vault = new PrivateNFTVault(address(nft), address(gpm), deployer);
        console.log("PrivateNFTVault deployed at:", address(vault));

        // 4. Fund the vault with 1 Million GPM tokens
        uint256 vaultFunding = 1_000_000 * 10 ** 18;
        gpm.transfer(address(vault), vaultFunding);
        console.log("Vault funded with 1,000,000 GPM tokens.");

        // 5. Mint 200 NFTs directly to the deployer
        uint16 BATCH_AMOUNT = 200;
        nft.mintBatch(deployer, BATCH_AMOUNT);
        console.log("Minted 200 Mock NFTs to address:", deployer);

        // Create an array of IDs from 1 to 200
        uint256[] memory tokenIds = new uint256[](BATCH_AMOUNT);
        for(uint256 i = 0; i < BATCH_AMOUNT; i++) {
            tokenIds[i] = i + 1; // Token IDs 1 through 200
        }

        // 6. Stake 200 NFTs
        uint256 gasBeforeStake = gasleft();
        vault.batchStake(tokenIds);
        uint256 gasAfterStake = gasleft();
        console.log("Successfully Soft Staked (Registered) 200 NFTs in the Vault.");
        console.log("-> STAKING GAS USED: ", gasBeforeStake - gasAfterStake);
        
        vm.stopBroadcast();
        
        // Use vm.warp to fast-forward the EVM's internal clock by 5 minutes.
        // This ensures the local simulation correctly calculates yield before sending the live transactions.
        console.log("Fast-forwarding block timestamp by 5 minutes to generate simulated yield...");
        vm.warp(block.timestamp + 300);
        
        vm.startBroadcast(deployerPrivateKey);

        // Claim Rewards after waiting
        // Note: When broadcasting to a live testnet, `vm.warp` is ignored by actual miners.
        // If transactions execute in the exact same block, yield is 0, which would normally revert.
        // We check > 0 to prevent the deployment script from crashing.
        uint256 pendingYield = vault.getPendingRewards();
        if (pendingYield > 0) {
            uint256 gasBeforeClaim = gasleft();
            vault.claimRewards();
            uint256 gasAfterClaim = gasleft();
            console.log("Successfully Claimed Rewards! Yield amount:", pendingYield);
            console.log("-> CLAIMING GAS USED: ", gasBeforeClaim - gasAfterClaim);
        } else {
            console.log("-> SKIPPED CLAIM: Testnet miners executed transactions too fast (0 elapsed block time).");
        }

        // 7. Unstake 200 NFTs
        uint256 gasBeforeUnstake = gasleft();
        vault.batchUnstake(tokenIds);
        uint256 gasAfterUnstake = gasleft();
        console.log("Successfully Unstaked (De-registered) 200 NFTs from the Vault.");
        console.log("-> UNSTAKING GAS USED: ", gasBeforeUnstake - gasAfterUnstake);

        vm.stopBroadcast();
    }
}
