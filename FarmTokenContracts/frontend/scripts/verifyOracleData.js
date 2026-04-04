require("dotenv").config({ path: ".env" });
const { ethers } = require("ethers");

const oracleAbi = [
  "function getFloorValue(uint256 tokenId) view returns (uint256)",
  "function getRiskStatus(uint256 tokenId) view returns (bool)",
  "function isTrademarkValid(uint256 tokenId) view returns (bool)",
  "function isProvenanceValid(uint256 tokenId) view returns (bool)",
  "function volatilityIndex() view returns (uint256)",
  "function getDynamicMaxLTV(uint256 tokenId) view returns (uint256)",
  "function tokenInPanic(uint256 tokenId) view returns (bool)",
];

async function main() {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
  const oracleAddress = process.env.NEXT_PUBLIC_ORACLE_ADDRESS;
  const tokenId = BigInt(process.env.ORACLE_VERIFY_TOKEN_ID || "1");

  if (!rpcUrl || !oracleAddress) {
    throw new Error("NEXT_PUBLIC_RPC_URL and NEXT_PUBLIC_ORACLE_ADDRESS are required");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const oracle = new ethers.Contract(oracleAddress, oracleAbi, provider);

  const [
    floor,
    risk,
    trademark,
    provenance,
    vol,
    ltv,
    panic,
  ] = await Promise.all([
    oracle.getFloorValue(tokenId),
    oracle.getRiskStatus(tokenId),
    oracle.isTrademarkValid(tokenId),
    oracle.isProvenanceValid(tokenId),
    oracle.volatilityIndex(),
    oracle.getDynamicMaxLTV(tokenId),
    oracle.tokenInPanic(tokenId),
  ]);

  console.log("Oracle verification report");
  console.log("Token ID:", tokenId.toString());
  console.log("Floor value:", ethers.formatEther(floor));
  console.log("Risk status:", risk);
  console.log("Trademark valid:", trademark);
  console.log("Provenance valid:", provenance);
  console.log("Volatility index:", Number(vol));
  console.log("Dynamic max LTV (bps):", Number(ltv));
  console.log("Token in panic:", panic);
}

main().catch((error) => {
  console.error("Verification failed:", error.message);
  process.exit(1);
});
