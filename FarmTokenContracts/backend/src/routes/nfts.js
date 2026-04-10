const express = require("express");
const { isAddress, getAddress } = require("ethers");

const DEFAULT_DEMO_WALLET = "0xc82A59594560A3010F336ebe2e9CC4794DCD46cf";
const RARE_MULTIPLIER = 1.5;
const STANDARD_MULTIPLIER = 1.0;

function normalizeWallet(wallet) {
  const candidate = String(wallet || "").trim();
  if (!candidate || !isAddress(candidate)) return "";
  return getAddress(candidate);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hexTokenIdToDecimalString(tokenIdHex) {
  try {
    if (!tokenIdHex) return "0";
    return BigInt(tokenIdHex).toString();
  } catch {
    return "0";
  }
}

function parseRareTokenSet(value) {
  if (!value) return new Set();
  return new Set(
    String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function parseOraclePriceOverrides(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function pickImageUrl(nft) {
  return (
    nft?.media?.[0]?.gateway ||
    nft?.media?.[0]?.thumbnail ||
    nft?.rawMetadata?.image ||
    nft?.metadata?.image ||
    ""
  );
}

async function fetchCollectionFloorPrice(apiKey, collectionAddress) {
  const floorUrl = `https://eth-mainnet.g.alchemy.com/nft/v2/${apiKey}/getFloorPrice?contractAddress=${collectionAddress}`;
  const floorResponse = await fetch(floorUrl);
  if (!floorResponse.ok) {
    throw new Error(`Alchemy getFloorPrice failed with status ${floorResponse.status}`);
  }

  const floorPayload = await floorResponse.json();
  const openSeaFloor = toNumber(floorPayload?.openSea?.floorPrice, 0);
  const looksRareFloor = toNumber(floorPayload?.looksRare?.floorPrice, 0);

  // Prefer OpenSea floor if available, otherwise fallback to LooksRare.
  return openSeaFloor > 0 ? openSeaFloor : looksRareFloor;
}

function createNftRoutes({ contracts, jsonError }) {
  const router = express.Router();

  router.get("/api/nfts/owned", async (request, response) => {
    try {
      const apiKey = String(process.env.ALCHEMY_API_KEY || "").trim();
      if (!apiKey) return jsonError(response, 500, "ALCHEMY_API_KEY is not configured");

      const collectionAddressRaw = String(
        process.env.COLLECTION_ADDRESS || process.env.NEXT_PUBLIC_COLLECTION_ADDRESS || ""
      ).trim();
      const collectionAddress = normalizeWallet(collectionAddressRaw);
      if (!collectionAddress) {
        return jsonError(response, 500, "COLLECTION_ADDRESS is missing or invalid");
      }

      const defaultWallet = normalizeWallet(process.env.TEST_WALLET_ADDRESS) || DEFAULT_DEMO_WALLET;
      const wallet = normalizeWallet(request.query.wallet) || defaultWallet;
      if (!wallet) return jsonError(response, 400, "Valid wallet query parameter is required");

      const rareTokenIds = parseRareTokenSet(request.query.rareTokenIds || process.env.RARE_TOKEN_IDS || "");
      const oraclePriceOverrides = parseOraclePriceOverrides(
        request.query.oraclePriceOverrides || process.env.ORACLE_PRICE_OVERRIDES_JSON || ""
      );

      const nftUrl =
        `https://eth-mainnet.g.alchemy.com/nft/v2/${apiKey}/getNFTsForOwner` +
        `?owner=${wallet}&contractAddresses[]=${collectionAddress}`;

      const nftResponse = await fetch(nftUrl);
      if (!nftResponse.ok) {
        return jsonError(response, 502, `Alchemy getNFTsForOwner failed with status ${nftResponse.status}`);
      }

      const nftPayload = await nftResponse.json();
      const ownedNfts = Array.isArray(nftPayload?.ownedNfts) ? nftPayload.ownedNfts : [];
      const floorPrice = await fetchCollectionFloorPrice(apiKey, collectionAddress).catch(() => 0);

      const items = await Promise.all(
        ownedNfts.map(async (nft) => {
          const tokenId = hexTokenIdToDecimalString(nft?.id?.tokenId);
          const rarityMultiplier = rareTokenIds.has(tokenId) ? RARE_MULTIPLIER : STANDARD_MULTIPLIER;
          const customOraclePrice = toNumber(oraclePriceOverrides[tokenId], 0);
          const basePrice = customOraclePrice > 0 ? customOraclePrice : floorPrice;
          const valuation = Number((basePrice * rarityMultiplier).toFixed(6));

          let isLocked = false;
          if (contracts?.vault) {
            try {
              isLocked = Boolean(await contracts.vault.isLocked(BigInt(tokenId)));
            } catch {
              isLocked = false;
            }
          }

          return {
            tokenId,
            imageUrl: pickImageUrl(nft),
            floorPrice,
            oraclePrice: customOraclePrice > 0 ? customOraclePrice : null,
            valuation,
            rarityMultiplier,
            isLocked,
          };
        })
      );

      return response.json({
        status: "ok",
        wallet,
        collectionAddress,
        total: items.length,
        items,
      });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to load owned NFTs from Alchemy");
    }
  });

  return router;
}

module.exports = {
  createNftRoutes,
};