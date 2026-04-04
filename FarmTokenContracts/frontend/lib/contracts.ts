import { BrowserProvider, Contract, JsonRpcProvider, Signer, ethers } from "ethers";

export const ADDRESSES = {
  oracle: process.env.NEXT_PUBLIC_ORACLE_ADDRESS || "",
  vault: process.env.NEXT_PUBLIC_VAULT_ADDRESS || "",
  loan: process.env.NEXT_PUBLIC_LOAN_ENGINE_ADDRESS || "",
  router: process.env.NEXT_PUBLIC_REVENUE_ROUTER_ADDRESS || "",
  nft: process.env.NEXT_PUBLIC_NFT_CONTRACT || "",
};

export const oracleAbi = [
  "function setOracleData(uint256 tokenId, uint256 value, uint256 volatility, bool trademarkValid, bool provenanceValid) external",
  "function getFloorValue(uint256 tokenId) external view returns (uint256)",
  "function getRiskStatus(uint256 tokenId) external view returns (bool)",
  "function volatilityIndex() external view returns (uint256)",
  "function getVolatilityIndex() external view returns (uint256)",
] as const;

export const vaultAbi = [
  "function depositNFT(uint256 tokenId) external",
  "function withdrawNFT(uint256 tokenId, address receiver) external",
  "function getLockedTokenIds() external view returns (uint256[] memory)",
  "function getSnapshotValue(uint256 tokenId) external view returns (uint256)",
  "function lockedBy(uint256 tokenId) external view returns (address)",
  "function isLocked(uint256 tokenId) external view returns (bool)",
] as const;

export const loanAbi = [
  "function positions(uint256 tokenId) external view returns (uint256 debt, bool inPanic)",
  "function getCurrentLTV(uint256 tokenId) external view returns (uint256)",
  "function getDynamicMaxLTV() external view returns (uint256)",
  "function borrow(uint256 tokenId, uint256 amount) external",
  "function outstandingDebt(uint256 tokenId) external view returns (uint256)",
  "function isPanicMode(uint256 tokenId) external view returns (bool)",
  "function checkAndUpdatePanic(uint256 tokenId) external returns (bool)",
] as const;

export const routerAbi = [
  "function depositRevenue(uint256 tokenId) external payable",
  "function setBeneficiary(uint256 tokenId, address beneficiary) external",
] as const;

export const erc721Abi = [
  "function mint(address to, uint256 tokenId) external",
  "function approve(address to, uint256 tokenId) external",
  "function ownerOf(uint256 tokenId) external view returns (address)",
] as const;

export function hasAllAddresses(): boolean {
  return Boolean(ADDRESSES.oracle && ADDRESSES.vault && ADDRESSES.loan && ADDRESSES.router && ADDRESSES.nft);
}

export function getReadProvider(): JsonRpcProvider {
  const rpc = process.env.NEXT_PUBLIC_RPC_URL;
  if (!rpc) {
    throw new Error("NEXT_PUBLIC_RPC_URL missing");
  }
  return new JsonRpcProvider(rpc);
}

export function getBrowserProvider(): BrowserProvider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask not found");
  }
  return new BrowserProvider(window.ethereum);
}

export function getContracts(client: BrowserProvider | JsonRpcProvider | Signer) {
  return {
    oracle: new Contract(ADDRESSES.oracle, oracleAbi, client),
    vault: new Contract(ADDRESSES.vault, vaultAbi, client),
    loan: new Contract(ADDRESSES.loan, loanAbi, client),
    router: new Contract(ADDRESSES.router, routerAbi, client),
    nft: new Contract(ADDRESSES.nft, erc721Abi, client),
  };
}

export function shortAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider;
  }
}
