"use client";

import { useMemo, useState } from "react";
import { formatEther, parseEther } from "ethers";
import QrScannerPanel from "../../components/QrScannerPanel";
import { getBackendBaseUrl, getContracts, getReadProvider, hasAllAddresses, nftTypeLabel } from "../../lib/contracts";

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
  const [simulateBorrowEth, setSimulateBorrowEth] = useState("1");
  const [backendLtv, setBackendLtv] = useState<number | null>(null);
  const [backendRisk, setBackendRisk] = useState<string>("unknown");

  async function refresh() {
    console.log("[BorrowPage] refresh called with rightsId:", rightsId);
    
    if (!hasAllAddresses()) {
      const msg = "Missing contract addresses";
      setStatus(msg);
      console.error("[BorrowPage]", msg);
      return;
    }
    
    try {
      console.log("[BorrowPage] Getting contracts and making contract calls...");
      const contracts = getContracts(getReadProvider());
      const id = BigInt(rightsId);
      const [snap, position, dynamicMax, panicMode, floorValue, type, valuations] = await Promise.all([
        contracts.vault.getSnapshotValue(id),
        contracts.loan.positions(id),
        contracts.oracle.getDynamicLTV(id),
        contracts.loan.isPanicMode(id),
        contracts.oracle.getFloorValue(id),
        contracts.vault.rightTypeOf(id),
        contracts.oracle.getValuations(id),
      ]);
      console.log("[BorrowPage] Contract calls successful:", { snap: snap.toString(), debt: position.debt.toString(), dynamicMax: dynamicMax.toString(), panicMode, floorValue: floorValue.toString(), type: type.toString() });
      
      const referenceValue = valuations.liquidationValue > 0n ? valuations.liquidationValue : snap;
      const allowed = (referenceValue * BigInt(dynamicMax)) / 10000n;
      const headroom = allowed > position.debt ? allowed - position.debt : 0n;

      setSnapshotValue(snap);
      setDebt(position.debt);
      setMaxLtv(dynamicMax);
      setMaxBorrow(headroom);
      setPanic(panicMode);
      setOraclePrice(floorValue);
      setNftType(Number(type));

      try {
        const backend = getBackendBaseUrl();
        console.log("[BorrowPage] Fetching backend data from:", backend);
        const [ltvRes, riskRes] = await Promise.all([
          fetch(`${backend}/ltv/${id.toString()}`),
          fetch(`${backend}/risk/${id.toString()}`),
        ]);

        if (ltvRes.ok) {
          const ltvPayload = await ltvRes.json();
          console.log("[BorrowPage] Backend ltv response:", ltvPayload);
          setBackendLtv(Number(ltvPayload?.ltvBps || 0) / 100);
        } else {
          console.warn("[BorrowPage] Backend ltv response NOT OK:", ltvRes.status);
          setBackendLtv(null);
        }

        if (riskRes.ok) {
          const riskPayload = await riskRes.json();
          console.log("[BorrowPage] Backend risk response:", riskPayload);
          setBackendRisk(String(riskPayload?.status || "unknown"));
        } else {
          console.warn("[BorrowPage] Backend risk response NOT OK:", riskRes.status);
          setBackendRisk("unknown");
        }
      } catch (backendError) {
        console.warn("[BorrowPage] Backend fetch error:", backendError);
        setBackendLtv(null);
        setBackendRisk("unknown");
      }

      const msg = "Borrow metrics loaded";
      setStatus(msg);
      console.log("[BorrowPage]", msg);
    } catch (error) {
      const errorMsg = `Refresh failed: ${(error as Error).message}`;
      setStatus(errorMsg);
      console.error("[BorrowPage] Error:", error);
    }
  }

  const simulation = useMemo(() => {
    try {
      const addDebt = parseEther(simulateBorrowEth || "0");
      const nextDebt = debt + addDebt;
      const valuation = oraclePrice > 0n ? oraclePrice : snapshotValue;
      if (valuation === 0n) {
        return { nextLtv: 0, allowed: false };
      }
      const nextLtv = Number((nextDebt * 10000n) / valuation) / 100;
      const allowed = nextLtv <= Number(maxLtv) / 100;
      return { nextLtv, allowed };
    } catch {
      return { nextLtv: 0, allowed: false };
    }
  }, [simulateBorrowEth, debt, oraclePrice, snapshotValue, maxLtv]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 text-slate-100">
      <h1 className="text-3xl font-semibold">Borrow Capacity (Milestone 2)</h1>
      <p className="mt-2 text-sm text-slate-400">
        Dynamic LTV and valuation-aware read-only borrow simulation.
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
          <div>Max Borrow Headroom: {formatEther(maxBorrow)} ETH</div>
          <div>Status: {panic ? "PANIC" : "SAFE"}</div>
          <div>Backend LTV: {backendLtv !== null ? `${backendLtv.toFixed(2)}%` : "n/a"}</div>
          <div>Backend Risk: {backendRisk.toUpperCase()}</div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
        <h2 className="text-lg font-medium">Borrow Simulation (Read-Only)</h2>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-slate-300">Simulated Borrow (ETH)</label>
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
              value={simulateBorrowEth}
              onChange={(e) => setSimulateBorrowEth(e.target.value)}
            />
          </div>
          <div className="pt-7 text-sm">
            <div>Projected LTV: {simulation.nextLtv.toFixed(2)}%</div>
            <div className={simulation.allowed ? "text-emerald-300" : "text-red-400"}>
              {simulation.allowed ? "Within dynamic LTV limit" : "Would exceed dynamic LTV limit"}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 text-sm text-slate-300">{status}</div>
    </main>
  );
}
