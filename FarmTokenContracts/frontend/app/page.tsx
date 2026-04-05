"use client";

import { useMemo, useState } from "react";
import { formatEther } from "ethers";
import QrScannerPanel from "../components/QrScannerPanel";
import {
  ADDRESSES,
  getContracts,
  getReadProvider,
  hasAllAddresses,
  nftTypeLabel,
  shortAddress,
} from "../lib/contracts";

type RightRow = {
  rightsId: number;
  owner: string;
  isLocked: boolean;
  typeSet: boolean;
  nftType: number;
  nftTypeLabel: "NORMAL" | "RARE";
  oracleValue: bigint;
  snapshotValue: bigint;
  debt: bigint;
  ltv: bigint;
  panic: boolean;
  risk: boolean;
};

function bpsToPercent(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

export default function DashboardPage() {
  const [walletAddress, setWalletAddress] = useState("");
  const [rightsIdsInput, setRightsIdsInput] = useState("1");
  const [rows, setRows] = useState<RightRow[]>([]);
  const [status, setStatus] = useState("Idle");
  const [loadingMirror, setLoadingMirror] = useState(false);
  const [volatility, setVolatility] = useState<bigint>(0n);
  const [maxLtv, setMaxLtv] = useState<bigint>(0n);

  const totalSnapshot = useMemo(() => rows.reduce((acc, row) => acc + row.snapshotValue, 0n), [rows]);
  const totalDebt = useMemo(() => rows.reduce((acc, row) => acc + row.debt, 0n), [rows]);
  const normalCount = useMemo(() => rows.filter((row) => row.nftType === 0).length, [rows]);
  const rareCount = useMemo(() => rows.filter((row) => row.nftType === 1).length, [rows]);

  function normalizeMirrorRow(row: any): RightRow {
    const typeNum = Number(row.nftType);
    return {
      rightsId: Number(row.rightsId),
      owner: row.locker,
      isLocked: row.isLocked,
      typeSet: row.typeSet,
      nftType: typeNum,
      nftTypeLabel: nftTypeLabel(typeNum),
      oracleValue: row.oracleValue,
      snapshotValue: row.snapshotValue,
      debt: row.debt,
      ltv: row.ltvBps,
      panic: false,
      risk: false,
    };
  }

  async function refresh() {
    if (!hasAllAddresses()) return;

    const parsedIds = rightsIdsInput
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0);

    if (!parsedIds.length) {
      setStatus("Enter mint-right IDs, e.g. 1,2,3");
      return;
    }

    try {
      const contracts = getContracts(getReadProvider());
      const [vol, dynamicMax] = await Promise.all([
        contracts.oracle.volatilityIndex(),
        contracts.loan.getDynamicMaxLTV(),
      ]);
      const walletLower = walletAddress.trim().toLowerCase();

      const allRows = await Promise.all(
        parsedIds.map(async (id) => {
          const row = (await contracts.vault.getMirrorRange(id, id))[0];
          const normalized = normalizeMirrorRow(row);

          if (!normalized.typeSet) {
            return normalized;
          }

          const rightsId = BigInt(id);
          const [position, risk] = await Promise.all([
            contracts.loan.positions(rightsId),
            contracts.oracle.getRiskStatus(rightsId),
          ]);

          return {
            ...normalized,
            debt: position.debt,
            panic: position.inPanic,
            risk,
          };
        })
      );

      const filteredRows = walletLower
        ? allRows.filter((r) => r.owner.toLowerCase() === walletLower)
        : allRows;

      setRows(filteredRows);
      setVolatility(vol);
      setMaxLtv(dynamicMax);
      setStatus(`Loaded ${filteredRows.length} mint-right positions`);
    } catch (error) {
      setStatus(`Refresh failed: ${(error as Error).message}`);
    }
  }

  async function loadFullMirror() {
    if (!hasAllAddresses()) return;
    setLoadingMirror(true);
    setStatus("Loading full 9,300 mirror...");

    try {
      const contracts = getContracts(getReadProvider());
      const [vol, dynamicMax] = await Promise.all([
        contracts.oracle.volatilityIndex(),
        contracts.loan.getDynamicMaxLTV(),
      ]);

      // Batch mirror reads to keep RPC payloads predictable across providers.
      const batchSize = 250;
      const aggregate: RightRow[] = [];

      for (let start = 1; start <= 9300; start += batchSize) {
        const end = Math.min(9300, start + batchSize - 1);
        const batch = await contracts.vault.getMirrorRange(start, end);
        aggregate.push(...batch.map(normalizeMirrorRow));
      }

      const walletLower = walletAddress.trim().toLowerCase();
      const filtered = walletLower
        ? aggregate.filter((row) => row.owner.toLowerCase() === walletLower)
        : aggregate;

      setRows(filtered);
      setVolatility(vol);
      setMaxLtv(dynamicMax);
      setStatus(`Full mirror loaded: ${filtered.length} rows`);
    } catch (error) {
      setStatus(`Mirror load failed: ${(error as Error).message}`);
    } finally {
      setLoadingMirror(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8 text-slate-100">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <h1 className="text-3xl font-semibold">Mint-Right Collateral Dashboard</h1>
        <p className="mt-2 text-sm text-slate-400">
          Read-only view for Ballet/manual wallets. No injected wallet, no NFT minting, no NFT transfer.
        </p>

        {!hasAllAddresses() && (
          <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            Missing NEXT_PUBLIC contract addresses.
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Enter Wallet Address</label>
            <input
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="0x..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Mint-Right IDs (comma separated)</label>
            <input
              value={rightsIdsInput}
              onChange={(e) => setRightsIdsInput(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="1,2,3"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <QrScannerPanel onWalletDetected={setWalletAddress} onRightsDetected={setRightsIdsInput} />
          <button onClick={refresh} className="rounded-md border border-slate-700 px-4 py-2 text-sm hover:border-cyan-400">
            Refresh
          </button>
          <button
            onClick={loadFullMirror}
            disabled={loadingMirror}
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200 disabled:opacity-60"
          >
            {loadingMirror ? "Loading 9,300..." : "Load Full 9,300 Mirror"}
          </button>
          <span className="text-sm text-slate-300">{status}</span>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-5">
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
            <div className="text-xs text-slate-400">Wallet</div>
            <div>{walletAddress ? shortAddress(walletAddress) : "Not set"}</div>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
            <div className="text-xs text-slate-400">Total Snapshot</div>
            <div>{formatEther(totalSnapshot)} ETH</div>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
            <div className="text-xs text-slate-400">Total Debt</div>
            <div>{formatEther(totalDebt)} ETH</div>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
            <div className="text-xs text-slate-400">Volatility / Max LTV</div>
            <div>{volatility.toString()} / {bpsToPercent(maxLtv)}</div>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
            <div className="text-xs text-slate-400">Normal / Rare</div>
            <div>{normalCount} / {rareCount}</div>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <h2 className="mb-3 text-xl">Locked Minting Rights</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="pb-2">Rights ID</th>
                <th className="pb-2">Owner</th>
                <th className="pb-2">Locked</th>
                <th className="pb-2">Type Set</th>
                <th className="pb-2">NFT Type</th>
                <th className="pb-2">Oracle Used</th>
                <th className="pb-2">Oracle Price</th>
                <th className="pb-2">Snapshot</th>
                <th className="pb-2">Debt</th>
                <th className="pb-2">LTV</th>
                <th className="pb-2">Panic</th>
                <th className="pb-2">Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rightsId} className="border-t border-slate-800">
                  <td className="py-2">#{row.rightsId}</td>
                  <td className="py-2 font-mono text-xs">{row.owner}</td>
                  <td className="py-2">{row.isLocked ? "YES" : "NO"}</td>
                  <td className="py-2">{row.typeSet ? "YES" : "NO"}</td>
                  <td className="py-2">
                    <span className={row.nftType === 1 ? "text-amber-300" : "text-cyan-300"}>{row.nftTypeLabel}</span>
                  </td>
                  <td className="py-2">{row.nftType === 1 ? "Rare Oracle" : "Normal Oracle"}</td>
                  <td className="py-2">{formatEther(row.oracleValue)} ETH</td>
                  <td className="py-2">{formatEther(row.snapshotValue)} ETH</td>
                  <td className="py-2">{formatEther(row.debt)} ETH</td>
                  <td className="py-2">{bpsToPercent(row.ltv)}</td>
                  <td className="py-2">{row.panic ? "PANIC" : "SAFE"}</td>
                  <td className="py-2">{row.risk ? "RISK" : "OK"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <h3 className="mb-2 text-lg">Contract Addresses</h3>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {Object.entries(ADDRESSES).map(([k, v]) => (
            <div key={k} className="rounded-md border border-slate-800 bg-slate-950/60 p-3 text-xs">
              <div className="uppercase text-slate-400">{k}</div>
              <div className="break-all font-mono text-slate-200">{v || "not set"}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
