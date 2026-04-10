import { Contract, JsonRpcProvider } from "ethers";

type NetworkMode = "local" | "testnet" | "mainnet";

function getNetworkMode(): NetworkMode {
  const rawMode = (process.env.NEXT_PUBLIC_NETWORK_MODE || "local").toLowerCase();
  if (rawMode === "mainnet" || rawMode === "testnet" || rawMode === "local") {
    return rawMode;
  }
  return "local";
}

function resolvePublicByMode(
  localValue: string | undefined,
  testnetValue: string | undefined,
  mainnetValue: string | undefined,
  fallback: string | undefined = ""
): string {
  const mode = getNetworkMode();
  if (mode === "local") return localValue || fallback || "";
  if (mode === "testnet") return testnetValue || fallback || "";
  return mainnetValue || fallback || "";
}

export const ADDRESSES = {
  oracle: resolvePublicByMode(
    process.env.NEXT_PUBLIC_ORACLE_ADDRESS_LOCAL,
    process.env.NEXT_PUBLIC_ORACLE_ADDRESS_TESTNET,
    process.env.NEXT_PUBLIC_ORACLE_ADDRESS_MAINNET,
    process.env.NEXT_PUBLIC_ORACLE_ADDRESS
  ),
  vault: resolvePublicByMode(
    process.env.NEXT_PUBLIC_VAULT_ADDRESS_LOCAL,
    process.env.NEXT_PUBLIC_VAULT_ADDRESS_TESTNET,
    process.env.NEXT_PUBLIC_VAULT_ADDRESS_MAINNET,
    process.env.NEXT_PUBLIC_VAULT_ADDRESS
  ),
  loan: resolvePublicByMode(
    process.env.NEXT_PUBLIC_LOAN_ENGINE_ADDRESS_LOCAL,
    process.env.NEXT_PUBLIC_LOAN_ENGINE_ADDRESS_TESTNET,
    process.env.NEXT_PUBLIC_LOAN_ENGINE_ADDRESS_MAINNET,
    process.env.NEXT_PUBLIC_LOAN_ENGINE_ADDRESS
  ),
  router: resolvePublicByMode(
    process.env.NEXT_PUBLIC_REVENUE_ROUTER_ADDRESS_LOCAL,
    process.env.NEXT_PUBLIC_REVENUE_ROUTER_ADDRESS_TESTNET,
    process.env.NEXT_PUBLIC_REVENUE_ROUTER_ADDRESS_MAINNET,
    process.env.NEXT_PUBLIC_REVENUE_ROUTER_ADDRESS
  ),
  licenseToken: resolvePublicByMode(
    process.env.NEXT_PUBLIC_LICENSE_TOKEN_ADDRESS_LOCAL,
    process.env.NEXT_PUBLIC_LICENSE_TOKEN_ADDRESS_TESTNET,
    process.env.NEXT_PUBLIC_LICENSE_TOKEN_ADDRESS_MAINNET,
    process.env.NEXT_PUBLIC_LICENSE_TOKEN_ADDRESS
  ),
};

export const oracleAbi = [
  "function rightTypeOf(uint256 rightsId) external view returns (uint8)",
  "function setOracleData(uint256 rightsId, uint256 value, uint256 volatility, bool trademarkValid, bool provenanceValid, uint8 nftType) external",
  "function setScores(uint256 rightsId, uint256 rarity, uint256 utility, uint256 distribution) external",
  "function validateOraclePath(uint256 rightsId, uint8 expectedType) external view returns (bool)",
  "function getFloorValue(uint256 rightsId) external view returns (uint256)",
  "function getValuations(uint256 rightsId) external view returns (uint256 liquidationValue, uint256 appraisalValue)",
  "function getCompositeScore(uint256 rightsId) external view returns (uint256)",
  "function getDynamicLTV(uint256 rightsId) external view returns (uint256)",
  "function rarityScore(uint256 rightsId) external view returns (uint256)",
  "function utilityScore(uint256 rightsId) external view returns (uint256)",
  "function distributionWeight(uint256 rightsId) external view returns (uint256)",
  "function getRiskStatus(uint256 rightsId) external view returns (bool)",
  "function getEthUsdPriceE18() external view returns (uint256)",
  "function volatilityIndex() external view returns (uint256)",
  "function getVolatilityIndex() external view returns (uint256)",
] as const;

export const vaultAbi = [
  "function lockMintRight(uint256 rightsId, uint8 nftType, address locker) external",
  "function lockMintingRights(uint256 rightsId, uint8 nftType, address locker, bool acknowledgesCommercialOnly) external",
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
  "function positions(uint256 rightsId) external view returns (uint256 debt, bool inPanic, bool liquidated)",
  "function panicThresholdBps() external view returns (uint256)",
  "function getCurrentLTV(uint256 rightsId) external view returns (uint256)",
  "function getDynamicMaxLTV() external view returns (uint256)",
  "function getDynamicMaxLTV(uint256 rightsId) external view returns (uint256)",
  "function borrow(uint256 rightsId, uint8 expectedType, uint256 amount) external",
  "function outstandingDebt(uint256 rightsId) external view returns (uint256)",
  "function isPanicMode(uint256 rightsId) external view returns (bool)",
  "function checkAndUpdatePanic(uint256 rightsId) external returns (bool)",
] as const;

export const routerAbi = [
  "function depositRevenue(uint256 rightsId) external payable",
  "function setBeneficiary(uint256 rightsId, address beneficiary) external",
] as const;

export const licenseAbi = [
  "function mintLicense(address to, uint256 nftCollection, uint256 nftTokenId, uint256 durationDays, uint8 licenseType, uint8 territory, string trademarkRef) external returns (uint256)",
  "function isLicenseValid(uint256 licenseId) external view returns (bool)",
  "function revokeLicense(uint256 licenseId, string reason) external",
] as const;

export function hasAllAddresses(): boolean {
  return Boolean(ADDRESSES.oracle && ADDRESSES.vault && ADDRESSES.loan && ADDRESSES.router);
}

export function getReadProvider(): JsonRpcProvider {
  const rpc = resolvePublicByMode(
    process.env.NEXT_PUBLIC_RPC_URL_LOCAL,
    process.env.NEXT_PUBLIC_RPC_URL_TESTNET,
    process.env.NEXT_PUBLIC_RPC_URL_MAINNET,
    process.env.NEXT_PUBLIC_RPC_URL
  );
  if (!rpc) {
    throw new Error("NEXT_PUBLIC_RPC_URL missing for active network mode");
  }
  return new JsonRpcProvider(rpc);
}

export function getProviderNetwork(): string {
  const mode = getNetworkMode();
  const generic = process.env.ALCHEMY_NFT_NETWORK;
  const local = process.env.ALCHEMY_NFT_NETWORK_LOCAL;
  const testnet = process.env.ALCHEMY_NFT_NETWORK_TESTNET;
  const mainnet = process.env.ALCHEMY_NFT_NETWORK_MAINNET;

  if (mode === "local") {
    return local || generic || mainnet || testnet || "";
  }

  if (mode === "testnet") {
    return testnet || generic || local || mainnet || "";
  }

  return mainnet || generic || local || testnet || "";
}

export function getCollectionAllowlist(): string[] {
  const raw = resolvePublicByMode(
    process.env.NEXT_PUBLIC_COLLECTION_ALLOWLIST_LOCAL,
    process.env.NEXT_PUBLIC_COLLECTION_ALLOWLIST_TESTNET,
    process.env.NEXT_PUBLIC_COLLECTION_ALLOWLIST_MAINNET,
    process.env.NEXT_PUBLIC_COLLECTION_ALLOWLIST
  );
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function getContracts(client: JsonRpcProvider) {
  return {
    oracle: new Contract(ADDRESSES.oracle, oracleAbi, client),
    vault: new Contract(ADDRESSES.vault, vaultAbi, client),
    loan: new Contract(ADDRESSES.loan, loanAbi, client),
    router: new Contract(ADDRESSES.router, routerAbi, client),
    licenseToken: new Contract(ADDRESSES.licenseToken, licenseAbi, client),
  };
}

export function getBackendBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";
}

export function shortAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function nftTypeLabel(typeValue: number): "NORMAL" | "RARE" {
  return typeValue === 1 ? "RARE" : "NORMAL";
}
