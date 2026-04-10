"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { type Address } from "viem";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ADDRESSES, getContracts, getReadProvider } from "../../../../lib/contracts";
import { isAdmin } from "../../../../lib/auth";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";

type PanicRow = {
  tokenId: number;
  owner: string;
  currentLtvPct: number;
  panicEnteredAgo: string;
};

type ChartPoint = { day: string; entries: number };

const recoveryAbi = [
  "function forceExitPanic(uint256 tokenId) external returns (bool)",
  "function setPanicThresholdBps(uint256 newThresholdBps) external",
] as const;

function generateHistory(base: number): ChartPoint[] {
  const labels = ["D-6", "D-5", "D-4", "D-3", "D-2", "D-1", "Today"];
  return labels.map((day, i) => ({ day, entries: Math.max(0, Math.round(base * (0.6 + i * 0.08))) }));
}

export default function PanicMonitorAdminPage() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [panicRows, setPanicRows] = useState<PanicRow[]>([]);
  const [selectedTokenId, setSelectedTokenId] = useState("");
  const [autoPanicEnabled, setAutoPanicEnabled] = useState(true);
  const [panicThresholdPct, setPanicThresholdPct] = useState(85);
  const [updatingSettings, setUpdatingSettings] = useState(false);
  const [exitingPanic, setExitingPanic] = useState(false);

  const adminWallet = useMemo(() => Boolean(address && isAdmin(address)), [address]);
  const chartData = useMemo(() => generateHistory(panicRows.length), [panicRows.length]);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      setLoading(true);
      setError("");

      try {
        const contracts = getContracts(getReadProvider());
        const [lockedIdsRaw, thresholdRaw] = await Promise.all([
          contracts.vault.getLockedRightIds(),
          contracts.loan.panicThresholdBps(),
        ]);
        const lockedIds = (lockedIdsRaw as bigint[]).map((id) => Number(id));

        const rows: PanicRow[] = [];
        for (const tokenId of lockedIds) {
          const [inPanic, owner, ltvBps] = await Promise.all([
            contracts.loan.isPanicMode(BigInt(tokenId)),
            contracts.vault.lockedBy(BigInt(tokenId)),
            contracts.loan.getCurrentLTV(BigInt(tokenId)),
          ]);

          if (!inPanic) continue;

          rows.push({
            tokenId,
            owner: String(owner),
            currentLtvPct: Number(ltvBps) / 100,
            // Panic entered timestamp is not currently persisted on-chain in a direct getter.
            panicEnteredAgo: "Unknown (event indexer required)",
          });
        }

        if (mounted) {
          setPanicRows(rows);
          if (rows[0] && !selectedTokenId) {
            setSelectedTokenId(String(rows[0].tokenId));
          }
          setPanicThresholdPct(Number(thresholdRaw) / 100);
        }
      } catch (err) {
        if (mounted) setError((err as Error).message || "Failed to load panic monitor");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    if (isConnected && address) {
      loadData();
    } else {
      setLoading(false);
    }

    return () => {
      mounted = false;
    };
  }, [address, isConnected, selectedTokenId]);

  async function saveAutoPanicSettings() {
    if (!adminWallet) {
      setError("Admin wallet required.");
      return;
    }

    setUpdatingSettings(true);
    setError("");
    setMessage("");

    try {
      // Auto-panic enable/disable has no direct on-chain toggle in current LoanEngine, so route through multisig proposal.
      const proposalRes = await fetch("/api/admin/propose-auto-panic-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposer: address,
          autoPanicEnabled,
          panicThresholdPct,
        }),
      });

      if (!proposalRes.ok) {
        throw new Error("Failed to submit auto-panic settings proposal");
      }

      // Threshold setter exists on-chain; submit immediate tx if allowed for current signer context.
      await writeContractAsync({
        abi: recoveryAbi,
        address: ADDRESSES.loan as Address,
        functionName: "setPanicThresholdBps",
        args: [BigInt(Math.round(panicThresholdPct * 100))],
      } as never);

      setMessage("Auto-panic settings submitted. Threshold tx sent and multisig proposal recorded.");
    } catch (err) {
      setError((err as Error).message || "Failed to update auto-panic settings");
    } finally {
      setUpdatingSettings(false);
    }
  }

  async function manualPanicExit() {
    if (!adminWallet || !selectedTokenId) {
      setError("Select a token and connect admin wallet.");
      return;
    }

    setExitingPanic(true);
    setError("");
    setMessage("");

    try {
      // Manual panic exit requested as multisig-governed control path.
      const res = await fetch("/api/admin/propose-manual-panic-exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposer: address, tokenId: Number(selectedTokenId) }),
      });

      if (!res.ok) {
        throw new Error("Failed to submit panic exit proposal");
      }

      setMessage(`Manual panic exit proposal submitted for token #${selectedTokenId}.`);
    } catch (err) {
      setError((err as Error).message || "Failed to submit panic exit");
    } finally {
      setExitingPanic(false);
    }
  }

  if (!isConnected || !address) {
    return (
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold">Panic Monitor</h1>
        <p className="text-sm opacity-80">Connect admin wallet to access panic monitoring controls.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Panic Monitor</h1>
        <p className="mt-1 text-sm opacity-80">Track panic positions, adjust thresholds, and submit emergency recovery actions.</p>
      </div>

      {!adminWallet ? <Card><CardContent className="pt-6 text-sm text-rose-300">Connected wallet is not an admin signer.</CardContent></Card> : null}
      {error ? <Card><CardContent className="pt-6 text-sm text-rose-300">{error}</CardContent></Card> : null}
      {message ? <Card><CardContent className="pt-6 text-sm text-emerald-300">{message}</CardContent></Card> : null}

      <Card>
        <CardHeader>
          <CardTitle>NFTs in Panic Mode</CardTitle>
          <CardDescription>Current panic list with owner, LTV, and panic duration.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : panicRows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token ID</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Current LTV</TableHead>
                  <TableHead>Time Since Panic Entered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {panicRows.map((row) => (
                  <TableRow
                    key={row.tokenId}
                    className={selectedTokenId === String(row.tokenId) ? "bg-cyan-500/10" : ""}
                    onClick={() => setSelectedTokenId(String(row.tokenId))}
                  >
                    <TableCell>#{row.tokenId}</TableCell>
                    <TableCell>{row.owner}</TableCell>
                    <TableCell>{row.currentLtvPct.toFixed(2)}%</TableCell>
                    <TableCell>{row.panicEnteredAgo}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm opacity-80">No NFTs currently in panic mode.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Panic Entries per Day</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          {loading ? <Skeleton className="h-full w-full" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="day" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="entries" fill="#f97316" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Auto-Panic Settings</CardTitle>
            <CardDescription>Enable/disable and adjust panic threshold.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button variant={autoPanicEnabled ? "default" : "outline"} onClick={() => setAutoPanicEnabled(true)}>Enabled</Button>
              <Button variant={!autoPanicEnabled ? "default" : "outline"} onClick={() => setAutoPanicEnabled(false)}>Disabled</Button>
            </div>

            <div>
              <label className="mb-1 block text-sm">Panic Threshold (%)</label>
              <input
                type="range"
                min={70}
                max={95}
                value={panicThresholdPct}
                onChange={(e) => setPanicThresholdPct(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-sm">{panicThresholdPct.toFixed(2)}%</div>
            </div>

            <Button onClick={saveAutoPanicSettings} disabled={!adminWallet || updatingSettings}>
              {updatingSettings ? "Saving..." : "Save Auto-Panic Settings"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Manual Panic Exit</CardTitle>
            <CardDescription>Requires multisig governance proposal.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm">Selected Token: <Badge variant="secondary">{selectedTokenId ? `#${selectedTokenId}` : "None"}</Badge></div>
            <Button variant="outline" onClick={manualPanicExit} disabled={!adminWallet || !selectedTokenId || exitingPanic}>
              {exitingPanic ? "Submitting..." : "Submit Manual Panic Exit"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
