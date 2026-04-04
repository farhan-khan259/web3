// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PortfolioYieldToken.sol";
import "../src/PrivateNFTVault.sol";

contract DeployTestnet is Script {
    function run() external {
        // Read the deployer private key from .env file or fallback to the provided private key
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(
                0x21ef7727cbed74022a5f88482734b5edd024652528e9797b9c23f30761447449
            )
        );

        vm.startBroadcast(deployerPrivateKey);

        address deployer = vm.addr(deployerPrivateKey);
        console.log("Deploying contracts with the account:", deployer);

        // 2. Point to the Existing NFT Collection
        address nftAddress = 0x0c06d6A17eb208A9BC7Bd698Eb6f22379209e3A4;

        // 3. Deploy the Reward Token (PYT) - Initialized to deployer for automated setup
        PortfolioYieldToken pyt = new PortfolioYieldToken(deployer);
        console.log("PortfolioYieldToken deployed at:", address(pyt));

        // 4. Deploy the Private NFT Vault - Initialized to deployer for automated setup
        PrivateNFTVault vault = new PrivateNFTVault(nftAddress, address(pyt), deployer);
        console.log("PrivateNFTVault deployed at:", address(vault));

        // 5. Fund the vault with 1,000,000 PYT rewards
        uint256 vaultFunding = 1_000_000 * 10 ** 18;
        pyt.transfer(address(vault), vaultFunding);
        console.log("Vault funded with 1,000,000 tokens.");

        // 6. Transfer Ownership and all remaining tokens to the Final Owner
        address finalOwner = 0xc82A59594560A3010F336ebe2e9CC4794DCD46cf;
        
        // Transfer all remaining tokens (49,000,000) to final owner
        uint256 remainingBalance = pyt.balanceOf(deployer);
        pyt.transfer(finalOwner, remainingBalance);
        console.log("Transferred 49,000,000 tokens to final owner:", finalOwner);

        // Transfer ownership of both contracts
        pyt.transferOwnership(finalOwner);
        vault.transferOwnership(finalOwner);
        console.log("Ownership of both contracts transferred to:", finalOwner);

        vm.stopBroadcast();

        // Write the deployment outputs to a file for easy access
        string memory output = string.concat(
            "TESTNET_NFT_ADDRESS=",
            vm.toString(nftAddress),
            "\n",
            "TESTNET_PYT_ADDRESS=",
            vm.toString(address(pyt)),
            "\n",
            "TESTNET_VAULT_ADDRESS=",
            vm.toString(address(vault)),
            "\n"
        );
        vm.writeFile("testnet_deploy_addresses.txt", output);

        console.log("Addresses saved to testnet_deploy_addresses.txt");
    }
}
