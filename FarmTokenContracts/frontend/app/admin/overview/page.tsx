"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useBalance, useReadContract, useWriteContract } from "wagmi";
import { type Address, formatEther, parseEther } from "viem";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowRightLeft,
  Activity,
  CheckCircle2,
  ClipboardList,
  Download,
  Flame,
  Lock,
  PauseCircle,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  Waves,
} from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { ADDRESSES, getBackendBaseUrl, loanAbi, oracleAbi, vaultAbi } from "../../../lib/contracts";
import { DEMO_ADMIN_ANALYTICS, getConfiguredMultisigSigners, getSubgraphUrl, isMultisigSigner, type AdminAnalytics } from "../../../lib/admin";

const adminLoanAbi = [
  ...loanAbi,
  "function setPanicThresholdBps(uint256 newThresholdBps) external",
  "function updateHealthFactor(uint256 tokenId) external returns (bool)",
  "function setRevenueDistributor(address newDistributor) external",
  "function setMultisigWallet(address newWallet) external",
] as const;

const adminOracleAbi = [
  ...oracleAbi,
  "function setVolatility(uint256 newVolatility) external",
  "function setScores(uint256 rightsId, uint256 rarity, uint256 utility, uint256 distribution) external",
] as const;

type RiskState = "green" | "yellow" | "red";

type AlertItem = {
  id: string;
  title: string;
  detail: string;
  tone: RiskState;
};

type TokenMetrics = {
  tokenId: number;
  collection: string;
  collectionAddress: string;
  floorEth: number;
  liquidationValueEth: number;
  debtEth: number;
  ltvPercent: number;
  healthFactor: number;
  panic: boolean;
  riskStatus: RiskState;
  staleFeed: boolean;
};

const COLLECTION_LABEL = "Banksy Gorilla in a Pink Mask";
const COLLECTION_ADDRESS = "0x0c06d6a17eb208a9bc7bd698eb6f22379209e3a4";
const PIE_COLORS = ["#38bdf8", "#f59e0b", "#f97316", "#22c55e"];
const STATUS_COLORS = {
  green: "text-emerald-300",
  yellow: "text-amber-300",
  red: "text-rose-300",
} as const;

function fmtUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function fmtPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function normalizeHealthFactor(ltvPercent: number) {
  if (ltvPercent <= 0) return 99.99;
  return Math.max(0, 100 / Math.max(1, ltvPercent));
}

function computeRiskState(ltvPercent: number, panic: boolean, staleFeed: boolean): RiskState {
  if (panic || ltvPercent >= 85 || staleFeed) return "red";
  if (ltvPercent >= 60) return "yellow";
  return "green";
}

function tokenToRow(metrics: TokenMetrics[], ethUsd: number) {
  const totalCollateralEth = metrics.reduce((sum, item) => sum + item.liquidationValueEth, 0);
  const totalDebt = metrics.reduce((sum, item) => sum + item.debtEth, 0);
  const panicCount = metrics.filter((item) => item.panic).length;
  const staleCount = metrics.filter((item) => item.staleFeed).length;
  const activeLoansCount = metrics.filter((item) => item.debtEth > 0).length;
  const revenueGenerated = metrics.reduce((sum, item) => sum + Math.max(0, item.debtEth * 0.07), 0);
  const averageHealth = metrics.length ? metrics.reduce((sum, item) => sum + item.healthFactor, 0) / metrics.length : 0;

  return {
    tvl: totalCollateralEth,
    tvlUsd: totalCollateralEth * ethUsd,
    debt: totalDebt,
    borrowPower: metrics.reduce((sum, item) => sum + Math.max(0, item.liquidationValueEth * 0.6 - item.debtEth), 0),
    panicCount,
    activeLoansCount,
    staleCount,
    revenueGenerated,
    averageHealth,
  };
}

async function safeJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function loadAnalytics(): Promise<AdminAnalytics> {
  const subgraphUrl = getSubgraphUrl();
  const backendBase = getBackendBaseUrl();

  if (subgraphUrl) {
    try {
      const response = await fetch(subgraphUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `query AdminOverview {
            tvlSnapshots: tvlSnapshots(first: 30, orderBy: timestamp, orderDirection: asc) {
              label
              tvl
              revenue
              volume
              liquidations
            }
            loanVolumeByCollection: loanVolumeByCollections(first: 10, orderBy: value, orderDirection: desc) {
              collection
              value
            }
            liquidationEvents: liquidationEvents(first: 12, orderBy: timestamp, orderDirection: asc) {
              label
              count
            }
            revenueWaterfall: revenueWaterfall(first: 4, orderBy: value, orderDirection: desc) {
              name
              value
            }
            pendingProposals
            totalRevenue
          }`,
        }),
      });
      const payload = await safeJson<any>(response);
      const data = payload?.data || payload || {};
      if (data?.tvlSnapshots?.length) {
        return {
          tvlTrend7d: data.tvlSnapshots.slice(-7),
          tvlTrend30d: data.tvlSnapshots.slice(-30),
          loanVolumeByCollection: data.loanVolumeByCollection || DEMO_ADMIN_ANALYTICS.loanVolumeByCollection,
          liquidationEvents: data.liquidationEvents || DEMO_ADMIN_ANALYTICS.liquidationEvents,
          revenueWaterfall: data.revenueWaterfall || DEMO_ADMIN_ANALYTICS.revenueWaterfall,
          pendingProposals: Number(data.pendingProposals || 0),
          totalRevenue: Number(data.totalRevenue || 0),
        };
      }
    } catch {
      // Fall through to backend/default demo data.
    }
  }

  try {
    const response = await fetch(`${backendBase}/analytics/admin`, { cache: "no-store" });
    const payload = await safeJson<any>(response);
    const data = payload?.data || payload || {};
    if (response.ok && data?.tvlTrend7d) {
      return {
        tvlTrend7d: data.tvlTrend7d,
        tvlTrend30d: data.tvlTrend30d || DEMO_ADMIN_ANALYTICS.tvlTrend30d,
        loanVolumeByCollection: data.loanVolumeByCollection || DEMO_ADMIN_ANALYTICS.loanVolumeByCollection,
        liquidationEvents: data.liquidationEvents || DEMO_ADMIN_ANALYTICS.liquidationEvents,
        revenueWaterfall: data.revenueWaterfall || DEMO_ADMIN_ANALYTICS.revenueWaterfall,
        pendingProposals: Number(data.pendingProposals || 0),
        totalRevenue: Number(data.totalRevenue || 0),
      };
    }
  } catch {
    // Ignore and use demo data.
  }

  return DEMO_ADMIN_ANALYTICS;
}

function MetricCard({
  title,
  value,
  description,
  icon,
  tone = "green",
}: {
  title: string;
  value: string;
  description: string;
  icon: ReactNode;
  tone?: RiskState;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className={STATUS_COLORS[tone]}>{icon}</span>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function TokenReader({ tokenId, onResolved }: { tokenId: number; onResolved: (metrics: TokenMetrics) => void }) {
  const enabled = Boolean(ADDRESSES.vault && ADDRESSES.oracle && ADDRESSES.loan);
  const { data: snapshotValue } = useReadContract({
    abi: vaultAbi,
    address: ADDRESSES.vault as Address,
    functionName: "getSnapshotValue",
    args: [BigInt(tokenId)],
    query: { enabled },
  });
  const { data: panicStatus } = useReadContract({
    abi: adminLoanAbi,
    address: ADDRESSES.loan as Address,
    functionName: "getPanicStatus",
    args: [BigInt(tokenId)],
    query: { enabled },
  });
  const { data: debt } = useReadContract({
    abi: loanAbi,
    address: ADDRESSES.loan as Address,
    functionName: "outstandingDebt",
    args: [BigInt(tokenId)],
    query: { enabled },
  });
  const { data: valuations } = useReadContract({
    abi: oracleAbi,
    address: ADDRESSES.oracle as Address,
    functionName: "getValuations",
    args: [BigInt(tokenId)],
    query: { enabled },
  });
  const { data: riskStatus } = useReadContract({
    abi: oracleAbi,
    address: ADDRESSES.oracle as Address,
    functionName: "getRiskStatus",
    args: [BigInt(tokenId)],
    query: { enabled },
  });
  const { data: floorValue } = useReadContract({
    abi: oracleAbi,
    address: ADDRESSES.oracle as Address,
    functionName: "getFloorValue",
    args: [BigInt(tokenId)],
    query: { enabled },
  });

  useEffect(() => {
    if (snapshotValue === undefined || debt === undefined || !valuations || !panicStatus) return;

    const [isPanic, currentLtvBps, panicThresholdBps] = panicStatus as unknown as [boolean, bigint, bigint];
    const liquidationValueEth = Number(formatEther((valuations as { liquidationValue: bigint }).liquidationValue));
    const appraisalValueEth = Number(formatEther((valuations as { appraisalValue: bigint }).appraisalValue));
    const debtEth = Number(formatEther(debt as bigint));
    const ltvPercent = liquidationValueEth > 0 ? (debtEth / liquidationValueEth) * 100 : 0;
    const staleFeed = Boolean(riskStatus) && ltvPercent > 90;
    const risk = computeRiskState(ltvPercent, isPanic, staleFeed);

    onResolved({
      tokenId,
      collection: COLLECTION_LABEL,
      collectionAddress: COLLECTION_ADDRESS,
      floorEth: Number(formatEther((floorValue as bigint) || 0n)),
      liquidationValueEth,
      debtEth,
      ltvPercent,
      healthFactor: Number(ltvPercent > 0 ? (10000 / Math.max(1, ltvPercent)).toFixed(2) : 99.99),
      panic: isPanic,
      riskStatus: risk,
      staleFeed: Boolean(currentLtvBps > panicThresholdBps),
    });
  }, [snapshotValue, debt, valuations, panicStatus, floorValue, riskStatus, onResolved, tokenId]);

  return null;
}

function PanicListItem({ item }: { item: TokenMetrics }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold">{item.collection} #{item.tokenId}</div>
          <div className="text-xs text-slate-400">{item.collectionAddress}</div>
        </div>
        <Badge variant={item.riskStatus === "red" ? "danger" : item.riskStatus === "yellow" ? "warning" : "success"}>
          {item.riskStatus.toUpperCase()}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-300">
        <div>Debt: {item.debtEth.toFixed(4)} ETH</div>
        <div>Floor: {item.floorEth.toFixed(4)} ETH</div>
        <div>LTV: {fmtPercent(item.ltvPercent)}</div>
        <div>Health: {item.healthFactor.toFixed(2)}</div>
      </div>
    </div>
  );
}

export default function AdminOverviewPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { data: nativeBalance } = useBalance({ address: address as Address | undefined, query: { enabled: Boolean(address) } });
  const { writeContractAsync, isPending } = useWriteContract();
  const auditRef = useRef<HTMLDivElement | null>(null);

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [analytics, setAnalytics] = useState<AdminAnalytics>(DEMO_ADMIN_ANALYTICS);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [metricsByToken, setMetricsByToken] = useState<Record<number, TokenMetrics>>({});
  const [selectedRange, setSelectedRange] = useState<"7d" | "30d">("7d");
  const [panicThresholdBps, setPanicThresholdBps] = useState("6000");
  const [oracleVolatility, setOracleVolatility] = useState("85");
  const [toastMessage, setToastMessage] = useState<string>("Awaiting multisig authentication.");

  const multisigSigners = useMemo(() => getConfiguredMultisigSigners(), []);
  const tokenIds = useReadContract({
    abi: vaultAbi,
    address: ADDRESSES.vault as Address,
    functionName: "getLockedRightIds",
    args: undefined,
    query: { enabled: Boolean(ADDRESSES.vault), refetchInterval: 20_000 },
  }).data as bigint[] | undefined;
  const ethUsdWei = useReadContract({
    abi: oracleAbi,
    address: ADDRESSES.oracle as Address,
    functionName: "getEthUsdPriceE18",
    args: undefined,
    query: { enabled: Boolean(ADDRESSES.oracle), refetchInterval: 30_000 },
  }).data as bigint | undefined;

  const ethUsd = Number(formatEther(ethUsdWei ?? 0n));
  const tokens = useMemo(() => (tokenIds ?? []).map((id) => Number(id)), [tokenIds]);
  const tokenMetrics = useMemo(() => Object.values(metricsByToken).sort((a, b) => a.tokenId - b.tokenId), [metricsByToken]);

  useEffect(() => {
    if (!address) {
      setCheckingAuth(true);
      return;
    }

    const authorized = isMultisigSigner(address);
    setCheckingAuth(false);
    if (!authorized) {
      setToastMessage("Unauthorized wallet. Redirecting to dashboard.");
      const timer = window.setTimeout(() => router.replace("/"), 600);
      return () => window.clearTimeout(timer);
    }

    setToastMessage(`Authenticated as multisig signer ${address}`);
    return undefined;
  }, [address, router]);

  useEffect(() => {
    let mounted = true;
    setAnalyticsLoading(true);
    loadAnalytics()
      .then((next) => {
        if (!mounted) return;
        setAnalytics(next);
      })
      .finally(() => {
        if (mounted) setAnalyticsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const aggregate = useMemo(() => {
    const totalCollateral = tokenMetrics.reduce((sum, item) => sum + item.liquidationValueEth, 0);
    const activeLoans = tokenMetrics.filter((item) => item.debtEth > 0).length;
    const panicTokens = tokenMetrics.filter((item) => item.panic);
    const staleFeeds = tokenMetrics.filter((item) => item.staleFeed);
    const healthScore = tokenMetrics.length ? tokenMetrics.reduce((sum, item) => sum + item.healthFactor, 0) / tokenMetrics.length : 0;
    const oracleHealth: RiskState = panicTokens.length > 0 || staleFeeds.length > 0 ? (panicTokens.length > 2 ? "red" : "yellow") : "green";

    return {
      tvl: totalCollateral,
      tvlUsd: totalCollateral * ethUsd,
      activeLoans,
      panicTokens,
      staleFeeds,
      revenue: analytics.totalRevenue,
      pendingProposals: analytics.pendingProposals,
      oracleHealth,
      healthScore,
    };
  }, [analytics.pendingProposals, analytics.totalRevenue, ethUsd, tokenMetrics]);

  const tvlSeries = selectedRange === "7d" ? analytics.tvlTrend7d : analytics.tvlTrend30d;

  async function writeAndLog(label: string, params: any, successDetail: string) {
    try {
      await writeContractAsync(params);
      setToastMessage(successDetail);
    } catch (error) {
      setToastMessage(`${label} failed: ${(error as Error).message}`);
    }
  }

  const triggerEmergencyPause = async () => {
    await writeAndLog(
      "Emergency pause proposal",
      {
        abi: adminLoanAbi,
        address: ADDRESSES.loan as Address,
        functionName: "setPanicThresholdBps",
        args: [BigInt(panicThresholdBps || "6000")],
      },
      `Emergency pause proposal broadcast with threshold ${panicThresholdBps}bps`
    );
  };

  const updateLtvParameters = async () => {
    await writeAndLog(
      "Update LTV parameters",
      {
        abi: adminLoanAbi,
        address: ADDRESSES.loan as Address,
        functionName: "setPanicThresholdBps",
        args: [BigInt(panicThresholdBps || "6000")],
      },
      `LTV threshold updated to ${panicThresholdBps}bps`
    );
  };

  const triggerOracleUpdate = async () => {
    await writeAndLog(
      "Trigger oracle update",
      {
        abi: adminOracleAbi,
        address: ADDRESSES.oracle as Address,
        functionName: "setVolatility",
        args: [BigInt(oracleVolatility || "85")],
      },
      `Oracle volatility updated to ${oracleVolatility}`
    );
  };

  const viewAuditLogs = () => {
    auditRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setToastMessage("Audit logs opened.");
  };

  if (checkingAuth) {
    return (
      <main className="space-y-6 text-slate-100">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Lock className="h-4 w-4" /> Admin authentication</CardTitle>
            <CardDescription>Verifying multisig signer access.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-3/4" />
            <div className="text-sm text-slate-400">{toastMessage}</div>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!isConnected || !address) {
    return (
      <main className="space-y-6 text-slate-100">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Lock className="h-4 w-4" /> Admin authentication required</CardTitle>
            <CardDescription>Connect a multisig signer wallet to continue.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ConnectButton />
            <div className="text-sm text-slate-400">{toastMessage}</div>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!isMultisigSigner(address)) {
    return (
      <main className="space-y-6 text-slate-100">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-rose-300" /> Unauthorized wallet</CardTitle>
            <CardDescription>This dashboard is only accessible to multisig signers.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-slate-300">Connected wallet: {address}</div>
            <div className="mt-2 text-sm text-slate-400">Authorized signers: {multisigSigners.length ? multisigSigners.map((signer) => signer.slice(0, 10)).join(", ") : "not configured"}</div>
            <div className="mt-4 text-sm text-slate-400">{toastMessage}</div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="space-y-6 text-slate-100">
      <section className="rounded-[1.5rem] border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-950 to-cyan-950/20 p-6 shadow-[0_30px_120px_rgba(0,0,0,0.35)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100">
              <ShieldCheck className="h-3.5 w-3.5" /> Multisig-only admin dashboard
            </div>
            <h1 className="text-4xl font-semibold tracking-tight">Admin Dashboard Overview</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              Real-time governance overview with contract reads, backend analytics, and subgraph-backed history.
              All actions shown here are intended for multisig signers only.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <ConnectButton showBalance accountStatus="avatar" chainStatus="icon" />
            <div className="mt-3 text-xs text-slate-400">Balance: {nativeBalance ? `${nativeBalance.formatted} ${nativeBalance.symbol}` : "0.0000 ETH"}</div>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="success">Authenticated</Badge>
            <span>{address}</span>
            <span className="text-slate-500">|</span>
            <span>Configured signers: {multisigSigners.length || 0}</span>
          </div>
          <div className="mt-2 text-slate-400">{toastMessage}</div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard title="Total Value Locked" value={`${aggregate.tvl.toFixed(4)} ETH`} description={fmtUsd(aggregate.tvlUsd)} icon={<Waves className="h-4 w-4" />} tone={aggregate.oracleHealth as RiskState} />
        <MetricCard title="Active Loans Count" value={String(aggregate.activeLoans)} description={`${tokenMetrics.length} locked NFTs monitored`} icon={<ArrowRightLeft className="h-4 w-4" />} tone="green" />
        <MetricCard title="NFTs in Panic Mode" value={String(aggregate.panicTokens.length)} description={`${aggregate.staleFeeds.length} stale feeds in the same alert set`} icon={<Flame className="h-4 w-4" />} tone={aggregate.panicTokens.length ? "red" : "green"} />
        <MetricCard title="Total Revenue Generated" value={`${analytics.totalRevenue.toFixed(2)} ETH`} description="Aggregated from analytics backend / subgraph" icon={<Activity className="h-4 w-4" />} tone="green" />
        <MetricCard title="Oracle Health Status" value={aggregate.oracleHealth.toUpperCase()} description={aggregate.panicTokens.length ? "Active risk signals present" : "Feeds and risk status normal"} icon={<ShieldAlert className="h-4 w-4" />} tone={aggregate.oracleHealth as RiskState} />
        <MetricCard title="Pending Multisig Proposals" value={String(aggregate.pendingProposals)} description="Governance queue tracked via analytics backend" icon={<ClipboardList className="h-4 w-4" />} tone={aggregate.pendingProposals > 0 ? "yellow" : "green"} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>TVL Trend</CardTitle>
            <CardDescription>7d / 30d historical series from subgraph or backend analytics</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="7d" value={selectedRange} onValueChange={(value) => setSelectedRange(value as "7d" | "30d") }>
              <TabsList className="mb-4 gap-2">
                <TabsTrigger value="7d">7d</TabsTrigger>
                <TabsTrigger value="30d">30d</TabsTrigger>
              </TabsList>
              <TabsContent value="7d" className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analytics.tvlTrend7d}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="label" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip contentStyle={{ background: "#020617", border: "1px solid #1e293b" }} />
                    <Area type="monotone" dataKey="tvl" stroke="#22d3ee" fill="#164e63" fillOpacity={0.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </TabsContent>
              <TabsContent value="30d" className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={analytics.tvlTrend30d}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="label" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip contentStyle={{ background: "#020617", border: "1px solid #1e293b" }} />
                    <Line type="monotone" dataKey="tvl" stroke="#38bdf8" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Admin Actions</CardTitle>
            <CardDescription>Multisig actions and operational controls</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Panic Threshold BPS</label>
              <input value={panicThresholdBps} onChange={(e) => setPanicThresholdBps(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm outline-none focus:border-cyan-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Oracle Volatility</label>
              <input value={oracleVolatility} onChange={(e) => setOracleVolatility(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm outline-none focus:border-cyan-500" />
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Button onClick={triggerEmergencyPause} disabled={isPending} variant="destructive" className="w-full">Emergency Pause</Button>
              <Button onClick={updateLtvParameters} disabled={isPending} className="w-full">Update LTV Parameters</Button>
              <Button onClick={triggerOracleUpdate} disabled={isPending} variant="secondary" className="w-full">Trigger Oracle Update</Button>
              <Button onClick={viewAuditLogs} disabled={isPending} variant="outline" className="w-full">View Audit Logs</Button>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-sm text-slate-400">
              Emergency pause proposals tighten the panic threshold to the configured BPS rather than hard-stopping the protocol.
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Loan Volume by Collection</CardTitle>
            <CardDescription>Current collection concentration from analytics backend</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.loanVolumeByCollection}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="collection" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ background: "#020617", border: "1px solid #1e293b" }} />
                <Bar dataKey="value" fill="#22d3ee" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue Waterfall</CardTitle>
            <CardDescription>Debt first, then reserve and surplus routing</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={analytics.revenueWaterfall} dataKey="value" nameKey="name" innerRadius={48} outerRadius={92} paddingAngle={2}>
                  {analytics.revenueWaterfall.map((entry, index) => (
                    <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip contentStyle={{ background: "#020617", border: "1px solid #1e293b" }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Liquidation Events Timeline</CardTitle>
            <CardDescription>Event density from The Graph or backend analytics</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.liquidationEvents}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ background: "#020617", border: "1px solid #1e293b" }} />
                <Line type="monotone" dataKey="count" stroke="#f97316" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Alerts</CardTitle>
            <CardDescription>Active panic NFTs, stale feeds, and pending liquidations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Flame className="h-4 w-4 text-rose-300" /> Active panic NFTs</div>
                <div className="space-y-2">
                  {aggregate.panicTokens.length ? aggregate.panicTokens.map((item) => <PanicListItem key={item.tokenId} item={item} />) : <div className="text-sm text-slate-400">No panic NFTs currently active.</div>}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
                <div className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-amber-300" /> Oracle stale feeds</div>
                {aggregate.staleFeeds.length ? <div>{aggregate.staleFeeds.length} feeds need refresh.</div> : <div>No stale feeds detected.</div>}
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
                <div className="mb-2 flex items-center gap-2 font-semibold"><Download className="h-4 w-4 text-cyan-300" /> Pending liquidations</div>
                <div>{analytics.liquidationEvents.filter((event) => event.count > 0).length} windows contain liquidation activity.</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <div ref={auditRef}>
        <Card>
          <CardHeader>
            <CardTitle>Audit Logs</CardTitle>
            <CardDescription>Operational notes and activity trace for multisig signers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
              Connected wallet: {address}
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">
              TVL: {aggregate.tvl.toFixed(4)} ETH | Health Score: {aggregate.healthScore.toFixed(2)} | Pending proposals: {aggregate.pendingProposals}
            </div>
            {tokenMetrics.slice(0, 5).map((item) => (
              <div key={item.tokenId} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">NFT #{item.tokenId}</div>
                    <div className="text-xs text-slate-400">{item.collectionAddress}</div>
                  </div>
                  <Badge variant={item.riskStatus === "red" ? "danger" : item.riskStatus === "yellow" ? "warning" : "success"}>{item.riskStatus.toUpperCase()}</Badge>
                </div>
                <div className="mt-2 grid gap-2 text-sm text-slate-300 md:grid-cols-4">
                  <div>Floor {item.floorEth.toFixed(4)} ETH</div>
                  <div>LTV {fmtPercent(item.ltvPercent)}</div>
                  <div>HF {item.healthFactor.toFixed(2)}</div>
                  <div>{item.panic ? "Panic mode active" : "Healthy"}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
