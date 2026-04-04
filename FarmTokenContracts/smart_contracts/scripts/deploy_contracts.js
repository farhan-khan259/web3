const { ethers, upgrades } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    // Deploy AssetNFT
    const AssetNFT = await ethers.getContractFactory("AssetNFT");
    const assetNFT = await AssetNFT.deploy();
    await assetNFT.waitForDeployment();
    const assetNFTAddress = await assetNFT.getAddress();
    console.log("AssetNFT deployed to:", assetNFTAddress);

    // Deploy NAVOracle (Upgradeable Proxy)
    const NAVOracle = await ethers.getContractFactory("NAVOracle");
    const navOracle = await upgrades.deployProxy(NAVOracle, [], { initializer: 'initialize' });
    await navOracle.waitForDeployment();
    const navOracleAddress = await navOracle.getAddress();
    console.log("NAVOracle deployed to:", navOracleAddress);

    // Setup basic NAV update to avoid delta revert
    const updaterRole = await navOracle.UPDATER_ROLE();
    await navOracle.grantRole(updaterRole, deployer.address);
    const initialNav = ethers.parseEther("15050");
    const tx = await navOracle.updateNAV(initialNav, Math.floor(Date.now() / 1000));
    await tx.wait();

    // Deploy LeaseToken (Upgradeable Proxy)
    const treasuryAddress = deployer.address; // Normally a multisig or treasury contract
    const LeaseToken = await ethers.getContractFactory("LeaseToken");
    const leaseToken = await upgrades.deployProxy(LeaseToken, [treasuryAddress, navOracleAddress, assetNFTAddress], { initializer: 'initialize' });
    await leaseToken.waitForDeployment();
    const leaseTokenAddress = await leaseToken.getAddress();
    console.log("LeaseToken deployed to:", leaseTokenAddress);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
