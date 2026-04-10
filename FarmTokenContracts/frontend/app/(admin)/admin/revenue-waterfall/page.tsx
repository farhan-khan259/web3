"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { isAdmin } from "../../../../lib/auth";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";

type RevenueEvent = {
  id: string;
  amount: number;
  source: string;
  distributionType: "debt" | "reserve" | "surplus";
  date: string;
};

type SplitState = {
  debtPct: number;
  reservePct: number;
  surplusPct: number;
};

const COLORS = ["#22d3ee", "#f59e0b", "#34d399"];

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

export default function RevenueWaterfallAdminPage() {
  const { address, isConnected } = useAccount();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [events, setEvents] = useState<RevenueEvent[]>([]);
  const [split, setSplit] = useState<SplitState>({ debtPct: 70, reservePct: 20, surplusPct: 10 });
  const [submitting, setSubmitting] = useState(false);

  const adminWallet = useMemo(() => Boolean(address && isAdmin(address)), [address]);

  useEffect(() => {
    let mounted = true;

    async function loadRevenueData() {
      setLoading(true);
      setError("");

      try {
        const [splitRes, eventsRes] = await Promise.all([
          fetch("/api/admin/revenue-split", { cache: "no-store" }),
          fetch("/api/admin/revenue-events?window=30d", { cache: "no-store" }),
        ]);

        let nextSplit: SplitState = { debtPct: 70, reservePct: 20, surplusPct: 10 };
        if (splitRes.ok) {
          const splitJson = await splitRes.json();
          nextSplit = {
            debtPct: toNumber(splitJson?.debtPct ?? 70),
            reservePct: toNumber(splitJson?.reservePct ?? 20),
            surplusPct: toNumber(splitJson?.surplusPct ?? 10),
          };
        }

        let nextEvents: RevenueEvent[] = [];
        if (eventsRes.ok) {
          const eventsJson = await eventsRes.json();
          nextEvents = (eventsJson?.events ?? []).map((e: any, idx: number) => ({
            id: String(e?.id ?? `evt-${idx}`),
            amount: toNumber(e?.amount ?? 0),
            source: String(e?.source ?? "license"),
            distributionType: String(e?.distributionType ?? "debt") as "debt" | "reserve" | "surplus",
            date: String(e?.date ?? "-"),
          }));
        }

        if (mounted) {
          setSplit(nextSplit);
          setEvents(nextEvents);
        }
      } catch (err) {
        if (mounted) setError((err as Error).message || "Failed to load revenue waterfall");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    if (isConnected && address) {
      loadRevenueData();
    } else {
      setLoading(false);
    }

    return () => {
      mounted = false;
    };
  }, [address, isConnected]);

  const pieData = useMemo(() => {
    const debt = events.filter((e) => e.distributionType === "debt").reduce((sum, e) => sum + e.amount, 0);
    const reserve = events.filter((e) => e.distributionType === "reserve").reduce((sum, e) => sum + e.amount, 0);
    const surplus = events.filter((e) => e.distributionType === "surplus").reduce((sum, e) => sum + e.amount, 0);
    return [
      { name: "Debt", value: debt },
      { name: "Reserve", value: reserve },
      { name: "Surplus", value: surplus },
    ];
  }, [events]);

  async function submitSplit() {
    if (!adminWallet) {
      setError("Admin wallet required.");
      return;
    }

    if (split.reservePct < 0 || split.surplusPct < 0 || split.reservePct + split.surplusPct > 30) {
      setError("Reserve + Surplus must be between 0 and 30 (Debt remains fixed at 70). ");
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/propose-revenue-split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposer: address,
          reservePct: split.reservePct,
          surplusPct: split.surplusPct,
          debtPct: 70,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to submit revenue split proposal");
      }

      setMessage("Revenue split update submitted to multisig proposal flow.");
    } catch (err) {
      setError((err as Error).message || "Revenue split update failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isConnected || !address) {
    return (
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold">Revenue Waterfall</h1>
        <p className="text-sm opacity-80">Connect admin wallet to manage revenue waterfall.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Revenue Waterfall</h1>
        <p className="mt-1 text-sm opacity-80">Debt-first distribution with configurable reserve/surplus governance controls.</p>
      </div>

      {!adminWallet ? <Card><CardContent className="pt-6 text-sm text-rose-300">Connected wallet is not an admin signer.</CardContent></Card> : null}
      {error ? <Card><CardContent className="pt-6 text-sm text-rose-300">{error}</CardContent></Card> : null}
      {message ? <Card><CardContent className="pt-6 text-sm text-emerald-300">{message}</CardContent></Card> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Current Distribution Percentages</CardTitle>
            <CardDescription>Debt is fixed first. Reserve and surplus are configurable.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {loading ? <Skeleton className="h-8 w-full" /> : (
              <>
                <div>Debt: <Badge variant="secondary">{split.debtPct}% (fixed)</Badge></div>
                <div>Reserve: <Badge variant="warning">{split.reservePct}%</Badge></div>
                <div>Surplus: <Badge variant="success">{split.surplusPct}%</Badge></div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue Distribution (Last 30 Days)</CardTitle>
            <CardDescription>Pie chart by distribution type.</CardDescription>
          </CardHeader>
          <CardContent className="h-56">
            {loading ? <Skeleton className="h-full w-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={90} label>
                    {pieData.map((entry, idx) => (
                      <Cell key={`slice-${entry.name}`} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Update Reserve / Surplus Split</CardTitle>
          <CardDescription>Submitted through multisig governance proposal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="mb-1 block text-sm">Reserve %</label>
            <input
              type="range"
              min={0}
              max={30}
              value={split.reservePct}
              onChange={(e) => setSplit((prev) => ({ ...prev, reservePct: Number(e.target.value) }))}
              className="w-full"
            />
            <input className="mt-2 w-full rounded border bg-transparent px-3 py-2 text-sm" value={split.reservePct} onChange={(e) => setSplit((prev) => ({ ...prev, reservePct: Number(e.target.value) || 0 }))} />
          </div>

          <div>
            <label className="mb-1 block text-sm">Surplus %</label>
            <input
              type="range"
              min={0}
              max={30}
              value={split.surplusPct}
              onChange={(e) => setSplit((prev) => ({ ...prev, surplusPct: Number(e.target.value) }))}
              className="w-full"
            />
            <input className="mt-2 w-full rounded border bg-transparent px-3 py-2 text-sm" value={split.surplusPct} onChange={(e) => setSplit((prev) => ({ ...prev, surplusPct: Number(e.target.value) || 0 }))} />
          </div>

          <Button onClick={submitSplit} disabled={!adminWallet || submitting}>
            {submitting ? "Submitting..." : "Submit Split Update"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Revenue Events</CardTitle>
          <CardDescription>Amount, source, and distribution type.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : events.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Distribution Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.date}</TableCell>
                    <TableCell>{e.amount.toFixed(4)}</TableCell>
                    <TableCell>{e.source}</TableCell>
                    <TableCell>{e.distributionType}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm opacity-80">No revenue events found for the selected window.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
