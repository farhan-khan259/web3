import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http, webSocket } from "wagmi";
import * as wagmiChains from "wagmi/chains";
import {
  hardhat as viemHardhat,
  mainnet as viemMainnet,
  sepolia as viemSepolia,
} from "viem/chains";
import { createPublicClient } from "viem";

const projectId =
  process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID ||
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
  "d390561164256cbb34b54970b33f6f01";

// Requested imports are from wagmi/chains. Some toolchains expose chains via viem/chains,
// so we safely fall back to viem exports when needed.
const mainnet = (wagmiChains as any).mainnet ?? viemMainnet;
const sepolia = (wagmiChains as any).sepolia ?? viemSepolia;
const hardhat = (wagmiChains as any).hardhat ?? viemHardhat;

// Requested runtime chains: mainnet + sepolia + local hardhat
export const chains = [mainnet, sepolia, hardhat] as const;

const appMetadata = {
  appName: "NFT Credit Engine",
  appDescription: "Institutional NFT credit protocol with Ballet wallet support via WalletConnect",
  appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  appIcon: process.env.NEXT_PUBLIC_APP_ICON || "https://example.com/icon.png",
};

const mainnetHttpUrl =
  process.env.NEXT_PUBLIC_RPC_URL_MAINNET ||
  process.env.NEXT_PUBLIC_RPC_URL ||
  mainnet.rpcUrls.default.http[0] ||
  "https://ethereum.publicnode.com";

const hardhatHttpUrl = process.env.NEXT_PUBLIC_RPC_URL_LOCAL || "http://127.0.0.1:8545";

const mainnetWsUrl =
  process.env.NEXT_PUBLIC_WS_URL_MAINNET ||
  (mainnetHttpUrl.startsWith("https://")
    ? mainnetHttpUrl.replace("https://", "wss://")
    : mainnetHttpUrl.startsWith("http://")
      ? mainnetHttpUrl.replace("http://", "ws://")
      : "");

export const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(mainnetHttpUrl),
});

export const webSocketPublicClient = createPublicClient({
  chain: mainnet,
  transport: mainnetWsUrl ? webSocket(mainnetWsUrl) : http(mainnetHttpUrl),
});

// Keep this lightweight marker for compatibility without eagerly initializing WalletConnect.
export const rainbowKitDefaultConfig = {
  appName: appMetadata.appName,
  projectId: projectId || "",
  chains: [mainnet, sepolia, hardhat],
  ssr: true,
};

// Ballet wallet uses WalletConnect, so keep WalletConnect as the only connector.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Primary",
      wallets: [walletConnectWallet],
    },
  ],
  {
    appName: appMetadata.appName,
    projectId,
  }
);

export const wagmiConfig = createConfig({
  chains,
  ssr: true,
  connectors,
  // Requested explicit clients are exported above; wagmi v2 uses transports in config.
  transports: {
    [mainnet.id]: http(mainnetHttpUrl),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL_TESTNET || sepolia.rpcUrls.default.http[0]),
    [hardhat.id]: http(hardhatHttpUrl),
  },
});
