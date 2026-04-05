"use client";

import { useState } from "react";
import { formatEther } from "ethers";
import QrScannerPanel from "../../components/QrScannerPanel";
import { getContracts, getReadProvider, nftTypeLabel } from "../../lib/contracts";

export default function OracleAdminPage() {
  const [rightsId, setRightsId] = useState("1");
  const [status, setStatus] = useState("Idle");
  const [oracleValue, setOracleValue] = useState<bigint>(0n);
  const [risk, setRisk] = useState(false);
  const [volatility, setVolatility] = useState<bigint>(0n);
  const [nftType, setNftType] = useState(0);

  async function refresh() {
    try {
      const contracts = getContracts(getReadProvider());
      const id = BigInt(rightsId);
      const [value, currentRisk, vol, type] = await Promise.all([
        contracts.oracle.getFloorValue(id),
        contracts.oracle.getRiskStatus(id),
        contracts.oracle.volatilityIndex(),
        contracts.oracle.rightTypeOf(id),
      ]);

      setOracleValue(value);
      setRisk(currentRisk);
      setVolatility(vol);
      setNftType(Number(type));
      setStatus("Oracle data loaded");
    } catch (error) {
      setStatus(`Read failed: ${(error as Error).message}`);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 text-slate-100">
      <h1 className="text-3xl font-semibold">Oracle Inspector</h1>
      <p className="mt-2 text-sm text-slate-400">
        Strict dual-oracle model: NORMAL rights use floor oracle, RARE rights use trait oracle.
      </p>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
        <label className="mb-2 block text-sm text-slate-300">Mint-Right ID</label>
        <input className="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={rightsId} onChange={(e) => setRightsId(e.target.value)} />

        <div className="mb-3">
          <QrScannerPanel onRightsDetected={setRightsId} />
        </div>

        <button onClick={refresh} className="rounded-md border border-slate-700 px-4 py-2 text-sm">Refresh</button>

        <div className="mt-4 space-y-1 text-sm">
          <div>NFT Type: <span className={nftType === 1 ? "text-amber-300" : "text-cyan-300"}>{nftTypeLabel(nftType)}</span></div>
          <div>Oracle Used: {nftType === 1 ? "Rare Oracle" : "Normal Oracle"}</div>
          <div>Oracle Value: {formatEther(oracleValue)} ETH</div>
          <div>Risk: {risk ? "RISK" : "OK"}</div>
          <div>Volatility: {volatility.toString()}</div>
        </div>
      </div>

      <div className="mt-4 text-sm text-slate-300">{status}</div>
    </main>
  );
}
