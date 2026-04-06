require("dotenv").config();
const { ethers } = require("ethers");

/**
 * Read required environment variable or throw with a clear error message.
 */
function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

/**
 * Convert raw LTV to a readable string using common on-chain scaling conventions.
 */
function formatLtvHumanReadable(rawLtv) {
  if (rawLtv <= 100n) {
    return `${rawLtv.toString()}% (integer percent)`;
  }

  if (rawLtv <= 10000n) {
    return `${ethers.formatUnits(rawLtv, 2)}% (basis points)`;
  }

  const percentFrom18Decimals = ethers.formatUnits(rawLtv, 16);
  return `${percentFrom18Decimals}% (18-decimal fixed-point ratio converted to percent)`;
}

async function main() {
  // 1) Load connection + wallet settings from environment variables.
  const rpcUrl = getRequiredEnv("RPC_URL");
  const contractAddress = getRequiredEnv("CONTRACT_ADDRESS");
  const privateKey = getRequiredEnv("WALLET_PRIVATE_KEY");

  // 2) Create a JSON-RPC provider and a private key wallet (no MetaMask required).
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  // 3) Define the minimal ABI for reading LTV.
  const abi = ["function getLTV() view returns (uint256)"];

  // 4) Create a contract instance connected with the wallet.
  const contract = new ethers.Contract(contractAddress, abi, wallet);

  // 5) Read and print LTV.
  const rawLtv = await contract.getLTV();

  console.log("Wallet address:", wallet.address);
  console.log("Contract address:", contractAddress);
  console.log("Current LTV (raw uint256):", rawLtv.toString());
  console.log("Current LTV (human-readable):", formatLtvHumanReadable(rawLtv));
}

main().catch((error) => {
  // Graceful error handling with clear, actionable output.
  console.error("Failed to read LTV:", error.message);

  if (error.code) {
    console.error("Error code:", error.code);
  }

  process.exit(1);
});
