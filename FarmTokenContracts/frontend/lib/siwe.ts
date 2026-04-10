import { SiweMessage } from "siwe";
import type { Address } from "viem";

export type SiweAuthResult = {
  token: string;
  expiresIn: number;
  walletAddress: string;
};

function backendBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:4000";
}

export async function fetchSiweNonce(baseUrl = backendBaseUrl()): Promise<string> {
  const res = await fetch(`${baseUrl}/auth/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    throw new Error("Failed to fetch SIWE nonce");
  }

  const json = await res.json();
  const nonce = String(json?.nonce || "").trim();
  if (!nonce) {
    throw new Error("SIWE nonce missing in backend response");
  }

  return nonce;
}

export function buildSiweMessage(params: {
  address: Address;
  chainId: number;
  nonce: string;
  statement?: string;
  domain?: string;
  uri?: string;
}): string {
  const domain = params.domain || (typeof window !== "undefined" ? window.location.host : "localhost");
  const uri = params.uri || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

  const message = new SiweMessage({
    domain,
    address: params.address,
    statement: params.statement || "Sign in with Ethereum to access admin endpoints.",
    uri,
    version: "1",
    chainId: params.chainId,
    nonce: params.nonce,
  });

  return message.prepareMessage();
}

export async function verifySiweSignature(params: {
  message: string;
  signature: string;
  baseUrl?: string;
}): Promise<SiweAuthResult> {
  const baseUrl = params.baseUrl || backendBaseUrl();

  const res = await fetch(`${baseUrl}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: params.message,
      signature: params.signature,
    }),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload?.error || "SIWE verification failed");
  }

  const json = await res.json();
  return {
    token: String(json?.token || ""),
    expiresIn: Number(json?.expiresIn || 0),
    walletAddress: String(json?.walletAddress || ""),
  };
}

export async function signInWithEthereumAdmin(params: {
  address: Address;
  chainId: number;
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>;
  statement?: string;
  baseUrl?: string;
}): Promise<SiweAuthResult> {
  const nonce = await fetchSiweNonce(params.baseUrl);

  const message = buildSiweMessage({
    address: params.address,
    chainId: params.chainId,
    nonce,
    statement: params.statement,
  });

  const signature = await params.signMessageAsync({ message });
  return verifySiweSignature({ message, signature, baseUrl: params.baseUrl });
}

export function authHeaderFromToken(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
  };
}
