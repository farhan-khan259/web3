import { ethers } from "ethers";

export function getProvider() {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
  if (!rpcUrl) {
    throw new Error("NEXT_PUBLIC_RPC_URL is missing");
  }
  return new ethers.JsonRpcProvider(rpcUrl);
}

export function getWallet() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    throw new Error("PRIVATE_KEY is missing");
  }
  return new ethers.Wallet(pk, getProvider());
}

export function getOracleContract(abi, signerOrProvider) {
  const oracleAddress = process.env.NEXT_PUBLIC_ORACLE_ADDRESS;
  if (!oracleAddress) {
    throw new Error("NEXT_PUBLIC_ORACLE_ADDRESS is missing");
  }
  return new ethers.Contract(oracleAddress, abi, signerOrProvider || getProvider());
}
