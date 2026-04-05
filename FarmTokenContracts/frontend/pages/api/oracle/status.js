import { JsonRpcProvider, Contract, formatEther } from "ethers";

const oracleAbi = [
  "function getFloorValue(uint256 rightsId) external view returns (uint256)",
  "function rightTypeOf(uint256 rightsId) external view returns (uint8)",
  "function getRiskStatus(uint256 rightsId) external view returns (bool)",
  "function volatilityIndex() external view returns (uint256)",
] ;

const vaultAbi = ["function getSnapshotValue(uint256 rightsId) external view returns (uint256)"];
const loanAbi = [
  "function positions(uint256 rightsId) external view returns (uint256 debt, bool inPanic)",
  "function getCurrentLTV(uint256 rightsId) external view returns (uint256)",
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { rightsId = "1" } = req.query;
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
    const oracleAddress = process.env.NEXT_PUBLIC_ORACLE_ADDRESS;
    const vaultAddress = process.env.NEXT_PUBLIC_VAULT_ADDRESS;
    const loanAddress = process.env.NEXT_PUBLIC_LOAN_ENGINE_ADDRESS;

    if (!rpcUrl || !oracleAddress || !vaultAddress || !loanAddress) {
      return res.status(500).json({ error: "Missing RPC or contract addresses in env" });
    }

    const provider = new JsonRpcProvider(rpcUrl);
    const oracle = new Contract(oracleAddress, oracleAbi, provider);
    const vault = new Contract(vaultAddress, vaultAbi, provider);
    const loan = new Contract(loanAddress, loanAbi, provider);
    const id = BigInt(rightsId);

    const [floorValue, typeValue, risk, volatility, snapshotValue, position, ltv] = await Promise.all([
      oracle.getFloorValue(id),
      oracle.rightTypeOf(id),
      oracle.getRiskStatus(id),
      oracle.volatilityIndex(),
      vault.getSnapshotValue(id),
      loan.positions(id),
      loan.getCurrentLTV(id),
    ]);

    return res.status(200).json({
      success: true,
      rightsId: Number(id),
      nftType: Number(typeValue) === 1 ? "RARE" : "NORMAL",
      floorValueEth: formatEther(floorValue),
      snapshotValueEth: formatEther(snapshotValue),
      debtEth: formatEther(position.debt),
      ltvBps: Number(ltv),
      inPanic: position.inPanic,
      risk,
      volatility: Number(volatility),
    });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error", message: error.message });
  }
}