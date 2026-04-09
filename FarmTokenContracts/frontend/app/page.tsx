"use client";

import { formatEther } from "ethers";
import { useMemo, useState } from "react";
import QrScannerPanel from "../components/QrScannerPanel";
import {
  ADDRESSES,
  getBackendBaseUrl,
  getContracts,
  getReadProvider,
  hasAllAddresses,
  shortAddress,
} from "../lib/contracts";

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

type CreditRow = {
  rightsId: number;
  floorPriceEth: number;
  oracleValuationEth: number;
  debtEth: number;
  ltvPercent: number;
  riskStatus: "normal" | "warning" | "panic";
};

const DEFAULT_WALLET = "0xc82A59594560A3010F336ebe2e9CC4794DCD46cf";

function riskClass(status: CreditRow["riskStatus"]): string {
  if (status === "panic") return "text-red-400";
  if (status === "warning") return "text-amber-300";
  return "text-emerald-300";
}

export default function DashboardPage() {
  const [walletAddress, setWalletAddress] = useState(DEFAULT_WALLET);
  const [ltvPercentInput, setLtvPercentInput] = useState("50");
  const [rows, setRows] = useState<MirrorRow[]>([]);
  const [creditRows, setCreditRows] = useState<CreditRow[]>([]);
  const [status, setStatus] = useState("Idle");
  const [loadingMirror, setLoadingMirror] = useState(false);
  const [loadingCredit, setLoadingCredit] = useState(false);
  const [totalValueEth, setTotalValueEth] = useState(0);
  const [totalLtvEth, setTotalLtvEth] = useState(0);

  const normalCount = useMemo(() => rows.filter((row) => row.nftType === "NORMAL").length, [rows]);
  const rareCount = useMemo(() => rows.filter((row) => row.nftType === "RARE").length, [rows]);
  const ltvRatio = useMemo(() => {
    const numeric = Number(ltvPercentInput);
    if (!Number.isFinite(numeric)) return 0;
    return numeric / 100;
  }, [ltvPercentInput]);

  const creditTotals = useMemo(() => {
    const totalCollateral = creditRows.reduce((sum, row) => sum + row.oracleValuationEth, 0);
    const totalDebt = creditRows.reduce((sum, row) => sum + row.debtEth, 0);
    const avgLtv = totalCollateral > 0 ? (totalDebt / totalCollateral) * 100 : 0;
    return { totalCollateral, totalDebt, avgLtv };
  }, [creditRows]);

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
    console.log("[Dashboard] loadMirror called with wallet:", wallet, "ltvRatio:", ltvRatio);

    try {
      console.log("[Dashboard] Calling /api/mirror endpoint...");
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

      console.log("[Dashboard] /api/mirror response status:", response.status);
      const payload = await response.json();
      console.log("[Dashboard] /api/mirror payload:", payload);

      if (!response.ok) {
        throw new Error(String(payload?.error || `HTTP ${response.status}`));
      }

      const nextRows: MirrorRow[] = Array.isArray(payload?.nfts) ? payload.nfts : [];
      setRows(nextRows);
      setTotalValueEth(Number(payload?.totals?.totalValueEth || 0));
      setTotalLtvEth(Number(payload?.totals?.totalLtvEth || 0));
      const msg = `Loaded ${nextRows.length} NFTs from wallet`;
      setStatus(msg);
      console.log("[Dashboard]", msg);
    } catch (error) {
      const errorMsg = `Mirror load failed: ${(error as Error).message}`;
      setStatus(errorMsg);
      console.error("[Dashboard] Error:", error);
    } finally {
      setLoadingMirror(false);
    }
  }

  async function loadCreditOverview() {
    console.log("[Dashboard] loadCreditOverview called");
    
    if (!hasAllAddresses()) {
      const msg = "Missing contract addresses";
      setStatus(msg);
      console.error("[Dashboard]", msg, "ADDRESSES:", ADDRESSES);
      return;
    }

    setLoadingCredit(true);
    setStatus("Loading collateral, valuation, debt, and risk status...");
    console.log("[Dashboard] All addresses present, starting credit load");
    console.log("[Dashboard] ADDRESSES:", ADDRESSES);

    try {
      const contracts = getContracts(getReadProvider());
      const backend = getBackendBaseUrl();
      console.log("[Dashboard] Backend URL:", backend);
      console.log("[Dashboard] Calling vault.getLockedRightIds()...");
      
      const ids = await contracts.vault.getLockedRightIds();
      console.log("[Dashboard] Got locked right IDs:", ids);

      const nextRows = await Promise.all(
        ids.map(async (id: bigint) => {
          console.log(`[Dashboard] Loading credit data for token ${id.toString()}...`);
          const [floor, valuations, debt, oracleRisk] = await Promise.all([
            contracts.oracle.getFloorValue(id),
            contracts.oracle.getValuations(id),
            contracts.loan.outstandingDebt(id),
            contracts.oracle.getRiskStatus(id),
          ]);

          const floorPriceEth = Number(formatEther(floor));
          const oracleValuationEth = Number(formatEther(valuations.liquidationValue));
          const debtEth = Number(formatEther(debt));
          const ltvPercent = oracleValuationEth > 0 ? (debtEth / oracleValuationEth) * 100 : 100;

          console.log(`[Dashboard] Token ${id.toString()}: floor=${floorPriceEth.toFixed(4)} ETH, liquidationValue=${oracleValuationEth.toFixed(4)} ETH, debt=${debtEth.toFixed(4)} ETH, oracleRisk=${oracleRisk}`);

          let riskStatus: CreditRow["riskStatus"] = oracleRisk ? "panic" : "normal";
          try {
            console.log(`[Dashboard] Fetching backend risk/ltv for token ${id.toString()}...`);
            const [riskRes, ltvRes] = await Promise.all([
              fetch(`${backend}/risk/${id.toString()}`),
              fetch(`${backend}/ltv/${id.toString()}`),
            ]);

            if (riskRes.ok) {
              const riskPayload = await riskRes.json();
              console.log(`[Dashboard] Backend risk response for ${id.toString()}:`, riskPayload);
              const statusRaw = String(riskPayload?.status || "normal").toLowerCase();
              if (statusRaw === "panic" || statusRaw === "warning" || statusRaw === "normal") {
                riskStatus = statusRaw;
              }
            } else {
              console.warn(`[Dashboard] Backend risk response NOT OK: ${riskRes.status}`);
            }

            if (ltvRes.ok) {
              const ltvPayload = await ltvRes.json();
              console.log(`[Dashboard] Backend ltv response for ${id.toString()}:`, ltvPayload);
              const ltvBps = Number(ltvPayload?.ltvBps || 0);
              if (ltvBps > 0 && oracleValuationEth > 0) {
                return {
                  rightsId: Number(id),
                  floorPriceEth,
                  oracleValuationEth,
                  debtEth,
                  ltvPercent: ltvBps / 100,
                  riskStatus,
                };
              }
            } else {
              console.warn(`[Dashboard] Backend ltv response NOT OK: ${ltvRes.status}`);
            }
          } catch (backendError) {
            console.warn(`[Dashboard] Backend fetch error for token ${id.toString()}:`, backendError);
            // Backend is optional; on-chain values are still rendered.
          }

          if (!oracleRisk && ltvPercent > 85) {
            riskStatus = "warning";
          }
          if (ltvPercent >= 100 || oracleRisk) {
            riskStatus = "panic";
          }

          return {
            rightsId: Number(id),
            floorPriceEth,
            oracleValuationEth,
            debtEth,
            ltvPercent,
            riskStatus,
          };
        })
      );

      setCreditRows(nextRows.sort((a, b) => a.rightsId - b.rightsId));
      const msg = `Loaded ${nextRows.length} credit positions`;
      setStatus(msg);
      console.log("[Dashboard]", msg);
    } catch (error) {
      const errorMsg = `Credit load failed: ${(error as Error).message}`;
      setStatus(errorMsg);
      console.error("[Dashboard] Error:", error);
    } finally {
      setLoadingCredit(false);
    }
  }

  return (
    <main className="text-slate-100">
      <section className="mirror-panel">
        <h1 className="text-3xl font-semibold">Dashboard</h1>
        <p className="mt-2 text-sm mirror-muted">
          Per-NFT valuation, debt, dynamic LTV, and risk monitoring across the oracle-credit pipeline.
        </p>

        <div className="mirror-form-grid">
          <div>
            <label className="mb-1 block text-xs mirror-muted">Ballet Wallet Address</label>
            <input
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              className="mirror-input"
              placeholder="0x..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs mirror-muted">LTV Ratio (%)</label>
            <input
              value={ltvPercentInput}
              onChange={(e) => setLtvPercentInput(e.target.value)}
              className="mirror-input"
              placeholder="50"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <QrScannerPanel onWalletDetected={setWalletAddress} />
          <button onClick={loadMirror} disabled={loadingMirror} className="mirror-btn">
            {loadingMirror ? "Loading..." : "Load NFT Mirror"}
          </button>
          <button onClick={loadCreditOverview} disabled={loadingCredit} className="mirror-btn">
            {loadingCredit ? "Loading..." : "Load Credit Overview"}
          </button>
          <span className="text-sm mirror-muted">{status}</span>
        </div>

        <div className="mirror-summary-grid">
          <div className="mirror-card">
            <div className="mirror-card-label">Wallet</div>
            <div className="mirror-card-value">{walletAddress ? shortAddress(walletAddress) : "Not set"}</div>
          </div>
          <div className="mirror-card">
            <div className="mirror-card-label">NFT Count</div>
            <div className="mirror-card-value">{rows.length}</div>
          </div>
          <div className="mirror-card">
            <div className="mirror-card-label">Mirror Total Value</div>
            <div className="mirror-card-value">{totalValueEth.toFixed(6)} ETH</div>
          </div>
          <div className="mirror-card">
            <div className="mirror-card-label">Mirror Total LTV</div>
            <div className="mirror-card-value">{totalLtvEth.toFixed(6)} ETH</div>
          </div>
          <div className="mirror-card">
            <div className="mirror-card-label">Normal / Rare</div>
            <div className="mirror-card-value">{normalCount} / {rareCount}</div>
          </div>
        </div>
      </section>

      <section className="mirror-panel">
        <h2 className="mb-3 text-xl">Credit Engine Positions</h2>
        <div className="mirror-summary-grid" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
          <div className="mirror-card">
            <div className="mirror-card-label">Total Collateral</div>
            <div className="mirror-card-value">{creditTotals.totalCollateral.toFixed(4)} ETH</div>
          </div>
          <div className="mirror-card">
            <div className="mirror-card-label">Total Debt</div>
            <div className="mirror-card-value">{creditTotals.totalDebt.toFixed(4)} ETH</div>
          </div>
          <div className="mirror-card">
            <div className="mirror-card-label">Avg LTV</div>
            <div className="mirror-card-value">{creditTotals.avgLtv.toFixed(2)}%</div>
          </div>
        </div>

        <div className="mirror-table-wrap mt-4">
          <table className="mirror-table text-sm">
            <thead>
              <tr>
                <th>Rights ID</th>
                <th className="num">Floor Price</th>
                <th className="num">Oracle Valuation</th>
                <th className="num">Debt</th>
                <th className="num">LTV %</th>
                <th>Risk Status</th>
              </tr>
            </thead>
            <tbody>
              {creditRows.map((row) => (
                <tr key={row.rightsId}>
                  <td className="mono">{row.rightsId}</td>
                  <td className="num">{row.floorPriceEth.toFixed(4)} ETH</td>
                  <td className="num">{row.oracleValuationEth.toFixed(4)} ETH</td>
                  <td className="num">{row.debtEth.toFixed(4)} ETH</td>
                  <td className="num">{row.ltvPercent.toFixed(2)}%</td>
                  <td className={riskClass(row.riskStatus)}>{row.riskStatus.toUpperCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mirror-panel">
        <h2 className="mb-3 text-xl">NFT Mirror Output</h2>
        <div className="mirror-table-wrap">
          <table className="mirror-table text-sm">
            <thead>
              <tr>
                <th>NFT ID</th>
                <th>Contract Address</th>
                <th>NFT Type</th>
                <th>Oracle Used</th>
                <th>Oracle Source</th>
                <th className="num">Oracle Price</th>
                <th className="num">LTV Value</th>
                <th className="num">Trait Prevalence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.contractAddress}:${row.tokenId}`}>
                  <td className="mono">{row.tokenId}</td>
                  <td className="mono text-xs">{row.contractAddress}</td>
                  <td>
                    <span className={row.nftType === "RARE" ? "accent-rare" : "accent-normal"}>{row.nftType}</span>
                  </td>
                  <td>{row.oracleName}</td>
                  <td>{row.oracleSource}</td>
                  <td className="num">{row.oraclePriceEth !== null ? `${row.oraclePriceEth.toFixed(6)} ETH` : "n/a"}</td>
                  <td className="num">{row.ltvEth !== null ? `${row.ltvEth.toFixed(6)} ETH` : "n/a"}</td>
                  <td className="num">
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
        <h3 className="mb-2 text-lg">Contract Wiring</h3>
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
