import { Contract, JsonRpcProvider } from "ethers";

export const ADDRESSES = {
  oracle: process.env.NEXT_PUBLIC_ORACLE_ADDRESS || "",
  vault: process.env.NEXT_PUBLIC_VAULT_ADDRESS || "",
  loan: process.env.NEXT_PUBLIC_LOAN_ENGINE_ADDRESS || "",
  router: process.env.NEXT_PUBLIC_REVENUE_ROUTER_ADDRESS || "",
};

export const oracleAbi = [
  "function rightTypeOf(uint256 rightsId) external view returns (uint8)",
  "function setOracleData(uint256 rightsId, uint256 value, uint256 volatility, bool trademarkValid, bool provenanceValid, uint8 nftType) external",
  "function validateOraclePath(uint256 rightsId, uint8 expectedType) external view returns (bool)",
  "function getFloorValue(uint256 rightsId) external view returns (uint256)",
  "function getRiskStatus(uint256 rightsId) external view returns (bool)",
  "function volatilityIndex() external view returns (uint256)",
  "function getVolatilityIndex() external view returns (uint256)",
] as const;

export const vaultAbi = [
  "function lockMintRight(uint256 rightsId, uint8 nftType, address locker) external",
  "function unlockMintRight(uint256 rightsId, address receiver) external",
  "function getLockedRightIds() external view returns (uint256[] memory)",
  "function getLockedRightsByWallet(address owner) external view returns (uint256[] memory)",
  "function getSnapshotValue(uint256 rightsId) external view returns (uint256)",
  "function getMirrorRange(uint256 startId, uint256 endId) external view returns ((uint256 rightsId,bool isLocked,address locker,bool typeSet,uint8 nftType,uint256 oracleValue,uint256 snapshotValue,uint256 debt,uint256 ltvBps)[] memory)",
  "function lockedBy(uint256 rightsId) external view returns (address)",
  "function lockedRightsCount(address owner) external view returns (uint256)",
  "function rightTypeOf(uint256 rightsId) external view returns (uint8)",
  "function isLocked(uint256 rightsId) external view returns (bool)",
] as const;

export const loanAbi = [
  "function positions(uint256 rightsId) external view returns (uint256 debt, bool inPanic)",
  "function getCurrentLTV(uint256 rightsId) external view returns (uint256)",
  "function getDynamicMaxLTV() external view returns (uint256)",
  "function borrow(uint256 rightsId, uint8 expectedType, uint256 amount) external",
  "function outstandingDebt(uint256 rightsId) external view returns (uint256)",
  "function isPanicMode(uint256 rightsId) external view returns (bool)",
  "function checkAndUpdatePanic(uint256 rightsId) external returns (bool)",
] as const;

export const routerAbi = [
  "function depositRevenue(uint256 rightsId) external payable",
  "function setBeneficiary(uint256 rightsId, address beneficiary) external",
] as const;

export function hasAllAddresses(): boolean {
  return Boolean(ADDRESSES.oracle && ADDRESSES.vault && ADDRESSES.loan && ADDRESSES.router);
}

export function getReadProvider(): JsonRpcProvider {
  const rpc = process.env.NEXT_PUBLIC_RPC_URL;
  if (!rpc) {
    throw new Error("NEXT_PUBLIC_RPC_URL missing");
  }
  return new JsonRpcProvider(rpc);
}

export function getContracts(client: JsonRpcProvider) {
  return {
    oracle: new Contract(ADDRESSES.oracle, oracleAbi, client),
    vault: new Contract(ADDRESSES.vault, vaultAbi, client),
    loan: new Contract(ADDRESSES.loan, loanAbi, client),
    router: new Contract(ADDRESSES.router, routerAbi, client),
  };
}

export function shortAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function nftTypeLabel(typeValue: number): "NORMAL" | "RARE" {
  return typeValue === 1 ? "RARE" : "NORMAL";
}

export function parseQrPayload(payload: string): { wallet?: string; rightsId?: string } {
  const cleaned = payload.trim();

  const walletMatch = cleaned.match(/0x[a-fA-F0-9]{40}/);
  const rightsMatch = cleaned.match(/(?:right|rights|id|token)\s*[:=]\s*(\d+)/i) || cleaned.match(/\b(\d{1,6})\b/);

  return {
    wallet: walletMatch?.[0],
    rightsId: rightsMatch?.[1],
  };
}
