"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { type Address, parseEther } from "viem";
import { ADDRESSES, licenseAbi } from "../../../lib/contracts";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";

type LicenseListing = {
  id: string;
  tokenId: number;
  durationDays: number;
  price: number;
  currency: "ETH" | "USDC";
  licenseType: number;
  territory: number;
  trademarkRef: string;
  nftCollectionId: number;
};

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

export default function LicenseMarketplacePage() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [listings, setListings] = useState<LicenseListing[]>([]);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadListings() {
      setLoading(true);
      setError("");

      try {
        const res = await fetch("/api/licenses/available", { cache: "no-store" });
        if (!res.ok) {
          throw new Error("Failed to load license listings");
        }

        const json = await res.json();
        const rows = (json?.licenses ?? json?.items ?? json ?? []).map((item: any, idx: number) => ({
          id: String(item?.id ?? `${item?.tokenId ?? "license"}-${idx}`),
          tokenId: Number(item?.tokenId ?? 0),
          durationDays: Number(item?.durationDays ?? 30),
          price: toNumber(item?.price ?? 0),
          currency: String(item?.currency ?? "ETH").toUpperCase() === "USDC" ? "USDC" : "ETH",
          licenseType: Number(item?.licenseType ?? 1),
          territory: Number(item?.territory ?? 1),
          trademarkRef: String(item?.trademarkRef ?? "UKIPO-REF-0001"),
          nftCollectionId: Number(item?.nftCollectionId ?? 1),
        })) as LicenseListing[];

        if (mounted) {
          setListings(rows);
        }
      } catch (err) {
        if (mounted) {
          setError((err as Error).message || "Failed to load marketplace");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadListings();
    return () => {
      mounted = false;
    };
  }, []);

  const hasListings = useMemo(() => listings.length > 0, [listings]);

  async function buyLicense(license: LicenseListing) {
    if (!address) {
      return;
    }

    setBuyingId(license.id);
    setToast(null);
    setError("");

    try {
      await writeContractAsync({
        abi: licenseAbi,
        address: ADDRESSES.licenseToken as Address,
        functionName: "mintLicense",
        args: [
          address as Address,
          BigInt(license.nftCollectionId),
          BigInt(license.tokenId),
          BigInt(license.durationDays),
          BigInt(license.licenseType),
          BigInt(license.territory),
          license.trademarkRef,
        ],
        // ETH pricing forwards value into protocol revenue flow (RevenueDistributor path on contract side).
        value: license.currency === "ETH" ? parseEther(String(license.price)) : undefined,
      } as never);

      setToast({ kind: "success", message: `License purchased for token #${license.tokenId}.` });
    } catch (err) {
      setToast({ kind: "error", message: (err as Error).message || "License purchase failed" });
    } finally {
      setBuyingId(null);
    }
  }

  if (!isConnected || !address) {
    return (
      <section className="mx-auto max-w-6xl p-6">
        <h1 className="text-3xl font-semibold">License Marketplace</h1>
        <p className="mt-2 text-sm opacity-80">Connect your wallet to browse and buy licenses.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold">License Marketplace</h1>
        <p className="mt-2 text-sm opacity-80">Available ERC-1155 licenses minted by admin.</p>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-rose-300">{error}</CardContent>
        </Card>
      ) : null}

      {toast ? (
        <Card>
          <CardContent className={`pt-6 text-sm ${toast.kind === "success" ? "text-emerald-300" : "text-rose-300"}`}>
            {toast.message}
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Skeleton key={idx} className="h-52 w-full" />
          ))}
        </div>
      ) : hasListings ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {listings.map((license) => (
            <Card key={license.id}>
              <CardHeader>
                <CardTitle className="text-lg">Token #{license.tokenId}</CardTitle>
                <CardDescription>License duration and payment terms</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between"><span>Duration</span><strong>{license.durationDays} days</strong></div>
                <div className="flex justify-between"><span>Price</span><strong>{license.price} {license.currency}</strong></div>
                <div className="flex justify-between"><span>Applies To NFT</span><Badge variant="secondary">#{license.tokenId}</Badge></div>

                <Button
                  className="w-full"
                  onClick={() => buyLicense(license)}
                  disabled={buyingId === license.id}
                >
                  {buyingId === license.id ? "Buying..." : "Buy License"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6 text-sm opacity-80">No active license listings right now.</CardContent>
        </Card>
      )}
    </section>
  );
}
