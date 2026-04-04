const { ethers, upgrades } = require("hardhat");

const PROXY_ADDRESS = process.env.ORACLE_PROXY_ADDRESS;

async function main() {
    console.log("Upgrading NAVOracle...");

    if (!PROXY_ADDRESS) {
        throw new Error("Missing ORACLE_PROXY_ADDRESS in .env");
    }

    // Assuming NAVOracleV2 is slightly updated logic
    const NAVOracleV2 = await ethers.getContractFactory("NAVOracle");
    const upgraded = await upgrades.upgradeProxy(PROXY_ADDRESS, NAVOracleV2);
    await upgraded.waitForDeployment();
    console.log("NAVOracle upgraded to proxy at:", await upgraded.getAddress());
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
