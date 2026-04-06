require("dotenv").config();

const { ethers } = require("ethers");

async function main() {
  const { RPC_URL, CONTRACT_ADDRESS, OWNER_PRIVATE_KEY } = process.env;

  if (!RPC_URL || !CONTRACT_ADDRESS || !OWNER_PRIVATE_KEY) {
    throw new Error("Missing RPC_URL, CONTRACT_ADDRESS, or OWNER_PRIVATE_KEY");
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);

  const abi = ["function setPaused(bool paused) external"];
  const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);

  const gasEstimate = await contract.setPaused.estimateGas(true);
  console.log("Estimated gas:", gasEstimate.toString());

  const tx = await contract.setPaused(true, {
    gasLimit: gasEstimate,
  });

  console.log("Transaction hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("Receipt status:", receipt.status);
}

main().catch((error) => {
  console.error("Failed to pause minting:", error);
  process.exitCode = 1;
});