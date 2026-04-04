// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PortfolioYieldToken.sol";
import "../src/PrivateNFTVault.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

// A Mock ERC721 is deployed here so the Vault can be initialized during a local fork test.
// You can replace this with your actual NFT's Polygon address later.
contract MockPolygonNFT is ERC721 {
    constructor() ERC721("PolygonFarmNFT", "PFNFT") {}

    function mintBatch(address to, uint256 count) external {
        for (uint256 i = 1; i <= count; i++) {
            _mint(to, i);
        }
    }
}

contract DeployVault is Script {
    function run() external {
        // Read the deployer private key from .env file or fallback to the provided private key
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(
                0x21ef7727cbed74022a5f88482734b5edd024652528e9797b9c23f30761447449
            )
        );

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy the Mock NFT for the Polygon Local Fork
        MockPolygonNFT nft = new MockPolygonNFT();
        console.log("MockPolygonNFT deployed at:", address(nft));

        // 2. Deploy the Reward Token (PYT) - Initialized to deployer for automated setup
        address deployer = vm.addr(deployerPrivateKey);
        PortfolioYieldToken pyt = new PortfolioYieldToken(deployer);
        console.log("PortfolioYieldToken deployed at:", address(pyt));

        // 3. Deploy the Private NFT Vault - Initialized to deployer for automated setup
        PrivateNFTVault vault = new PrivateNFTVault(address(nft), address(pyt), deployer);
        console.log("PrivateNFTVault deployed at:", address(vault));

        // 3.5 Mint some Mock NFTs to the specific address so they can test staking
        address testAddress = 0x6a084490Dd08EDe8aCE0c8f3B2585eff1235198b;
        nft.mintBatch(testAddress, 5);
        console.log("Minted 5 Mock NFTs to address:", testAddress);

        // 4. Fund the vault with PYT rewards
        uint256 vaultFunding = 1_000_000 * 10 ** 18;
        pyt.transfer(address(vault), vaultFunding);
        console.log("Vault funded with 1,000,000 tokens.");

        // 5. Transfer Ownership and remaining tokens to the specified address
        address finalOwner = 0xc82A59594560A3010F336ebe2e9CC4794DCD46cf;
        
        // Transfer all remaining tokens (49,000,000) to final owner
        uint256 balance = pyt.balanceOf(deployer);
        pyt.transfer(finalOwner, balance);
        console.log("Transferred 49,000,000 tokens to final owner:", finalOwner);

        // Transfer ownership of both contracts
        pyt.transferOwnership(finalOwner);
        vault.transferOwnership(finalOwner);
        console.log("Ownership of both contracts transferred to:", finalOwner);

        vm.stopBroadcast();

        string memory envContent = string.concat(
            "VITE_VAULT_ADDRESS=",
            vm.toString(address(vault)),
            "\n",
            "VITE_PYT_ADDRESS=",
            vm.toString(address(pyt)),
            "\n",
            "VITE_CHAIN_ID=31337\n",
            "VITE_NETWORK_NAME=Anvil Localhost\n",
            "VITE_RPC_URL=http://localhost:8545\n"
        );
        vm.writeFile("../react-dashboard/.env", envContent);
    }
}
