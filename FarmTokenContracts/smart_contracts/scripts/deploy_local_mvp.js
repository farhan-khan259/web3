const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Local deployer:", deployer.address);

  const RegularOracle = await hre.ethers.getContractFactory("RegularOracle");
  const normalOracle = await RegularOracle.deploy(deployer.address);
  await normalOracle.waitForDeployment();

  const RareOracle = await hre.ethers.getContractFactory("RareOracle");
  const rareOracle = await RareOracle.deploy(deployer.address);
  await rareOracle.waitForDeployment();

  const MockV3Aggregator = await hre.ethers.getContractFactory("MockV3Aggregator");
  const ethUsdFeed = await MockV3Aggregator.deploy(8, 3500n * 10n ** 8n);
  await ethUsdFeed.waitForDeployment();

  const OracleRegistry = await hre.ethers.getContractFactory("OracleRegistry");
  const oracle = await OracleRegistry.deploy(
    deployer.address,
    await normalOracle.getAddress(),
    await rareOracle.getAddress(),
    await ethUsdFeed.getAddress()
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
  const loan = await LoanEngine.deploy(
    await oracle.getAddress(),
    await vault.getAddress(),
    await debtToken.getAddress(),
    deployer.address
  );
  await loan.waitForDeployment();

  const debtMinterRole = await debtToken.MINTER_ROLE();
  await (await debtToken.grantRole(debtMinterRole, await loan.getAddress())).wait();

  const RevenueRouter = await hre.ethers.getContractFactory("RevenueRouter");
  const router = await RevenueRouter.deploy(await loan.getAddress(), deployer.address, deployer.address);
  await router.waitForDeployment();

  await (await vault.setLoanEngine(await loan.getAddress())).wait();
  await (await vault.setOracle(await oracle.getAddress())).wait();
  await (await loan.setRevenueRouter(await router.getAddress())).wait();

  await (
    await oracle.setOracleData(
      1,
      hre.ethers.parseEther("10"),
      20,
      true,
      true,
      0
    )
  ).wait();
  await (await oracle.setScores(1, 9000, 8500, 8000)).wait();
  await (await oracle.setAppraisalCeiling(1, hre.ethers.parseEther("15"))).wait();

  await (await vault.lockMintRight(1, 0, deployer.address)).wait();

  await (await router.setBeneficiary(1, deployer.address)).wait();

  await deployer.sendTransaction({
    to: await loan.getAddress(),
    value: hre.ethers.parseEther("100")
  });

  const deployment = {
    network: hre.network.name,
    rpc: "http://127.0.0.1:8545",
    deployer: deployer.address,
    normalOracle: await normalOracle.getAddress(),
    rareOracle: await rareOracle.getAddress(),
    ethUsdFeed: await ethUsdFeed.getAddress(),
    oracle: await oracle.getAddress(),
    vault: await vault.getAddress(),
    loan: await loan.getAddress(),
    debtToken: await debtToken.getAddress(),
    router: await router.getAddress(),
    seeded: {
      tokenId: 1,
      tokenValueEth: "10",
      volatility: 20,
      trademarkValid: true,
      provenanceValid: true,
      loanLiquidityEth: "100"
    }
  };

  const deployOutPath = path.join(__dirname, "..", "deployed_local.json");
  fs.writeFileSync(deployOutPath, JSON.stringify(deployment, null, 2));

  const frontendEnvPath = path.join(__dirname, "..", "..", "frontend", ".env.local");
  const backendEnvPath = path.join(__dirname, "..", "..", "backend", ".env.local");
  const frontendEnv = [
    "NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545",
    "NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000",
    `NEXT_PUBLIC_ORACLE_ADDRESS=${deployment.oracle}`,
    `NEXT_PUBLIC_VAULT_ADDRESS=${deployment.vault}`,
    `NEXT_PUBLIC_LOAN_ENGINE_ADDRESS=${deployment.loan}`,
    `NEXT_PUBLIC_REVENUE_ROUTER_ADDRESS=${deployment.router}`,
    `NEXT_PUBLIC_DEBT_TOKEN_ADDRESS=${deployment.debtToken}`
  ].join("\n");

  const backendEnv = [
    "ALCHEMY_URL=http://127.0.0.1:8545",
    "ALCHEMY_API_KEY=demo",
    "ALCHEMY_NFT_NETWORK=eth-mainnet",
    "COLLECTION_ADDRESS=0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d",
    "PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    `ORACLE_REGISTRY_ADDRESS=${deployment.oracle}`,
    `LOAN_ENGINE_ADDRESS=${deployment.loan}`,
    "TOKEN_IDS=1",
    "TOKEN_QUANTITY=1",
    "TOKEN_WEIGHTING=1",
    "ORACLE_UPDATE_INTERVAL_SECONDS=60"
  ].join("\n");

  fs.writeFileSync(frontendEnvPath, `${frontendEnv}\n`);
  fs.writeFileSync(backendEnvPath, `${backendEnv}\n`);

  console.log("Local MVP deployed.");
  console.table(deployment);
  console.log("Saved deployment:", deployOutPath);
  console.log("Updated frontend env:", frontendEnvPath);
  console.log("Updated backend env:", backendEnvPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
