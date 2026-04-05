"use client";

import { useState } from "react";
import { formatEther } from "ethers";
import QrScannerPanel from "../../components/QrScannerPanel";
import { getContracts, getReadProvider, hasAllAddresses, nftTypeLabel } from "../../lib/contracts";

export default function BorrowPage() {
  const [rightsId, setRightsId] = useState("1");
  const [status, setStatus] = useState("Idle");
  const [snapshotValue, setSnapshotValue] = useState<bigint>(0n);
  const [debt, setDebt] = useState<bigint>(0n);
  const [oraclePrice, setOraclePrice] = useState<bigint>(0n);
  const [maxLtv, setMaxLtv] = useState<bigint>(0n);
  const [maxBorrow, setMaxBorrow] = useState<bigint>(0n);
  const [panic, setPanic] = useState(false);
  const [nftType, setNftType] = useState(0);

  async function refresh() {
    if (!hasAllAddresses()) return;
    try {
      const contracts = getContracts(getReadProvider());
      const id = BigInt(rightsId);
      const [snap, position, dynamicMax, panicMode, floorValue, type] = await Promise.all([
        contracts.vault.getSnapshotValue(id),
        contracts.loan.positions(id),
        contracts.loan.getDynamicMaxLTV(),
        contracts.loan.isPanicMode(id),
        contracts.oracle.getFloorValue(id),
        contracts.vault.rightTypeOf(id),
      ]);
      const allowed = (snap * BigInt(dynamicMax)) / 10000n;
      const headroom = allowed > position.debt ? allowed - position.debt : 0n;

      setSnapshotValue(snap);
      setDebt(position.debt);
      setMaxLtv(dynamicMax);
      setMaxBorrow(headroom);
      setPanic(panicMode);
      setOraclePrice(floorValue);
      setNftType(Number(type));
      setStatus("Borrow metrics loaded");
    } catch (error) {
      setStatus(`Refresh failed: ${(error as Error).message}`);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 text-slate-100">
      <h1 className="text-3xl font-semibold">Borrow Capacity (Read-Only)</h1>
      <p className="mt-2 text-sm text-slate-400">
        This page estimates borrowing from locked mint-right collateral. No wallet injection or signing is used.
      </p>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
        <label className="mb-2 block text-sm text-slate-300">Mint-Right ID</label>
        <input className="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={rightsId} onChange={(e) => setRightsId(e.target.value)} />

        <div className="mb-3">
          <QrScannerPanel />
        </div>

        <button onClick={refresh} className="rounded-md border border-slate-700 px-4 py-2 text-sm">Refresh</button>

        <div className="mt-4 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <div>NFT Type: <span className={nftType === 1 ? "text-amber-300" : "text-cyan-300"}>{nftTypeLabel(nftType)}</span></div>
          <div>Oracle Used: {nftType === 1 ? "Rare Oracle" : "Normal Oracle"}</div>
          <div>Oracle Price: {formatEther(oraclePrice)} ETH</div>
          <div>Snapshot Value: {formatEther(snapshotValue)} ETH</div>
          <div>Current Debt: {formatEther(debt)} ETH</div>
          <div>Dynamic Max LTV: {(Number(maxLtv) / 100).toFixed(2)}%</div>
          <div>Borrow Headroom: {formatEther(maxBorrow)} ETH</div>
          <div>Status: {panic ? "PANIC" : "SAFE"}</div>
        </div>
      </div>

      <div className="mt-4 text-sm text-slate-300">{status}</div>
    </main>
  );
}
