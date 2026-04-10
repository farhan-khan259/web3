"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Skeleton } from "../../../../components/ui/skeleton";
import { getBackendBaseUrl } from "../../../../lib/contracts";

type SeriesPoint = {
  label: string;
  value: number;
};

type StatsPayload = {
  kpis: {
    tvl: number;
    totalCollateral: number;
    totalDebt: number;
    activeLoansCount: number;
    panicCount: number;
    totalRevenue: number;
    usersCount: number;
    oracleHealth: "green" | "stale";
    oracleLastUpdateTs: number;
  };
  charts: {
    loanVolumeSeries: SeriesPoint[];
    revenueSeries: SeriesPoint[];
    panicSeries: SeriesPoint[];
  };
};

const EMPTY_STATS: StatsPayload = {
  kpis: {
    tvl: 0,
    totalCollateral: 0,
    totalDebt: 0,
    activeLoansCount: 0,
    panicCount: 0,
    totalRevenue: 0,
    usersCount: 0,
    oracleHealth: "stale",
    oracleLastUpdateTs: 0,
  },
  charts: {
    loanVolumeSeries: [],
    revenueSeries: [],
    panicSeries: [],
  },
};

function getAdminAuthHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token =
    window.localStorage.getItem("admin_jwt") ||
    window.localStorage.getItem("adminToken") ||
    window.localStorage.getItem("token") ||
    "";

  if (!token) return {};
  return {
    Authorization: `Bearer ${token}`,
  };
}

export default function AdminOverviewPage() {
  const { address, isConnected } = useAccount();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<StatsPayload>(EMPTY_STATS);

  const backendBase = useMemo(() => getBackendBaseUrl(), []);

  const loadOverview = useCallback(async () => {
    setError("");

    try {
      const response = await fetch(`${backendBase}/api/admin/stats?windowDays=30`, {
        cache: "no-store",
        headers: {
          ...getAdminAuthHeaders(),
        },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("Admin authentication required. Please sign in again.");
        }
        throw new Error("Failed to load admin stats");
      }

      const payload = await response.json();
      setStats({
        kpis: {
          tvl: Number(payload?.kpis?.tvl || 0),
          totalCollateral: Number(payload?.kpis?.totalCollateral || 0),
          totalDebt: Number(payload?.kpis?.totalDebt || 0),
          activeLoansCount: Number(payload?.kpis?.activeLoansCount || 0),
          panicCount: Number(payload?.kpis?.panicCount || 0),
          totalRevenue: Number(payload?.kpis?.totalRevenue || 0),
          usersCount: Number(payload?.kpis?.usersCount || 0),
          oracleHealth: payload?.kpis?.oracleHealth === "green" ? "green" : "stale",
          oracleLastUpdateTs: Number(payload?.kpis?.oracleLastUpdateTs || 0),
        },
        charts: {
          loanVolumeSeries: Array.isArray(payload?.charts?.loanVolumeSeries) ? payload.charts.loanVolumeSeries : [],
          revenueSeries: Array.isArray(payload?.charts?.revenueSeries) ? payload.charts.revenueSeries : [],
          panicSeries: Array.isArray(payload?.charts?.panicSeries) ? payload.charts.panicSeries : [],
        },
      });
    } catch (err) {
      setError((err as Error).message || "Failed to load overview");
    }
  }, [backendBase]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadOverview();
    setRefreshing(false);
  }, [loadOverview]);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      if (!isConnected || !address) {
        setLoading(false);
        return;
      }

      setLoading(true);
      await loadOverview();
      if (mounted) setLoading(false);
    }

    boot();
    const timer = setInterval(() => {
      loadOverview();
    }, 30_000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [address, isConnected, loadOverview]);

  if (!isConnected || !address) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold">Admin Overview</h1>
        <p className="text-sm opacity-80">Connect an admin wallet to view protocol analytics.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Admin System Overview</h1>
          <p className="mt-1 text-sm opacity-80">KPIs and chart data sourced from Supabase via backend Prisma API.</p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading || refreshing}>
          {refreshing ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-rose-300">{error}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {loading ? (
          Array.from({ length: 5 }).map((_, idx) => <Skeleton key={idx} className="h-28 w-full" />)
        ) : (
          <>
            <Card>
              <CardHeader><CardTitle className="text-base">TVL</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{stats.kpis.tvl.toFixed(4)} ETH</div></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Active Loans</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{stats.kpis.activeLoansCount}</div></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">NFTs in Panic</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{stats.kpis.panicCount}</div></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Total Revenue</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{stats.kpis.totalRevenue.toFixed(4)} ETH</div></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Oracle Health</CardTitle></CardHeader>
              <CardContent>
                <Badge variant={stats.kpis.oracleHealth === "green" ? "success" : "warning"}>
                  {stats.kpis.oracleHealth === "green" ? "GREEN" : "STALE"}
                </Badge>
                <div className="mt-2 text-xs opacity-80">
                  Last update: {stats.kpis.oracleLastUpdateTs ? new Date(stats.kpis.oracleLastUpdateTs).toLocaleString() : "N/A"}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Loan Volume Over Time</CardTitle>
            <CardDescription>Supabase loans table (30 days)</CardDescription>
          </CardHeader>
          <CardContent className="h-56">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.charts.loanVolumeSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="value" fill="#38bdf8" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue Over Time</CardTitle>
            <CardDescription>Supabase revenue_flows table (30 days)</CardDescription>
          </CardHeader>
          <CardContent className="h-56">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.charts.revenueSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip />
                  <Area type="monotone" dataKey="value" stroke="#22d3ee" fill="#164e63" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Panic Events Timeline</CardTitle>
            <CardDescription>Supabase panic_events table (30 days)</CardDescription>
          </CardHeader>
          <CardContent className="h-56">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.charts.panicSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="label" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="#f97316" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
