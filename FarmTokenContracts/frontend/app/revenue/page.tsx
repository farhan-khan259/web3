"use client";

import { useState } from "react";
import { formatEther } from "ethers";
import QrScannerPanel from "../../components/QrScannerPanel";
import { getContracts, getReadProvider } from "../../lib/contracts";

export default function RevenuePage() {
  const [rightsId, setRightsId] = useState("1");
  const [status, setStatus] = useState("Idle");
  const [debt, setDebt] = useState<bigint>(0n);
  const [panic, setPanic] = useState(false);

  async function refresh() {
    try {
      const contracts = getContracts(getReadProvider());
      const id = BigInt(rightsId);
      const [outstandingDebt, panicMode] = await Promise.all([
        contracts.loan.outstandingDebt(id),
        contracts.loan.isPanicMode(id),
      ]);

      setDebt(outstandingDebt);
      setPanic(panicMode);
      setStatus("Revenue routing status loaded");
    } catch (error) {
      setStatus(`Refresh failed: ${(error as Error).message}`);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 text-slate-100">
      <h1 className="text-3xl font-semibold">Revenue Router Status</h1>
      <p className="mt-2 text-sm text-slate-400">
        Read-only monitoring for debt routing. 100% to debt in panic mode, otherwise split routing.
      </p>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
        <label className="mb-2 block text-sm text-slate-300">Mint-Right ID</label>
        <input className="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={rightsId} onChange={(e) => setRightsId(e.target.value)} />

        <div className="mb-3">
          <QrScannerPanel onRightsDetected={setRightsId} />
        </div>

        <button onClick={refresh} className="rounded-md border border-slate-700 px-4 py-2 text-sm">Refresh</button>

        <div className="mt-4 text-sm">Outstanding Debt: {formatEther(debt)} ETH</div>
        <div className="mt-1 text-sm">Mode: {panic ? "PANIC (all revenue to debt)" : "NORMAL"}</div>
      </div>

      <div className="mt-4 text-sm text-slate-300">{status}</div>
    </main>
  );
}
