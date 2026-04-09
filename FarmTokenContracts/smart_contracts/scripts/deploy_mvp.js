const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function verifyIfConfigured(address, constructorArguments) {
  if (!process.env.ETHERSCAN_API_KEY || hre.network.name !== "sepolia") {
    return;
  }
  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments,
    });
  } catch (error) {
    const message = String(error?.message || "");
    if (!message.toLowerCase().includes("already verified")) {
      throw error;
    }
  }
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const reserveWallet = process.env.RESERVE_WALLET || deployer.address;
  const priceFeed = process.env.CHAINLINK_ETH_USD_FEED;

  console.log("Deploying with account:", deployer.address);
  console.log("Using reserve wallet:", reserveWallet);
  if (!priceFeed) {
    throw new Error("Missing CHAINLINK_ETH_USD_FEED for OracleRegistry deployment");
  }

  const RegularOracle = await hre.ethers.getContractFactory("RegularOracle");
  const normalOracle = await RegularOracle.deploy(deployer.address);
  await normalOracle.waitForDeployment();

  const RareOracle = await hre.ethers.getContractFactory("RareOracle");
  const rareOracle = await RareOracle.deploy(deployer.address);
  await rareOracle.waitForDeployment();

  const OracleRegistry = await hre.ethers.getContractFactory("OracleRegistry");
  const oracle = await OracleRegistry.deploy(
    deployer.address,
    await normalOracle.getAddress(),
    await rareOracle.getAddress(),
    priceFeed
  );
  await oracle.waitForDeployment();

  await (await normalOracle.setRegistry(await oracle.getAddress())).wait();
  await (await rareOracle.setRegistry(await oracle.getAddress())).wait();

  const Vault = await hre.ethers.getContractFactory("Vault");
  const vault = await Vault.deploy(9300, deployer.address);
  await vault.waitForDeployment();

  const DebtToken = await hre.ethers.getContractFactory("DebtToken");
  const debtToken = await DebtToken.deploy(deployer.address);
  await debtToken.waitForDeployment();

  const LoanEngine = await hre.ethers.getContractFactory("LoanEngine");
  const loanEngine = await LoanEngine.deploy(
    await oracle.getAddress(),
    await vault.getAddress(),
    await debtToken.getAddress(),
    deployer.address
  );
  await loanEngine.waitForDeployment();

  const debtMinterRole = await debtToken.MINTER_ROLE();
  await (await debtToken.grantRole(debtMinterRole, await loanEngine.getAddress())).wait();

  const RevenueRouter = await hre.ethers.getContractFactory("RevenueRouter");
  const revenueRouter = await RevenueRouter.deploy(
    await loanEngine.getAddress(),
    deployer.address,
    reserveWallet
  );
  await revenueRouter.waitForDeployment();

  await (await vault.setLoanEngine(await loanEngine.getAddress())).wait();
  await (await vault.setOracle(await oracle.getAddress())).wait();
  await (await loanEngine.setRevenueRouter(await revenueRouter.getAddress())).wait();

  await verifyIfConfigured(await normalOracle.getAddress(), [deployer.address]);
  await verifyIfConfigured(await rareOracle.getAddress(), [deployer.address]);
  await verifyIfConfigured(await oracle.getAddress(), [
    deployer.address,
    await normalOracle.getAddress(),
    await rareOracle.getAddress(),
    priceFeed,
  ]);
  await verifyIfConfigured(await vault.getAddress(), [9300, deployer.address]);
  await verifyIfConfigured(await debtToken.getAddress(), [deployer.address]);
  await verifyIfConfigured(await loanEngine.getAddress(), [
    await oracle.getAddress(),
    await vault.getAddress(),
    await debtToken.getAddress(),
    deployer.address,
  ]);
  await verifyIfConfigured(await revenueRouter.getAddress(), [
    await loanEngine.getAddress(),
    deployer.address,
    reserveWallet,
  ]);

  const output = {
    network: hre.network.name,
    deployer: deployer.address,
    reserveWallet,
    normalOracle: await normalOracle.getAddress(),
    rareOracle: await rareOracle.getAddress(),
    debtToken: await debtToken.getAddress(),
    oracleRegistry: await oracle.getAddress(),
    vault: await vault.getAddress(),
    loanEngine: await loanEngine.getAddress(),
    revenueRouter: await revenueRouter.getAddress(),
  };

  const outPath = path.join(__dirname, "..", "deployed_mvp.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  const frontendEnvPath = path.join(__dirname, "..", "..", "frontend", ".env.testnet.local");
  const frontendEnv = [
    `NEXT_PUBLIC_RPC_URL=${process.env.ALCHEMY_URL || ""}`,
    `NEXT_PUBLIC_ORACLE_ADDRESS=${output.oracleRegistry}`,
    `NEXT_PUBLIC_VAULT_ADDRESS=${output.vault}`,
    `NEXT_PUBLIC_LOAN_ENGINE_ADDRESS=${output.loanEngine}`,
    `NEXT_PUBLIC_REVENUE_ROUTER_ADDRESS=${output.revenueRouter}`,
    `NEXT_PUBLIC_DEBT_TOKEN_ADDRESS=${output.debtToken}`,
  ].join("\n");
  fs.writeFileSync(frontendEnvPath, `${frontendEnv}\n`);

  console.log("MVP contracts deployed:");
  console.table(output);
  console.log("Saved deployment file to:", outPath);
  console.log("Saved frontend testnet env to:", frontendEnvPath);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});