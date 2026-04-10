const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const CLIENT_TEST_WALLET = "0xc82A59594560A3010F336ebe2e9CC4794DCD46cf";
const EXPECTED_NFT_COUNT = 18;

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optionalEnv(name, fallback = "") {
  const value = String(process.env[name] || "").trim();
  return value || fallback;
}

function toTokenIdDecimal(tokenIdHex) {
  try {
    return BigInt(tokenIdHex).toString();
  } catch {
    return "0";
  }
}

async function verifyIfConfigured(address, constructorArguments) {
  if (!process.env.ETHERSCAN_API_KEY) return;

  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments,
    });
    console.log(`Verified: ${address}`);
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("already verified")) {
      console.log(`Already verified: ${address}`);
      return;
    }
    console.warn(`Verification skipped for ${address}: ${error.message || error}`);
  }
}

async function fetchNftsForWallet({ alchemyApiKey, wallet, collectionAddress }) {
  const url =
    `https://eth-mainnet.g.alchemy.com/nft/v2/${alchemyApiKey}/getNFTsForOwner` +
    `?owner=${wallet}&contractAddresses[]=${collectionAddress}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Alchemy getNFTsForOwner failed: ${response.status}`);
  }

  const payload = await response.json();
  const owned = Array.isArray(payload?.ownedNfts) ? payload.ownedNfts : [];

  const tokenIds = owned
    .map((nft) => toTokenIdDecimal(nft?.id?.tokenId))
    .filter((tokenId) => tokenId !== "0");

  return Array.from(new Set(tokenIds));
}

async function fetchCollectionFloorPriceEth({ alchemyApiKey, collectionAddress }) {
  const url = `https://eth-mainnet.g.alchemy.com/nft/v2/${alchemyApiKey}/getFloorPrice?contractAddress=${collectionAddress}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Alchemy getFloorPrice failed: ${response.status}`);
  }

  const payload = await response.json();
  const openSea = Number(payload?.openSea?.floorPrice || 0);
  const looksRare = Number(payload?.looksRare?.floorPrice || 0);
  const floor = openSea > 0 ? openSea : looksRare;

  if (!Number.isFinite(floor) || floor <= 0) {
    throw new Error("Alchemy floor price is missing or zero");
  }

  return floor;
}

async function main() {
  if (hre.network.name !== "sepolia") {
    throw new Error("This deploy script is intended for --network sepolia");
  }

  // Ensure Sepolia RPC from env is populated for network config.
  const sepoliaRpc = optionalEnv("NEXT_PUBLIC_RPC_URL_TESTNET") || optionalEnv("ALCHEMY_URL");
  if (!sepoliaRpc) {
    throw new Error("Missing Sepolia RPC env: set NEXT_PUBLIC_RPC_URL_TESTNET or ALCHEMY_URL");
  }

  const [deployerSigner] = await hre.ethers.getSigners();
  const deployer = await deployerSigner.getAddress();

  const alchemyApiKey = requiredEnv("ALCHEMY_API_KEY");
  const collectionAddress = requiredEnv("NEXT_PUBLIC_COLLECTION_ADDRESS");
  const walletToSeed = optionalEnv("TEST_WALLET_ADDRESS", CLIENT_TEST_WALLET);

  const ethUsdFeed = optionalEnv("CHAINLINK_ETH_USD_FEED_TESTNET", "0x694AA1769357215DE4FAC081bf1f309aDC325306");
  const multisigWallet = optionalEnv("MULTISIG_WALLET_ADDRESS_TESTNET", deployer);
  const reserveWallet = optionalEnv("RESERVE_WALLET", deployer);
  const treasuryWallet = optionalEnv("TREASURY_WALLET", deployer);

  const maxRightsSupply = Number(optionalEnv("MAX_RIGHTS_SUPPLY", "9300"));
  const reservePercent = Number(optionalEnv("RESERVE_PERCENT", "20"));
  const treasuryPercent = Number(optionalEnv("TREASURY_PERCENT", "30"));
  const licenseBaseUri = optionalEnv("LICENSE_BASE_URI", "ipfs://license-metadata/");

  console.log("Deploying to:", hre.network.name);
  console.log("Deployer:", deployer);
  console.log("Sepolia RPC source:", sepoliaRpc);

  const RegularOracle = await hre.ethers.getContractFactory("RegularOracle");
  const RareOracle = await hre.ethers.getContractFactory("RareOracle");
  const DebtToken = await hre.ethers.getContractFactory("DebtToken");
  const Vault = await hre.ethers.getContractFactory("Vault");
  const OracleRegistry = await hre.ethers.getContractFactory("OracleRegistry");
  const LoanEngine = await hre.ethers.getContractFactory("LoanEngine");
  const RevenueDistributor = await hre.ethers.getContractFactory("RevenueDistributor");
  const LicenseToken = await hre.ethers.getContractFactory("LicenseToken");

  const normalOracle = await RegularOracle.deploy(deployer);
  await normalOracle.waitForDeployment();

  const rareOracle = await RareOracle.deploy(deployer);
  await rareOracle.waitForDeployment();

  const debtToken = await DebtToken.deploy(deployer);
  await debtToken.waitForDeployment();

  // MintingRightsVault in this codebase is the Vault contract.
  const mintingRightsVault = await Vault.deploy(maxRightsSupply, deployer);
  await mintingRightsVault.waitForDeployment();

  const oracleRegistry = await OracleRegistry.deploy(
    deployer,
    await normalOracle.getAddress(),
    await rareOracle.getAddress(),
    ethUsdFeed
  );
  await oracleRegistry.waitForDeployment();

  const loanEngine = await LoanEngine.deploy(
    await oracleRegistry.getAddress(),
    await mintingRightsVault.getAddress(),
    await debtToken.getAddress(),
    deployer
  );
  await loanEngine.waitForDeployment();

  const licenseToken = await LicenseToken.deploy(licenseBaseUri, deployer, multisigWallet);
  await licenseToken.waitForDeployment();

  const revenueDistributor = await RevenueDistributor.deploy(
    await loanEngine.getAddress(),
    deployer,
    multisigWallet,
    reserveWallet,
    treasuryWallet,
    await licenseToken.getAddress(),
    reservePercent,
    treasuryPercent
  );
  await revenueDistributor.waitForDeployment();

  // Wiring
  await (await mintingRightsVault.setLoanEngine(await loanEngine.getAddress())).wait();
  await (await mintingRightsVault.setOracle(await oracleRegistry.getAddress())).wait();

  const minterRole = await debtToken.MINTER_ROLE();
  await (await debtToken.grantRole(minterRole, await loanEngine.getAddress())).wait();

  if (loanEngine.setRevenueDistributor) {
    await (await loanEngine.setRevenueDistributor(await revenueDistributor.getAddress())).wait();
  }

  if (revenueDistributor.setLoanEngine) {
    await (await revenueDistributor.setLoanEngine(await loanEngine.getAddress())).wait();
  }
  if (revenueDistributor.setLicenseToken) {
    await (await revenueDistributor.setLicenseToken(await licenseToken.getAddress())).wait();
  }

  // Seed initial oracle valuations for the client's wallet NFTs (expected 18).
  const tokenIds = await fetchNftsForWallet({
    alchemyApiKey,
    wallet: walletToSeed,
    collectionAddress,
  });

  if (tokenIds.length !== EXPECTED_NFT_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_NFT_COUNT} NFTs for wallet ${walletToSeed}, got ${tokenIds.length}. Aborting oracle seed.`
    );
  }

  const floorPriceEth = await fetchCollectionFloorPriceEth({
    alchemyApiKey,
    collectionAddress,
  });
  const floorPriceWei = hre.ethers.parseEther(floorPriceEth.toString());

  for (const tokenId of tokenIds) {
    // setOracleData(rightsId, value, volatility, trademarkValid, provenanceValid, nftType)
    // nftType: 0 => NORMAL, 1 => RARE. Seeding as standard by default.
    const tx = await oracleRegistry.setOracleData(tokenId, floorPriceWei, 20, true, true, 0);
    await tx.wait();
  }

  const deployed = {
    network: "sepolia",
    deployer,
    rpc: sepoliaRpc,
    contracts: {
      mintingRightsVault: await mintingRightsVault.getAddress(),
      oracleRegistry: await oracleRegistry.getAddress(),
      loanEngine: await loanEngine.getAddress(),
      revenueDistributor: await revenueDistributor.getAddress(),
      licenseToken: await licenseToken.getAddress(),
      // Additional deployed dependencies
      debtToken: await debtToken.getAddress(),
      normalOracle: await normalOracle.getAddress(),
      rareOracle: await rareOracle.getAddress(),
    },
    seed: {
      wallet: walletToSeed,
      collectionAddress,
      floorPriceEth,
      seededTokenIds: tokenIds,
      seededCount: tokenIds.length,
      trademarkRef: "UK00003897277",
    },
    deployedAt: new Date().toISOString(),
  };

  const outputPath = path.join(__dirname, "..", "deployed_sepolia.json");
  fs.writeFileSync(outputPath, JSON.stringify(deployed, null, 2));

  console.table(deployed.contracts);
  console.log(`Saved deployment output: ${outputPath}`);

  // Optional Etherscan verification when API key is present.
  if (process.env.ETHERSCAN_API_KEY) {
    await verifyIfConfigured(await normalOracle.getAddress(), [deployer]);
    await verifyIfConfigured(await rareOracle.getAddress(), [deployer]);
    await verifyIfConfigured(await debtToken.getAddress(), [deployer]);
    await verifyIfConfigured(await mintingRightsVault.getAddress(), [maxRightsSupply, deployer]);
    await verifyIfConfigured(await oracleRegistry.getAddress(), [
      deployer,
      await normalOracle.getAddress(),
      await rareOracle.getAddress(),
      ethUsdFeed,
    ]);
    await verifyIfConfigured(await loanEngine.getAddress(), [
      await oracleRegistry.getAddress(),
      await mintingRightsVault.getAddress(),
      await debtToken.getAddress(),
      deployer,
    ]);
    await verifyIfConfigured(await licenseToken.getAddress(), [licenseBaseUri, deployer, multisigWallet]);
    await verifyIfConfigured(await revenueDistributor.getAddress(), [
      await loanEngine.getAddress(),
      deployer,
      multisigWallet,
      reserveWallet,
      treasuryWallet,
      await licenseToken.getAddress(),
      reservePercent,
      treasuryPercent,
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
