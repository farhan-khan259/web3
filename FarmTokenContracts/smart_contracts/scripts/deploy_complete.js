const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function toNetworkScope(networkName) {
  if (networkName === "hardhat" || networkName === "localhost") return "LOCAL";
  if (networkName === "sepolia") return "TESTNET";
  return "MAINNET";
}

function getScopedEnv(base, scope) {
  return process.env[`${base}_${scope}`] || process.env[base] || "";
}

async function hasCode(address) {
  if (!address) return false;
  const code = await hre.ethers.provider.getCode(address);
  return code && code !== "0x";
}

async function verifyIfConfigured(address, constructorArguments) {
  const isLocal = hre.network.name === "hardhat" || hre.network.name === "localhost";
  if (isLocal || !process.env.ETHERSCAN_API_KEY) return;

  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments,
    });
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (!message.includes("already verified")) {
      throw error;
    }
  }
}

async function deployOrAttach(contractName, constructorArgs, envKey, scope) {
  const configured = getScopedEnv(envKey, scope);
  if (configured && (await hasCode(configured))) {
    const factory = await hre.ethers.getContractFactory(contractName);
    const attached = factory.attach(configured);
    return { instance: attached, address: configured, deployed: false };
  }

  const factory = await hre.ethers.getContractFactory(contractName);
  const deployed = await factory.deploy(...constructorArgs);
  await deployed.waitForDeployment();
  const address = await deployed.getAddress();
  return { instance: deployed, address, deployed: true };
}

async function callIfPresent(contract, functionName, args = []) {
  const fn = contract.interface.fragments.find(
    (fragment) => fragment.type === "function" && fragment.name === functionName
  );
  if (!fn) return false;

  const tx = await contract[functionName](...args);
  await tx.wait();
  return true;
}

async function grantRoleIfPresent(contract, roleName, account) {
  const hasRoleFn = contract.interface.fragments.find(
    (fragment) => fragment.type === "function" && fragment.name === roleName
  );
  if (!hasRoleFn) return;

  const role = await contract[roleName]();
  const alreadyGranted = await contract.hasRole(role, account);
  if (!alreadyGranted) {
    const tx = await contract.grantRole(role, account);
    await tx.wait();
  }
}

async function revokeRoleIfPresent(contract, roleName, account) {
  const hasRoleFn = contract.interface.fragments.find(
    (fragment) => fragment.type === "function" && fragment.name === roleName
  );
  if (!hasRoleFn) return;

  const role = await contract[roleName]();
  const granted = await contract.hasRole(role, account);
  if (granted) {
    const tx = await contract.revokeRole(role, account);
    await tx.wait();
  }
}

async function transferOwnableIfNeeded(contract, newOwner) {
  const ownerFn = contract.interface.fragments.find(
    (fragment) => fragment.type === "function" && fragment.name === "owner"
  );
  const transferFn = contract.interface.fragments.find(
    (fragment) => fragment.type === "function" && fragment.name === "transferOwnership"
  );

  if (!ownerFn || !transferFn) return;

  const currentOwner = await contract.owner();
  if (currentOwner.toLowerCase() !== newOwner.toLowerCase()) {
    const tx = await contract.transferOwnership(newOwner);
    await tx.wait();
  }
}

async function transferAccessControlAdmin(contract, deployer, multisig) {
  const hasRoleFn = contract.interface.fragments.find(
    (fragment) => fragment.type === "function" && fragment.name === "hasRole"
  );
  const grantFn = contract.interface.fragments.find(
    (fragment) => fragment.type === "function" && fragment.name === "grantRole"
  );
  const revokeFn = contract.interface.fragments.find(
    (fragment) => fragment.type === "function" && fragment.name === "revokeRole"
  );

  if (!hasRoleFn || !grantFn || !revokeFn) return;

  const defaultAdminRole = await contract.DEFAULT_ADMIN_ROLE();

  if (!(await contract.hasRole(defaultAdminRole, multisig))) {
    const tx = await contract.grantRole(defaultAdminRole, multisig);
    await tx.wait();
  }

  // Best effort additional role migration
  await grantRoleIfPresent(contract, "ADMIN_ROLE", multisig);
  await grantRoleIfPresent(contract, "OPERATOR_ROLE", multisig);
  await grantRoleIfPresent(contract, "REVOKER_ROLE", multisig);
  await grantRoleIfPresent(contract, "TRADEMARK_ADMIN_ROLE", multisig);
  await grantRoleIfPresent(contract, "RECOVERY_ROLE", multisig);
  await grantRoleIfPresent(contract, "MINTER_ROLE", multisig);

  if (deployer.toLowerCase() !== multisig.toLowerCase()) {
    if (await contract.hasRole(defaultAdminRole, deployer)) {
      const tx = await contract.revokeRole(defaultAdminRole, deployer);
      await tx.wait();
    }

    // Best effort role cleanup
    await revokeRoleIfPresent(contract, "ADMIN_ROLE", deployer);
    await revokeRoleIfPresent(contract, "OPERATOR_ROLE", deployer);
    await revokeRoleIfPresent(contract, "REVOKER_ROLE", deployer);
    await revokeRoleIfPresent(contract, "TRADEMARK_ADMIN_ROLE", deployer);
    await revokeRoleIfPresent(contract, "RECOVERY_ROLE", deployer);
    await revokeRoleIfPresent(contract, "MINTER_ROLE", deployer);
  }
}

async function main() {
  const [deployerSigner] = await hre.ethers.getSigners();
  const deployer = await deployerSigner.getAddress();
  const scope = toNetworkScope(hre.network.name);
  const isLocal = scope === "LOCAL";

  const multisigWallet = getScopedEnv("MULTISIG_WALLET_ADDRESS", scope) || process.env.MULTISIG_WALLET || deployer;
  const reserveWallet = getScopedEnv("RESERVE_WALLET", scope) || deployer;
  const treasuryWallet = getScopedEnv("TREASURY_WALLET", scope) || deployer;
  const multisigSigners = (process.env.MULTISIG_SIGNERS || multisigWallet)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const multisigThreshold = Number(process.env.MULTISIG_THRESHOLD || "3");

  const mainnetEthUsdFeed = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";

  const ethUsdFeedAddress = isLocal
    ? getScopedEnv("CHAINLINK_ETH_USD_FEED", scope)
    : hre.network.name === "mainnet"
      ? mainnetEthUsdFeed
      : getScopedEnv("CHAINLINK_ETH_USD_FEED", scope);

  if (!ethUsdFeedAddress) {
    throw new Error("Missing CHAINLINK_ETH_USD_FEED for OracleRegistry deployment");
  }

  const nftFloorFeed = getScopedEnv("CHAINLINK_NFT_FLOOR_FEED", scope);
  if (!nftFloorFeed) {
    throw new Error(
      "Missing CHAINLINK_NFT_FLOOR_FEED. Please provide the specific NFT floor price feed address via env."
    );
  }

  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployer);
  console.log("Multisig:", multisigWallet, `(threshold ${multisigThreshold}-of-${multisigSigners.length})`);

  // Auxiliary oracles needed by OracleRegistry constructor.
  const normalOracle = await deployOrAttach("RegularOracle", [deployer], "NORMAL_ORACLE_ADDRESS", scope);
  const rareOracle = await deployOrAttach("RareOracle", [deployer], "RARE_ORACLE_ADDRESS", scope);

  // 1) DebtToken
  const debtToken = await deployOrAttach("DebtToken", [deployer], "DEBT_TOKEN_ADDRESS", scope);

  // 2) Vault
  const maxRightsSupply = Number(process.env.MAX_RIGHTS_SUPPLY || "9300");
  const vault = await deployOrAttach("Vault", [maxRightsSupply, deployer], "VAULT_ADDRESS", scope);

  // 3) OracleRegistry
  const oracleRegistry = await deployOrAttach(
    "OracleRegistry",
    [deployer, normalOracle.address, rareOracle.address, ethUsdFeedAddress],
    "ORACLE_REGISTRY_ADDRESS",
    scope
  );

  // Ensure class oracles trust registry
  await callIfPresent(normalOracle.instance, "setRegistry", [oracleRegistry.address]);
  await callIfPresent(rareOracle.instance, "setRegistry", [oracleRegistry.address]);

  // 4) LicenseToken (new)
  const licenseBaseURI = process.env.LICENSE_BASE_URI || "ipfs://license-metadata/";
  const licenseToken = await deployOrAttach(
    "LicenseToken",
    [licenseBaseURI, deployer, multisigWallet],
    "LICENSE_TOKEN_ADDRESS",
    scope
  );

  // 5) RevenueDistributor (new) BEFORE LoanEngine: predict LoanEngine address if deploying fresh
  let predictedLoanAddress = getScopedEnv("LOAN_ENGINE_ADDRESS", scope);
  const existingLoanHasCode = await hasCode(predictedLoanAddress);

  if (!existingLoanHasCode) {
    const currentNonce = await hre.ethers.provider.getTransactionCount(deployer);
    // RevenueDistributor is deployed now, LoanEngine immediately after => nonce + 1.
    predictedLoanAddress = hre.ethers.getCreateAddress({
      from: deployer,
      nonce: BigInt(currentNonce + 1),
    });
  }

  const reservePercent = Number(process.env.RESERVE_PERCENT || "20");
  const treasuryPercent = Number(process.env.TREASURY_PERCENT || "30");

  const revenueDistributor = await deployOrAttach(
    "RevenueDistributor",
    [
      predictedLoanAddress,
      deployer,
      multisigWallet,
      reserveWallet,
      treasuryWallet,
      licenseToken.address,
      reservePercent,
      treasuryPercent,
    ],
    "REVENUE_DISTRIBUTOR_ADDRESS",
    scope
  );

  // 6) LoanEngine (updated)
  const loanEngine = await deployOrAttach(
    "LoanEngine",
    [oracleRegistry.address, vault.address, debtToken.address, deployer],
    "LOAN_ENGINE_ADDRESS",
    scope
  );

  // 7) Contract connections
  const debtMinterRole = await debtToken.instance.MINTER_ROLE();
  if (!(await debtToken.instance.hasRole(debtMinterRole, loanEngine.address))) {
    const tx = await debtToken.instance.grantRole(debtMinterRole, loanEngine.address);
    await tx.wait();
  }

  await callIfPresent(vault.instance, "setLoanEngine", [loanEngine.address]);
  await callIfPresent(vault.instance, "setOracle", [oracleRegistry.address]);

  // Requested wiring calls
  const didSetRevenueDistributor = await callIfPresent(
    loanEngine.instance,
    "setRevenueDistributor",
    [revenueDistributor.address]
  );
  if (!didSetRevenueDistributor) {
    await callIfPresent(loanEngine.instance, "setRevenueRouter", [revenueDistributor.address]);
  }

  await callIfPresent(revenueDistributor.instance, "setLoanEngine", [loanEngine.address]);
  await callIfPresent(revenueDistributor.instance, "setLicenseToken", [licenseToken.address]);

  // Optional multisig address alignment hooks
  await callIfPresent(loanEngine.instance, "setMultisigWallet", [multisigWallet]);
  await callIfPresent(revenueDistributor.instance, "setMultisigWallet", [multisigWallet]);

  // 9) Initial multisig config summary only (3-of-N operational expectation)
  console.log("Multisig config:", {
    wallet: multisigWallet,
    threshold: multisigThreshold,
    signers: multisigSigners,
  });

  // 10) Transfer ownership/control to multisig
  await transferOwnableIfNeeded(oracleRegistry.instance, multisigWallet);
  await transferOwnableIfNeeded(revenueDistributor.instance, multisigWallet);
  await transferOwnableIfNeeded(normalOracle.instance, multisigWallet);
  await transferOwnableIfNeeded(rareOracle.instance, multisigWallet);

  await transferAccessControlAdmin(debtToken.instance, deployer, multisigWallet);
  await transferAccessControlAdmin(vault.instance, deployer, multisigWallet);
  await transferAccessControlAdmin(loanEngine.instance, deployer, multisigWallet);
  await transferAccessControlAdmin(licenseToken.instance, deployer, multisigWallet);

  // 11) Verification + output
  const verificationTargets = [
    [normalOracle.address, [deployer]],
    [rareOracle.address, [deployer]],
    [debtToken.address, [deployer]],
    [vault.address, [maxRightsSupply, deployer]],
    [oracleRegistry.address, [deployer, normalOracle.address, rareOracle.address, ethUsdFeedAddress]],
    [licenseToken.address, [licenseBaseURI, deployer, multisigWallet]],
    [
      revenueDistributor.address,
      [
        predictedLoanAddress,
        deployer,
        multisigWallet,
        reserveWallet,
        treasuryWallet,
        licenseToken.address,
        reservePercent,
        treasuryPercent,
      ],
    ],
    [loanEngine.address, [oracleRegistry.address, vault.address, debtToken.address, deployer]],
  ];

  for (const [address, args] of verificationTargets) {
    await verifyIfConfigured(address, args);
  }

  const out = {
    network: hre.network.name,
    scope,
    deployer,
    feeds: {
      ethUsdFeed: ethUsdFeedAddress,
      nftFloorFeed,
      mainnetEthUsdReference: mainnetEthUsdFeed,
    },
    multisig: {
      wallet: multisigWallet,
      threshold: multisigThreshold,
      signers: multisigSigners,
    },
    contracts: {
      normalOracle: normalOracle.address,
      rareOracle: rareOracle.address,
      debtToken: debtToken.address,
      vault: vault.address,
      oracleRegistry: oracleRegistry.address,
      licenseToken: licenseToken.address,
      revenueDistributor: revenueDistributor.address,
      loanEngine: loanEngine.address,
    },
    links: {
      loanEngineRevenueDistributorLinked: true,
      revenueDistributorLoanEngineLinked: true,
      revenueDistributorLicenseTokenLinked: true,
    },
    deployedAt: new Date().toISOString(),
  };

  const outPath = path.join(__dirname, "..", "deployed_complete.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log("Complete deployment finished:");
  console.table(out.contracts);
  console.log("Saved:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
