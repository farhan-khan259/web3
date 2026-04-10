"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";

type RevenueEvent = {
  id: string;
  tokenId: number;
  amount: number;
  currency: string;
  source: string;
  date: string;
};

type WaterfallPoint = {
  name: string;
  value: number;
};

type RevenueSummary = {
  totalEarned: number;
  debtRepayment: number;
  reserve: number;
  surplus: number;
  events: RevenueEvent[];
};

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

export default function RevenuePage() {
  const { address, isConnected } = useAccount();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<RevenueSummary>({
    totalEarned: 0,
    debtRepayment: 0,
    reserve: 0,
    surplus: 0,
    events: [],
  });

  useEffect(() => {
    let mounted = true;

    async function loadRevenue() {
      if (!address) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const res = await fetch(`/api/revenue/user?wallet=${encodeURIComponent(address)}`, { cache: "no-store" });
        if (!res.ok) {
          throw new Error("Failed to load revenue data");
        }

        const json = await res.json();
        const nextSummary: RevenueSummary = {
          totalEarned: toNumber(json?.totalEarned ?? json?.summary?.totalEarned ?? 0),
          debtRepayment: toNumber(json?.debtRepayment ?? json?.summary?.debtRepayment ?? 0),
          reserve: toNumber(json?.reserve ?? json?.summary?.reserve ?? 0),
          surplus: toNumber(json?.surplus ?? json?.summary?.surplus ?? 0),
          events: (json?.events ?? []).map((event: any, idx: number) => ({
            id: String(event?.id ?? `evt-${idx}`),
            tokenId: Number(event?.tokenId ?? 0),
            amount: toNumber(event?.amount ?? 0),
            currency: String(event?.currency ?? "ETH"),
            source: String(event?.source ?? "license"),
            date: String(event?.date ?? event?.timestamp ?? "-"),
          })),
        };

        if (mounted) {
          setSummary(nextSummary);
        }
      } catch (err) {
        if (mounted) {
          setError((err as Error).message || "Failed to load revenue");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadRevenue();
    return () => {
      mounted = false;
    };
  }, [address]);

  const waterfallData = useMemo<WaterfallPoint[]>(
    () => [
      { name: "Debt Repayment", value: summary.debtRepayment },
      { name: "Reserve", value: summary.reserve },
      { name: "Surplus", value: summary.surplus },
    ],
    [summary]
  );

  if (!isConnected || !address) {
    return (
      <section className="mx-auto max-w-6xl p-6">
        <h1 className="text-3xl font-semibold">Revenue</h1>
        <p className="mt-2 text-sm opacity-80">Connect your wallet to view license revenue and waterfall breakdown.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold">Revenue Dashboard</h1>
        <p className="mt-2 text-sm opacity-80">License-owner revenue with waterfall distribution and event history.</p>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-rose-300">{error}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Total Revenue Earned</CardTitle>
            <CardDescription>From owned licenses</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-9 w-44" /> : <div className="text-3xl font-semibold">{summary.totalEarned.toFixed(4)} ETH</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Waterfall Breakdown</CardTitle>
            <CardDescription>Debt repayment vs reserve vs surplus</CardDescription>
          </CardHeader>
          <CardContent className="h-56">
            {loading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={waterfallData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="value" fill="#22d3ee" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Past Revenue Events</CardTitle>
          <CardDescription>Historical revenue entries for your wallet</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : summary.events.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Token ID</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Currency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{event.date}</TableCell>
                    <TableCell>#{event.tokenId}</TableCell>
                    <TableCell>{event.source}</TableCell>
                    <TableCell>{event.amount.toFixed(4)}</TableCell>
                    <TableCell>{event.currency}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm opacity-80">No revenue events yet.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
