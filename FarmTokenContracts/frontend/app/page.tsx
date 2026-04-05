"use client";

import { useMemo, useState } from "react";
import QrScannerPanel from "../components/QrScannerPanel";
import { ADDRESSES, shortAddress } from "../lib/contracts";

type MirrorRow = {
  tokenId: string;
  contractAddress: string;
  nftType: "NORMAL" | "RARE";
  oracleName: "NormalOracle" | "RareOracle";
  oracleSource: string;
  oraclePriceEth: number | null;
  ltvEth: number | null;
  valuationError?: string;
  minTraitPrevalence: number | null;
  maxTraitPrevalence: number | null;
};

const DEFAULT_WALLET = "0xc82A59594560A3010F336ebe2e9CC4794DCD46cf";

export default function DashboardPage() {
  const [walletAddress, setWalletAddress] = useState(DEFAULT_WALLET);
  const [ltvPercentInput, setLtvPercentInput] = useState("50");
  const [rows, setRows] = useState<MirrorRow[]>([]);
  const [status, setStatus] = useState("Idle");
  const [loadingMirror, setLoadingMirror] = useState(false);
  const [totalValueEth, setTotalValueEth] = useState(0);
  const [totalLtvEth, setTotalLtvEth] = useState(0);

  const normalCount = useMemo(() => rows.filter((row) => row.nftType === "NORMAL").length, [rows]);
  const rareCount = useMemo(() => rows.filter((row) => row.nftType === "RARE").length, [rows]);
  const ltvRatio = useMemo(() => {
    const numeric = Number(ltvPercentInput);
    if (!Number.isFinite(numeric)) return 0;
    return numeric / 100;
  }, [ltvPercentInput]);

  async function loadMirror() {
    const wallet = walletAddress.trim();
    if (!wallet) {
      setStatus("Enter a Ballet wallet address");
      return;
    }
    if (!Number.isFinite(ltvRatio) || ltvRatio <= 0 || ltvRatio > 1) {
      setStatus("LTV ratio must be > 0% and <= 100%");
      return;
    }

    setLoadingMirror(true);
    setStatus("Fetching NFTs + oracle values...");

    try {
      const response = await fetch("/api/mirror", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          walletAddress: wallet,
          ltvRatio,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(String(payload?.error || `HTTP ${response.status}`));
      }

      const nextRows: MirrorRow[] = Array.isArray(payload?.nfts) ? payload.nfts : [];
      setRows(nextRows);
      setTotalValueEth(Number(payload?.totals?.totalValueEth || 0));
      setTotalLtvEth(Number(payload?.totals?.totalLtvEth || 0));
      setStatus(`Loaded ${nextRows.length} NFTs from wallet`);

      console.log("[MirrorUI] wallet", wallet);
      console.table(
        nextRows.map((row) => ({
          tokenId: row.tokenId,
          contractAddress: row.contractAddress,
          nftType: row.nftType,
          oracleName: row.oracleName,
          oracleSource: row.oracleSource,
          oraclePriceEth: row.oraclePriceEth,
          ltvEth: row.ltvEth,
        }))
      );
      console.log("[MirrorUI] totals", {
        totalValueEth: Number(payload?.totals?.totalValueEth || 0),
        totalLtvEth: Number(payload?.totals?.totalLtvEth || 0),
        nftCount: nextRows.length,
      });
    } catch (error) {
      setStatus(`Mirror load failed: ${(error as Error).message}`);
    } finally {
      setLoadingMirror(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8 text-slate-100">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <h1 className="text-3xl font-semibold">Ballet Wallet NFT Mirror</h1>
        <p className="mt-2 text-sm text-slate-400">
          Read-only mirror with manual/QR wallet input, real NFT ownership data, dual-oracle valuation, and per-NFT LTV.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Ballet Wallet Address</label>
            <input
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="0x..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">LTV Ratio (%)</label>
            <input
              value={ltvPercentInput}
              onChange={(e) => setLtvPercentInput(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="50"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <QrScannerPanel onWalletDetected={setWalletAddress} />
          <button
            onClick={loadMirror}
            disabled={loadingMirror}
            className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-200 disabled:opacity-60"
          >
            {loadingMirror ? "Loading..." : "Load Real NFT Mirror"}
          </button>
          <span className="text-sm text-slate-300">{status}</span>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-5">
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
            <div className="text-xs text-slate-400">Wallet</div>
            <div>{walletAddress ? shortAddress(walletAddress) : "Not set"}</div>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
            <div className="text-xs text-slate-400">NFT Count</div>
            <div>{rows.length}</div>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
            <div className="text-xs text-slate-400">Total NFT Value</div>
            <div>{totalValueEth.toFixed(6)} ETH</div>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
            <div className="text-xs text-slate-400">Total LTV</div>
            <div>{totalLtvEth.toFixed(6)} ETH</div>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
            <div className="text-xs text-slate-400">Normal / Rare</div>
            <div>{normalCount} / {rareCount}</div>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <h2 className="mb-3 text-xl">NFT Mirror Output</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="pb-2">NFT ID</th>
                <th className="pb-2">Contract Address</th>
                <th className="pb-2">NFT Type</th>
                <th className="pb-2">Oracle Used</th>
                <th className="pb-2">Oracle Source</th>
                <th className="pb-2">Oracle Price</th>
                <th className="pb-2">LTV Value</th>
                <th className="pb-2">Trait Prevalence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.contractAddress}:${row.tokenId}`} className="border-t border-slate-800">
                  <td className="py-2">{row.tokenId}</td>
                  <td className="py-2 font-mono text-xs">{row.contractAddress}</td>
                  <td className="py-2">
                    <span className={row.nftType === "RARE" ? "text-amber-300" : "text-cyan-300"}>{row.nftType}</span>
                  </td>
                  <td className="py-2">{row.oracleName}</td>
                  <td className="py-2">{row.oracleSource}</td>
                  <td className="py-2">{row.oraclePriceEth !== null ? `${row.oraclePriceEth.toFixed(6)} ETH` : "n/a"}</td>
                  <td className="py-2">{row.ltvEth !== null ? `${row.ltvEth.toFixed(6)} ETH` : "n/a"}</td>
                  <td className="py-2">
                    {row.minTraitPrevalence !== null && row.maxTraitPrevalence !== null
                      ? `${(row.minTraitPrevalence * 100).toFixed(2)}% - ${(row.maxTraitPrevalence * 100).toFixed(2)}%`
                      : "n/a"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <h3 className="mb-2 text-lg">Testnet Contract Wiring (Read-Only)</h3>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {Object.entries(ADDRESSES).map(([key, value]) => (
            <div key={key} className="rounded-md border border-slate-800 bg-slate-950/60 p-3 text-xs">
              <div className="uppercase text-slate-400">{key}</div>
              <div className="break-all font-mono text-slate-200">{value || "not set"}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
