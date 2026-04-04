// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PortfolioYieldToken.sol";
import "../src/PrivateNFTVault.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockAmoyNFT is ERC721 {
    constructor() ERC721("AmoyFarmNFT", "AFNFT") {}

    function mintBatch(address to, uint256 count) external {
        for (uint256 i = 1; i <= count; i++) {
            _mint(to, i);
        }
    }
}

contract DeployAmoy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(
                0xb707c5fc7b8a88faaf04e01eef1159eac006a544aecfedd81a670f83aa951ade
            )
        );

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy the Mock NFT for Amoy
        MockAmoyNFT nft = new MockAmoyNFT();
        console.log("MockAmoyNFT deployed at:", address(nft));

        // 2. Deploy the Reward Token (Yield Token)
        PortfolioYieldToken pyt = new PortfolioYieldToken();
        console.log("PortfolioYieldToken deployed at:", address(pyt));

        // 3. Deploy the Private NFT Vault targeting the NFT & the Reward Token
        PrivateNFTVault vault = new PrivateNFTVault(address(nft), address(pyt));
        console.log("PrivateNFTVault deployed at:", address(vault));

        // 3.5 Mint some Mock NFTs to the Deployer
        address deployer = vm.addr(deployerPrivateKey);
        nft.mintBatch(deployer, 5);
        console.log("Minted 5 Mock NFTs to deployer:", deployer);

        // 4. Fund the vault with PYT rewards
        uint256 vaultFunding = 1_000_000 * 10 ** 18;
        pyt.transfer(address(vault), vaultFunding);
        console.log(
            "Vault funded with PYT:",
            vaultFunding / 1 ether,
            "native tokens."
        );

        vm.stopBroadcast();

        // Update frontend .env for Amoy
        string memory envContent = string.concat(
            "VITE_VAULT_ADDRESS=",
            vm.toString(address(vault)),
            "\n",
            "VITE_PYT_ADDRESS=",
            vm.toString(address(pyt)),
            "\n",
            "VITE_CHAIN_ID=80002\n",
            "VITE_NETWORK_NAME=Polygon Amoy\n",
            "VITE_RPC_URL=https://rpc-amoy.polygon.technology\n"
        );
        vm.writeFile("../react-dashboard/.env", envContent);
        console.log("Frontend .env updated for Polygon Amoy");
    }
}
