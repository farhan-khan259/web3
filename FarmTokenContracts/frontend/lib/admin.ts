export function getConfiguredMultisigSigners(): string[] {
  const raw =
    process.env.NEXT_PUBLIC_MULTISIG_SIGNERS ||
    process.env.NEXT_PUBLIC_MULTISIG_WALLET_ADDRESS ||
    process.env.NEXT_PUBLIC_MULTISIG_WALLET_ADDRESS_LOCAL ||
    "";

  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isMultisigSigner(address?: string | null): boolean {
  if (!address) return false;
  const normalized = address.trim().toLowerCase();
  return getConfiguredMultisigSigners().includes(normalized);
}

export function getSubgraphUrl(): string {
  return process.env.NEXT_PUBLIC_SUBGRAPH_URL || "";
}

export type AnalyticsSeriesPoint = {
  label: string;
  tvl: number;
  revenue: number;
  volume: number;
  liquidations: number;
};

export type CollectionVolumePoint = {
  collection: string;
  value: number;
};

export type RevenueWaterfallPoint = {
  name: string;
  value: number;
};

export type AdminAnalytics = {
  tvlTrend7d: AnalyticsSeriesPoint[];
  tvlTrend30d: AnalyticsSeriesPoint[];
  loanVolumeByCollection: CollectionVolumePoint[];
  liquidationEvents: { label: string; count: number }[];
  revenueWaterfall: RevenueWaterfallPoint[];
  pendingProposals: number;
  totalRevenue: number;
};

export const DEMO_ADMIN_ANALYTICS: AdminAnalytics = {
  tvlTrend7d: [
    { label: "Mon", tvl: 1240, revenue: 42, volume: 3, liquidations: 0 },
    { label: "Tue", tvl: 1305, revenue: 44, volume: 2, liquidations: 1 },
    { label: "Wed", tvl: 1288, revenue: 46, volume: 4, liquidations: 0 },
    { label: "Thu", tvl: 1360, revenue: 48, volume: 5, liquidations: 1 },
    { label: "Fri", tvl: 1415, revenue: 52, volume: 4, liquidations: 0 },
    { label: "Sat", tvl: 1398, revenue: 55, volume: 6, liquidations: 1 },
    { label: "Sun", tvl: 1452, revenue: 58, volume: 7, liquidations: 0 },
  ],
  tvlTrend30d: Array.from({ length: 30 }, (_, index) => ({
    label: `D${index + 1}`,
    tvl: 1100 + index * 12 + (index % 4) * 30,
    revenue: 20 + index * 1.4,
    volume: 2 + (index % 6),
    liquidations: index % 9 === 0 ? 1 : 0,
  })),
  loanVolumeByCollection: [
    { collection: "Banksy Gorilla", value: 41 },
    { collection: "Crypto Punks", value: 28 },
    { collection: "Art Blocks", value: 17 },
    { collection: "Other", value: 14 },
  ],
  liquidationEvents: [
    { label: "Jan", count: 1 },
    { label: "Feb", count: 0 },
    { label: "Mar", count: 2 },
    { label: "Apr", count: 1 },
    { label: "May", count: 3 },
    { label: "Jun", count: 1 },
    { label: "Jul", count: 0 },
  ],
  revenueWaterfall: [
    { name: "Debt Service", value: 58 },
    { name: "Reserve", value: 22 },
    { name: "Treasury", value: 12 },
    { name: "License Holders", value: 8 },
  ],
  pendingProposals: 2,
  totalRevenue: 127.4,
};
