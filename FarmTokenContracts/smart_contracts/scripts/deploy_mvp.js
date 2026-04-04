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

  const nftAddress = process.env.NFT_ADDRESS;
  const reserveWallet = process.env.RESERVE_WALLET || deployer.address;

  if (!nftAddress) {
    throw new Error("NFT_ADDRESS is required in environment");
  }

  console.log("Deploying with account:", deployer.address);
  console.log("Using NFT contract:", nftAddress);
  console.log("Using reserve wallet:", reserveWallet);

  const OracleRegistry = await hre.ethers.getContractFactory("OracleRegistry");
  const oracle = await OracleRegistry.deploy(deployer.address);
  await oracle.waitForDeployment();

  const Vault = await hre.ethers.getContractFactory("Vault");
  const vault = await Vault.deploy(nftAddress, deployer.address);
  await vault.waitForDeployment();

  const LoanEngine = await hre.ethers.getContractFactory("LoanEngine");
  const loanEngine = await LoanEngine.deploy(
    await oracle.getAddress(),
    await vault.getAddress(),
    deployer.address
  );
  await loanEngine.waitForDeployment();

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

  await verifyIfConfigured(await oracle.getAddress(), [deployer.address]);
  await verifyIfConfigured(await vault.getAddress(), [nftAddress, deployer.address]);
  await verifyIfConfigured(await loanEngine.getAddress(), [
    await oracle.getAddress(),
    await vault.getAddress(),
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
    nftAddress,
    reserveWallet,
    oracleRegistry: await oracle.getAddress(),
    vault: await vault.getAddress(),
    loanEngine: await loanEngine.getAddress(),
    revenueRouter: await revenueRouter.getAddress(),
  };

  const outPath = path.join(__dirname, "..", "deployed_mvp.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("MVP contracts deployed:");
  console.table(output);
  console.log("Saved deployment file to:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});