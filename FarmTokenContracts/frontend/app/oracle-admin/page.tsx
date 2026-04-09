"use client";

import { useState } from "react";
import { formatEther } from "ethers";
import QrScannerPanel from "../../components/QrScannerPanel";
import { getContracts, getReadProvider, nftTypeLabel } from "../../lib/contracts";

export default function OracleAdminPage() {
  const [rightsId, setRightsId] = useState("1");
  const [status, setStatus] = useState("Idle");
  const [oracleValue, setOracleValue] = useState<bigint>(0n);
  const [liquidationValue, setLiquidationValue] = useState<bigint>(0n);
  const [appraisalValue, setAppraisalValue] = useState<bigint>(0n);
  const [compositeScore, setCompositeScore] = useState<bigint>(0n);
  const [rarityScore, setRarityScore] = useState<bigint>(0n);
  const [utilityScore, setUtilityScore] = useState<bigint>(0n);
  const [distributionWeight, setDistributionWeight] = useState<bigint>(0n);
  const [risk, setRisk] = useState(false);
  const [volatility, setVolatility] = useState<bigint>(0n);
  const [nftType, setNftType] = useState(0);

  async function refresh() {
    console.log("[OracleAdminPage] refresh called with rightsId:", rightsId);
    
    try {
      console.log("[OracleAdminPage] Getting contracts...");
      const contracts = getContracts(getReadProvider());
      const id = BigInt(rightsId);
      
      console.log("[OracleAdminPage] Making contract calls...");
      const [
        floorValue,
        currentRisk,
        vol,
        type,
        composite,
        valuations,
        rarity,
        utility,
        distribution,
      ] = await Promise.all([
        contracts.oracle.getFloorValue(id),
        contracts.oracle.getRiskStatus(id),
        contracts.oracle.volatilityIndex(),
        contracts.oracle.rightTypeOf(id),
        contracts.oracle.getCompositeScore(id),
        contracts.oracle.getValuations(id),
        contracts.oracle.rarityScore(id),
        contracts.oracle.utilityScore(id),
        contracts.oracle.distributionWeight(id),
      ]);

      console.log("[OracleAdminPage] Contract calls successful:", {
        floorValue: floorValue.toString(),
        currentRisk,
        vol: vol.toString(),
        type: type.toString(),
        composite: composite.toString(),
        valuations: { liquidationValue: valuations.liquidationValue.toString(), appraisalValue: valuations.appraisalValue.toString() },
        rarity: rarity.toString(),
        utility: utility.toString(),
        distribution: distribution.toString(),
      });

      setOracleValue(floorValue);
      setRisk(currentRisk);
      setVolatility(vol);
      setNftType(Number(type));
      setCompositeScore(composite);
      setLiquidationValue(valuations.liquidationValue);
      setAppraisalValue(valuations.appraisalValue);
      setRarityScore(rarity);
      setUtilityScore(utility);
      setDistributionWeight(distribution);
      
      const msg = "Oracle data loaded";
      setStatus(msg);
      console.log("[OracleAdminPage]", msg);
    } catch (error) {
      const errorMsg = `Read failed: ${(error as Error).message}`;
      setStatus(errorMsg);
      console.error("[OracleAdminPage] Error:", error);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 text-slate-100">
      <h1 className="text-3xl font-semibold">Oracle Inspector</h1>
      <p className="mt-2 text-sm text-slate-400">
        Milestone 2 valuation engine with rarity/utility/distribution scores and dynamic volatility.
      </p>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
        <label className="mb-2 block text-sm text-slate-300">Mint-Right ID</label>
        <input className="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={rightsId} onChange={(e) => setRightsId(e.target.value)} />

        <div className="mb-3">
          <QrScannerPanel />
        </div>

        <button onClick={refresh} className="rounded-md border border-slate-700 px-4 py-2 text-sm">Refresh</button>

        <div className="mt-4 space-y-1 text-sm">
          <div>NFT Type: <span className={nftType === 1 ? "text-amber-300" : "text-cyan-300"}>{nftTypeLabel(nftType)}</span></div>
          <div>Oracle Used: {nftType === 1 ? "Rare Oracle" : "Normal Oracle"}</div>
          <div>Floor Price: {formatEther(oracleValue)} ETH</div>
          <div>Rarity Score: {rarityScore.toString()}</div>
          <div>Utility Score: {utilityScore.toString()}</div>
          <div>Distribution Weight: {distributionWeight.toString()}</div>
          <div>Composite Score: {compositeScore.toString()}</div>
          <div>Liquidation Value: {formatEther(liquidationValue)} ETH</div>
          <div>Appraisal Value (Capped): {formatEther(appraisalValue)} ETH</div>
          <div>Risk: {risk ? "RISK" : "OK"}</div>
          <div>Volatility Index: {volatility.toString()}</div>
        </div>
      </div>

      <div className="mt-4 text-sm text-slate-300">{status}</div>
    </main>
  );
}
