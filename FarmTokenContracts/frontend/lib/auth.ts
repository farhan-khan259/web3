"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";

function parseAdminList(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdmin(walletAddress: string): boolean {
  if (!walletAddress) {
    return false;
  }

  const raw =
    process.env.NEXT_PUBLIC_MULTISIG_OWNERS ||
    process.env.MULTISIG_OWNERS ||
    "";

  const admins = parseAdminList(raw);
  return admins.includes(walletAddress.trim().toLowerCase());
}

export function useUserAuth(): { isConnected: boolean; address?: string; isAdmin: boolean } {
  const { isConnected, address } = useAccount();

  const admin = useMemo(() => {
    if (!address) {
      return false;
    }
    return isAdmin(address);
  }, [address]);

  return {
    isConnected,
    address,
    isAdmin: admin,
  };
}
