import { isAddress } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import { getCollectionAllowlist, getProviderNetwork } from "../../../lib/contracts";

enum NFTType {
  NORMAL = "NORMAL",
  RARE = "RARE",
}

type OwnedNft = {
  contractAddress: string;
  tokenId: string;
};

type AlchemyRarityData = {
  minPrevalence: number | null;
  maxPrevalence: number | null;
  rareTraitCount: number;
};

type MirrorRow = {
  tokenId: string;
  contractAddress: string;
  nftType: NFTType;
  oracleName: "NormalOracle" | "RareOracle";
  oracleSource: string;
  oraclePriceEth: number | null;
  ltvEth: number | null;
  valuationError?: string;
  minTraitPrevalence: number | null;
  maxTraitPrevalence: number | null;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toDecimalTokenId(tokenId: string): string {
  if (tokenId.startsWith("0x")) {
    return BigInt(tokenId).toString();
  }
  return tokenId;
}

async function fetchOwnedNftsFromAlchemy(walletAddress: string): Promise<OwnedNft[]> {
  const apiKey = process.env.ALCHEMY_API_KEY || "demo";
  const network = getProviderNetwork();

  if (!network) {
    throw new Error("ALCHEMY_NFT_NETWORK is missing for the active network mode");
  }

  const base = `https://${network}.g.alchemy.com/nft/v3/${apiKey}`;
  const owned: OwnedNft[] = [];
  const allowlist = new Set(getCollectionAllowlist());

  let pageKey: string | undefined;
  for (;;) {
    const url = new URL(`${base}/getNFTsForOwner`);
    url.searchParams.set("owner", walletAddress);
    url.searchParams.set("withMetadata", "false");
    url.searchParams.set("pageSize", "100");
    if (pageKey) url.searchParams.set("pageKey", pageKey);

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Alchemy getNFTsForOwner failed: HTTP ${response.status}`);
    }

    const payload = await response.json();
    const batch = Array.isArray(payload?.ownedNfts) ? payload.ownedNfts : [];

    for (const nft of batch) {
      const contractAddress = String(nft?.contractAddress || nft?.contract?.address || "").toLowerCase();
      const tokenIdRaw = String(nft?.tokenId || "");
      if (!contractAddress || !tokenIdRaw) continue;
      if (Boolean(nft?.isSpam)) continue;
      if (allowlist.size > 0 && !allowlist.has(contractAddress)) continue;
      owned.push({
        contractAddress,
        tokenId: toDecimalTokenId(tokenIdRaw),
      });
    }

    if (!payload?.pageKey) break;
    pageKey = String(payload.pageKey);
  }

  return owned;
}

async function fetchCollectionFloorEth(contractAddress: string): Promise<number | null> {
  const apiKey = process.env.ALCHEMY_API_KEY || "demo";
  const network = getProviderNetwork();
  if (!network) {
    throw new Error("ALCHEMY_NFT_NETWORK is missing for the active network mode");
  }
  const url = new URL(`https://${network}.g.alchemy.com/nft/v3/${apiKey}/getFloorPrice`);
  url.searchParams.set("contractAddress", contractAddress);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const payload = await response.json();
  const openSeaFloor = toNumber(payload?.openSea?.floorPrice);
  const looksRareFloor = toNumber(payload?.looksRare?.floorPrice);

  if (openSeaFloor && openSeaFloor > 0) return openSeaFloor;
  if (looksRareFloor && looksRareFloor > 0) return looksRareFloor;
  return null;
}

async function fetchAlchemyRarityData(contractAddress: string, tokenId: string): Promise<AlchemyRarityData> {
  const apiKey = process.env.ALCHEMY_API_KEY || "demo";
  const network = getProviderNetwork();
  if (!network) {
    throw new Error("ALCHEMY_NFT_NETWORK is missing for the active network mode");
  }
  const url = new URL(`https://${network}.g.alchemy.com/nft/v3/${apiKey}/computeRarity`);
  url.searchParams.set("contractAddress", contractAddress);
  url.searchParams.set("tokenId", tokenId);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    return {
      minPrevalence: null,
      maxPrevalence: null,
      rareTraitCount: 0,
    };
  }

  const payload = await response.json();
  const rarities = Array.isArray(payload?.rarities) ? payload.rarities : [];
  const prevalences = rarities
    .map((entry: any) => toNumber(entry?.prevalence))
    .filter((entry: number | null): entry is number => entry !== null && entry >= 0 && entry <= 1);

  const rareTraitThreshold = Number(process.env.RARE_TRAIT_PREVALENCE_MAX || "0.05");
  return {
    minPrevalence: prevalences.length ? Math.min(...prevalences) : null,
    maxPrevalence: prevalences.length ? Math.max(...prevalences) : null,
    rareTraitCount: prevalences.filter((p: number) => p <= rareTraitThreshold).length,
  };
}

function classifyNftType(rarityData: AlchemyRarityData): NFTType {
  return rarityData.rareTraitCount > 0 ? NFTType.RARE : NFTType.NORMAL;
}

// Normal oracle: collection floor value from live marketplace data.
function normalOraclePriceEth(collectionFloorEth: number | null): { priceEth: number; source: string } {
  if (!collectionFloorEth || collectionFloorEth <= 0) {
    throw new Error("Normal oracle has no floor price");
  }

  return {
    priceEth: collectionFloorEth,
    source: "alchemy:getFloorPrice",
  };
}

// Rare oracle: floor value boosted by real trait rarity from Alchemy computeRarity.
function rareOraclePriceEth(
  rarityData: AlchemyRarityData,
  collectionFloorEth: number | null
): { priceEth: number; source: string } {
  if (!collectionFloorEth || collectionFloorEth <= 0) {
    throw new Error("Rare oracle has no base floor price");
  }

  const minPrevalence = rarityData.minPrevalence;
  if (!minPrevalence || minPrevalence <= 0) {
    return {
      priceEth: collectionFloorEth,
      source: "alchemy:getFloorPrice",
    };
  }

  const rarityBoost = 1 + (1 - minPrevalence);
  return {
    priceEth: collectionFloorEth * rarityBoost,
    source: "alchemy:getFloorPrice+computeRarity",
  };
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const walletAddress = String(payload?.walletAddress || "").trim();
    const ltvRatio = Number(payload?.ltvRatio || process.env.DEFAULT_LTV_RATIO || "0.5");

    if (!isAddress(walletAddress)) {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }

    if (!Number.isFinite(ltvRatio) || ltvRatio <= 0 || ltvRatio > 1) {
      return NextResponse.json({ error: "ltvRatio must be between 0 and 1" }, { status: 400 });
    }

    // NFT fetching and filtering: only allowlisted, non-spam NFTs are mirrored.
    const ownedNfts = await fetchOwnedNftsFromAlchemy(walletAddress);
    console.log("[MirrorAPI] ownedNFTCount", ownedNfts.length);
    if (ownedNfts.length > 0) {
      console.log("[MirrorAPI] firstOwnedNFT", ownedNfts[0]);
    }
    const floorCache = new Map<string, number | null>();
    const rows: MirrorRow[] = [];

    for (const nft of ownedNfts) {
      let collectionFloorEth = floorCache.get(nft.contractAddress);
      if (collectionFloorEth === undefined) {
        collectionFloorEth = await fetchCollectionFloorEth(nft.contractAddress);
        floorCache.set(nft.contractAddress, collectionFloorEth);
      }

      const rarityData = await fetchAlchemyRarityData(nft.contractAddress, nft.tokenId);
      const nftType = classifyNftType(rarityData);

      try {
        const oracleResult =
          nftType === NFTType.RARE
            ? rareOraclePriceEth(rarityData, collectionFloorEth)
            : normalOraclePriceEth(collectionFloorEth);

        // LTV calculation: borrowable value per NFT from oracle price and LTV ratio.
        const ltvEth = oracleResult.priceEth * ltvRatio;

        rows.push({
          tokenId: nft.tokenId,
          contractAddress: nft.contractAddress,
          nftType,
          oracleName: nftType === NFTType.RARE ? "RareOracle" : "NormalOracle",
          oracleSource: oracleResult.source,
          oraclePriceEth: oracleResult.priceEth,
          ltvEth,
          minTraitPrevalence: rarityData.minPrevalence,
          maxTraitPrevalence: rarityData.maxPrevalence,
        });
      } catch (oracleError) {
        rows.push({
          tokenId: nft.tokenId,
          contractAddress: nft.contractAddress,
          nftType,
          oracleName: nftType === NFTType.RARE ? "RareOracle" : "NormalOracle",
          oracleSource: "unavailable",
          oraclePriceEth: null,
          ltvEth: null,
          valuationError: (oracleError as Error).message,
          minTraitPrevalence: rarityData.minPrevalence,
          maxTraitPrevalence: rarityData.maxPrevalence,
        });
      }
    }

    const totalValueEth = rows.reduce((acc, row) => acc + (row.oraclePriceEth || 0), 0);
    const totalLtvEth = rows.reduce((acc, row) => acc + (row.ltvEth || 0), 0);

    console.log("[MirrorAPI] Wallet:", walletAddress);
    for (const row of rows) {
      console.log(
        `[MirrorAPI] token=${row.tokenId} contract=${row.contractAddress} type=${row.nftType} oracle=${row.oracleName} source=${row.oracleSource} valueEth=${row.oraclePriceEth?.toFixed(6) || "n/a"} ltvEth=${row.ltvEth?.toFixed(6) || "n/a"}${row.valuationError ? ` error=${row.valuationError}` : ""}`
      );
    }
    console.log(`[MirrorAPI] totals valueEth=${totalValueEth.toFixed(6)} ltvEth=${totalLtvEth.toFixed(6)} count=${rows.length}`);

    return NextResponse.json({
      walletAddress,
      ltvRatio,
      nftCount: rows.length,
      nfts: rows,
      totals: {
        totalValueEth,
        totalLtvEth,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || "Mirror fetch failed" },
      { status: 500 }
    );
  }
}
