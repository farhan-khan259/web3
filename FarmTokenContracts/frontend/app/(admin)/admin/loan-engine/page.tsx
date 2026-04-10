"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { getContracts, getReadProvider } from "../../../../lib/contracts";
import { isAdmin } from "../../../../lib/auth";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";

type ParamsState = {
  ltvRatio: number;
  liquidationThreshold: number;
  panicThreshold: number;
  recoveryThreshold: number;
  dynamicLtvMultiplier: number;
};

type ParamLog = {
  id: string;
  at: string;
  actor: string;
  ltvRatio: number;
  liquidationThreshold: number;
  panicThreshold: number;
  recoveryThreshold: number;
  dynamicLtvMultiplier: number;
};

const DEFAULT_PARAMS: ParamsState = {
  ltvRatio: 70,
  liquidationThreshold: 75,
  panicThreshold: 85,
  recoveryThreshold: 60,
  dynamicLtvMultiplier: 0.7,
};

export default function LoanEngineAdminPage() {
  const { address, isConnected } = useAccount();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [params, setParams] = useState<ParamsState>(DEFAULT_PARAMS);
  const [currentValues, setCurrentValues] = useState<ParamsState>(DEFAULT_PARAMS);
  const [logs, setLogs] = useState<ParamLog[]>([]);

  const adminWallet = useMemo(() => Boolean(address && isAdmin(address)), [address]);

  useEffect(() => {
    let mounted = true;

    async function loadCurrentValues() {
      setLoading(true);
      setError("");

      try {
        const contracts = getContracts(getReadProvider());

        const [panicThresholdRaw, dynamicMaxRaw] = await Promise.all([
          contracts.loan.panicThresholdBps(),
          contracts.loan.getDynamicMaxLTV(),
        ]);

        const nextValues: ParamsState = {
          ltvRatio: Number(dynamicMaxRaw) / 100,
          liquidationThreshold: 75,
          panicThreshold: Number(panicThresholdRaw) / 100,
          recoveryThreshold: 60,
          dynamicLtvMultiplier: Math.min(1, Math.max(0.7, Number(dynamicMaxRaw) / 10_000)),
        };

        let loadedLogs: ParamLog[] = [];
        try {
          const res = await fetch("/api/admin/loan-parameter-log", { cache: "no-store" });
          if (res.ok) {
            const json = await res.json();
            loadedLogs = (json?.items ?? json?.logs ?? []).map((item: any, idx: number) => ({
              id: String(item?.id ?? `log-${idx}`),
              at: String(item?.at ?? "-"),
              actor: String(item?.actor ?? "-"),
              ltvRatio: Number(item?.ltvRatio ?? nextValues.ltvRatio),
              liquidationThreshold: Number(item?.liquidationThreshold ?? nextValues.liquidationThreshold),
              panicThreshold: Number(item?.panicThreshold ?? nextValues.panicThreshold),
              recoveryThreshold: Number(item?.recoveryThreshold ?? nextValues.recoveryThreshold),
              dynamicLtvMultiplier: Number(item?.dynamicLtvMultiplier ?? nextValues.dynamicLtvMultiplier),
            }));
          }
        } catch {
          loadedLogs = [];
        }

        if (mounted) {
          setCurrentValues(nextValues);
          setParams(nextValues);
          setLogs(loadedLogs);
        }
      } catch (err) {
        if (mounted) {
          setError((err as Error).message || "Failed to load loan engine values");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    if (isConnected && address) {
      loadCurrentValues();
    } else {
      setLoading(false);
    }

    return () => {
      mounted = false;
    };
  }, [address, isConnected]);

  async function submitParameters() {
    if (!adminWallet) {
      setError("Admin wallet is required.");
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      // Current LoanEngine does not expose updateParameters; route through multisig proposal workflow.
      const res = await fetch("/api/admin/propose-loan-parameters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposer: address,
          functionName: "LoanEngine.updateParameters",
          params,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to submit multisig parameter proposal");
      }

      const newLog: ParamLog = {
        id: `${Date.now()}`,
        at: new Date().toLocaleString(),
        actor: String(address),
        ltvRatio: params.ltvRatio,
        liquidationThreshold: params.liquidationThreshold,
        panicThreshold: params.panicThreshold,
        recoveryThreshold: params.recoveryThreshold,
        dynamicLtvMultiplier: params.dynamicLtvMultiplier,
      };

      setLogs((prev) => [newLog, ...prev].slice(0, 30));
      setMessage("Parameter update proposal submitted to multisig workflow.");
    } catch (err) {
      setError((err as Error).message || "Failed to submit parameter update");
    } finally {
      setSubmitting(false);
    }
  }

  function setParam<K extends keyof ParamsState>(key: K, value: number) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  if (!isConnected || !address) {
    return (
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold">Loan Engine Controls</h1>
        <p className="text-sm opacity-80">Connect your admin wallet to manage parameters.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Loan Engine Controls</h1>
        <p className="mt-1 text-sm opacity-80">Tune thresholds and submit parameter updates via multisig proposal flow.</p>
      </div>

      {!adminWallet ? <Card><CardContent className="pt-6 text-sm text-rose-300">Connected wallet is not an admin signer.</CardContent></Card> : null}
      {error ? <Card><CardContent className="pt-6 text-sm text-rose-300">{error}</CardContent></Card> : null}
      {message ? <Card><CardContent className="pt-6 text-sm text-emerald-300">{message}</CardContent></Card> : null}

      <Card>
        <CardHeader>
          <CardTitle>Current Values</CardTitle>
          <CardDescription>Read from contract and protocol defaults.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5 text-sm">
              <div className="rounded border p-3">LTV Ratio: <strong>{currentValues.ltvRatio.toFixed(2)}%</strong></div>
              <div className="rounded border p-3">Liquidation Threshold: <strong>{currentValues.liquidationThreshold.toFixed(2)}%</strong></div>
              <div className="rounded border p-3">Panic Threshold: <strong>{currentValues.panicThreshold.toFixed(2)}%</strong></div>
              <div className="rounded border p-3">Recovery Threshold: <strong>{currentValues.recoveryThreshold.toFixed(2)}%</strong></div>
              <div className="rounded border p-3">Dynamic LTV Multiplier: <strong>{currentValues.dynamicLtvMultiplier.toFixed(2)}</strong></div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Update Parameters</CardTitle>
          <CardDescription>Sliders and precise numeric inputs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <label className="mb-1 block text-sm">LTV Ratio (%)</label>
            <input type="range" min={50} max={90} value={params.ltvRatio} onChange={(e) => setParam("ltvRatio", Number(e.target.value))} className="w-full" />
            <input className="mt-2 w-full rounded border bg-transparent px-3 py-2 text-sm" value={params.ltvRatio} onChange={(e) => setParam("ltvRatio", Number(e.target.value) || 0)} />
          </div>

          <div>
            <label className="mb-1 block text-sm">Liquidation Threshold (%)</label>
            <input type="range" min={60} max={95} value={params.liquidationThreshold} onChange={(e) => setParam("liquidationThreshold", Number(e.target.value))} className="w-full" />
            <input className="mt-2 w-full rounded border bg-transparent px-3 py-2 text-sm" value={params.liquidationThreshold} onChange={(e) => setParam("liquidationThreshold", Number(e.target.value) || 0)} />
          </div>

          <div>
            <label className="mb-1 block text-sm">Panic Threshold (%)</label>
            <input type="range" min={70} max={95} value={params.panicThreshold} onChange={(e) => setParam("panicThreshold", Number(e.target.value))} className="w-full" />
            <input className="mt-2 w-full rounded border bg-transparent px-3 py-2 text-sm" value={params.panicThreshold} onChange={(e) => setParam("panicThreshold", Number(e.target.value) || 0)} />
          </div>

          <div>
            <label className="mb-1 block text-sm">Recovery Threshold (%)</label>
            <input type="range" min={40} max={80} value={params.recoveryThreshold} onChange={(e) => setParam("recoveryThreshold", Number(e.target.value))} className="w-full" />
            <input className="mt-2 w-full rounded border bg-transparent px-3 py-2 text-sm" value={params.recoveryThreshold} onChange={(e) => setParam("recoveryThreshold", Number(e.target.value) || 0)} />
          </div>

          <div>
            <label className="mb-1 block text-sm">Dynamic LTV Multiplier (0.7 - 1.0)</label>
            <input type="range" min={0.7} max={1} step={0.01} value={params.dynamicLtvMultiplier} onChange={(e) => setParam("dynamicLtvMultiplier", Number(e.target.value))} className="w-full" />
            <input className="mt-2 w-full rounded border bg-transparent px-3 py-2 text-sm" value={params.dynamicLtvMultiplier} onChange={(e) => setParam("dynamicLtvMultiplier", Number(e.target.value) || 0.7)} />
          </div>

          <Button onClick={submitParameters} disabled={!adminWallet || submitting}>
            {submitting ? "Submitting..." : "Submit Parameter Changes"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Parameter Change Log</CardTitle>
          <CardDescription>Recent proposed updates.</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>LTV</TableHead>
                  <TableHead>Liquidation</TableHead>
                  <TableHead>Panic</TableHead>
                  <TableHead>Recovery</TableHead>
                  <TableHead>Multiplier</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{log.at}</TableCell>
                    <TableCell>{log.actor}</TableCell>
                    <TableCell>{log.ltvRatio.toFixed(2)}%</TableCell>
                    <TableCell>{log.liquidationThreshold.toFixed(2)}%</TableCell>
                    <TableCell>{log.panicThreshold.toFixed(2)}%</TableCell>
                    <TableCell>{log.recoveryThreshold.toFixed(2)}%</TableCell>
                    <TableCell>{log.dynamicLtvMultiplier.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm opacity-80">No parameter change logs yet.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
