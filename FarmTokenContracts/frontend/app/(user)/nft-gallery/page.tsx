"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { getBackendBaseUrl } from "../../../lib/contracts";

type LockFilter = "all" | "locked" | "unlocked";

type OraclePayload = {
  floorPrice?: number | string;
  floorEth?: number | string;
  rarityMultiplier?: number | string;
  locked?: boolean;
};

type NftCardItem = {
  tokenId: string;
  imageUrl: string;
  floorPriceEth: number;
  rarityMultiplier: number;
  isLocked: boolean;
};

const COLLECTION_ADDRESS = "0x0c06d6a17eb208a9bc7bd698eb6f22379209e3a4";
const PAGE_SIZE = 12;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

function normalizeTokenId(raw: any): string {
  const fromNested = raw?.id?.tokenId;
  const tokenIdRaw = raw?.tokenId ?? fromNested ?? "0";
  if (typeof tokenIdRaw === "string" && tokenIdRaw.startsWith("0x")) {
    return String(parseInt(tokenIdRaw, 16));
  }
  return String(tokenIdRaw);
}

function resolveImageUrl(raw: any): string {
  return (
    raw?.image?.cachedUrl ||
    raw?.image?.thumbnailUrl ||
    raw?.image?.pngUrl ||
    raw?.image?.originalUrl ||
    raw?.rawMetadata?.image ||
    "https://placehold.co/480x480/111827/e5e7eb?text=No+Image"
  );
}

export default function NftGalleryPage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<NftCardItem[]>([]);
  const [filter, setFilter] = useState<LockFilter>("all");
  const [page, setPage] = useState(1);

  const baseUrl = useMemo(() => getBackendBaseUrl(), []);

  useEffect(() => {
    let mounted = true;

    async function loadGallery() {
      if (!address) {
        setItems([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const [ownedRes, collateralRes] = await Promise.all([
          fetch(
            `/api/nfts/owned?wallet=${encodeURIComponent(address)}&collection=${encodeURIComponent(COLLECTION_ADDRESS)}`,
            { cache: "no-store" }
          ),
          fetch(`/api/user/collateral?wallet=${encodeURIComponent(address)}`, { cache: "no-store" }),
        ]);

        if (!ownedRes.ok) {
          throw new Error("Failed to load owned NFTs");
        }

        const ownedJson = await ownedRes.json();
        const collateralJson = collateralRes.ok ? await collateralRes.json() : {};

        const ownedNfts = ownedJson?.nfts ?? ownedJson?.ownedNfts ?? ownedJson ?? [];
        const lockedRows = collateralJson?.rows ?? collateralJson?.lockedNfts ?? [];
        const lockedTokenIds = new Set<string>(lockedRows.map((row: any) => String(row?.tokenId)));

        const normalized = ownedNfts.map((nft: any) => ({
          tokenId: normalizeTokenId(nft),
          imageUrl: resolveImageUrl(nft),
        }));

        const oracleResults = await Promise.allSettled(
          normalized.map((nft: { tokenId: string }) => fetch(`/api/oracle/latest/${nft.tokenId}`, { cache: "no-store" }))
        );

        const nextItems: NftCardItem[] = [];

        for (let i = 0; i < normalized.length; i++) {
          const nft = normalized[i];
          const oracleResult = oracleResults[i];

          let oracleData: OraclePayload = {};
          if (oracleResult.status === "fulfilled" && oracleResult.value.ok) {
            oracleData = await oracleResult.value.json();
          }

          const rarityMultiplier = toNumber(oracleData?.rarityMultiplier ?? 1);
          const floorPriceEth = toNumber(oracleData?.floorPrice ?? oracleData?.floorEth ?? 0);
          const isLocked = Boolean(oracleData?.locked) || lockedTokenIds.has(nft.tokenId);

          nextItems.push({
            tokenId: nft.tokenId,
            imageUrl: nft.imageUrl,
            floorPriceEth,
            rarityMultiplier,
            isLocked,
          });
        }

        if (mounted) {
          setItems(nextItems);
          setPage(1);
        }
      } catch (err) {
        if (mounted) {
          setError((err as Error).message || "Failed to load NFT gallery");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadGallery();
    return () => {
      mounted = false;
    };
  }, [address, baseUrl]);

  const filtered = useMemo(() => {
    if (filter === "locked") return items.filter((item) => item.isLocked);
    if (filter === "unlocked") return items.filter((item) => !item.isLocked);
    return items;
  }, [items, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  function goToLock(tokenId: string) {
    router.push(`/vault-deposit?tokenId=${encodeURIComponent(tokenId)}`);
  }

  if (!isConnected || !address) {
    return (
      <section className="mx-auto max-w-7xl p-6">
        <h1 className="text-3xl font-semibold">NFT Gallery</h1>
        <p className="mt-2 text-sm opacity-80">Connect your wallet to load NFTs from the Banksy collection.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">NFT Gallery</h1>
          <p className="mt-1 text-sm opacity-80">Collection: {COLLECTION_ADDRESS}</p>
        </div>
        <div className="flex gap-2">
          <Button variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All</Button>
          <Button variant={filter === "locked" ? "default" : "outline"} onClick={() => setFilter("locked")}>Locked</Button>
          <Button variant={filter === "unlocked" ? "default" : "outline"} onClick={() => setFilter("unlocked")}>Unlocked</Button>
        </div>
      </div>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, idx) => (
            <Skeleton key={idx} className="h-80 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {pagedItems.map((item) => (
              <Card key={item.tokenId}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    <span>Token #{item.tokenId}</span>
                    {item.rarityMultiplier > 1 ? <Badge variant="warning">Rare</Badge> : null}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <img
                    src={item.imageUrl}
                    alt={`NFT ${item.tokenId}`}
                    className="h-48 w-full rounded-lg border object-cover"
                  />
                  <div className="mt-3 space-y-1 text-sm">
                    <div>Floor Price: {item.floorPriceEth.toFixed(4)} ETH</div>
                    <div>Rarity Multiplier: {item.rarityMultiplier.toFixed(2)}x</div>
                    <div className="flex items-center gap-2">
                      <span>Status:</span>
                      <Badge variant={item.isLocked ? "success" : "secondary"}>
                        {item.isLocked ? "Locked" : "Unlocked"}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-4">
                    {item.isLocked ? (
                      <Button disabled className="w-full">Already Locked</Button>
                    ) : (
                      <Button className="w-full" onClick={() => goToLock(item.tokenId)}>
                        Lock in Vault
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              variant="outline"
              disabled={currentPage <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Previous
            </Button>
            <span className="text-sm opacity-80">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
