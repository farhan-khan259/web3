const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const normalOracle = process.env.NORMAL_ORACLE_ADDRESS;
  const rareOracle = process.env.RARE_ORACLE_ADDRESS;
  const chainlinkFeed = process.env.CHAINLINK_ETH_USD_FEED;

  if (!normalOracle || !rareOracle || !chainlinkFeed) {
    throw new Error("NORMAL_ORACLE_ADDRESS, RARE_ORACLE_ADDRESS, and CHAINLINK_ETH_USD_FEED are required");
  }

  const OracleRegistry = await hre.ethers.getContractFactory("OracleRegistry");
  const upgradedOracle = await OracleRegistry.deploy(
    deployer.address,
    normalOracle,
    rareOracle,
    chainlinkFeed
  );
  await upgradedOracle.waitForDeployment();

  console.log("OracleRegistry Milestone 2 deployed:", await upgradedOracle.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
