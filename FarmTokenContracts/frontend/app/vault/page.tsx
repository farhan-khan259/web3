"use client";

import { useState } from "react";
import { formatEther } from "ethers";
import QrScannerPanel from "../../components/QrScannerPanel";
import { getContracts, getReadProvider, hasAllAddresses, nftTypeLabel, shortAddress } from "../../lib/contracts";

type LockedRow = {
  rightsId: number;
  owner: string;
  nftType: number;
  oracleValue: bigint;
  snapshotValue: bigint;
  debt: bigint;
  ltvBps: bigint;
  oracleRouteValid: boolean;
};

export default function VaultPage() {
  const [walletAddress, setWalletAddress] = useState("");
  const [status, setStatus] = useState("Idle");
  const [rows, setRows] = useState<LockedRow[]>([]);

  async function refresh() {
    if (!hasAllAddresses()) return;

    try {
      const contracts = getContracts(getReadProvider());
      const wallet = walletAddress.trim();
      const ids = wallet
        ? await contracts.vault.getLockedRightsByWallet(wallet)
        : await contracts.vault.getLockedRightIds();

      const all = await Promise.all(
        ids.map(async (id: bigint) => {
          const [owner, nftType, snapshotValue, oracleValue, debt] = await Promise.all([
            contracts.vault.lockedBy(id),
            contracts.vault.rightTypeOf(id),
            contracts.vault.getSnapshotValue(id),
            contracts.oracle.getFloorValue(id),
            contracts.loan.outstandingDebt(id),
          ]);

          const routeValid = await contracts.oracle.validateOraclePath(id, nftType);
          const ltvBps = snapshotValue > 0n ? (debt * 10000n) / snapshotValue : 0n;

          return {
            rightsId: Number(id),
            owner,
            nftType: Number(nftType),
            oracleValue,
            snapshotValue,
            debt,
            ltvBps,
            oracleRouteValid: Boolean(routeValid),
          };
        })
      );

      const walletLower = wallet.toLowerCase();
      const filtered = walletLower ? all.filter((x) => x.owner.toLowerCase() === walletLower) : all;
      setRows(filtered);
      setStatus(`Loaded ${filtered.length} locked rights`);
    } catch (error) {
      setStatus(`Refresh failed: ${(error as Error).message}`);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 text-slate-100">
      <h1 className="text-3xl font-semibold">Vault (Minting Rights)</h1>
      <p className="mt-2 text-sm text-slate-400">
        Minting rights are locked as collateral. This page is read-only and uses manual/QR wallet input.
      </p>

      {!hasAllAddresses() && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
          Missing NEXT_PUBLIC contract addresses.
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3">
        <div>
          <label className="mb-2 block text-sm text-slate-300">Enter Wallet Address</label>
          <input
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            placeholder="0x..."
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        <QrScannerPanel onWalletDetected={setWalletAddress} />
        <button onClick={refresh} className="rounded-md border border-slate-700 px-4 py-2 text-sm">Refresh</button>
      </div>

      <div className="mt-4 text-sm text-slate-300">Wallet: {walletAddress ? shortAddress(walletAddress) : "Not set"}</div>
      <div className="mt-2 text-sm text-slate-300">{status}</div>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
        <h2 className="mb-3 text-lg">Locked Rights</h2>
        <div className="space-y-2 text-sm">
          {rows.map((r) => (
            <div key={r.rightsId} className="rounded border border-slate-800 bg-slate-950/60 p-3">
              <div>Rights ID: #{r.rightsId}</div>
              <div>Owner: <span className="font-mono text-xs">{r.owner}</span></div>
              <div>Type: <span className={r.nftType === 1 ? "text-amber-300" : "text-cyan-300"}>{nftTypeLabel(r.nftType)}</span></div>
              <div>Oracle Value: {formatEther(r.oracleValue)} ETH</div>
              <div>Snapshot Value: {formatEther(r.snapshotValue)} ETH</div>
              <div>Debt: {formatEther(r.debt)} ETH</div>
              <div>LTV: {(Number(r.ltvBps) / 100).toFixed(2)}%</div>
              <div>Oracle Used: {r.nftType === 1 ? "Rare Oracle" : "Normal Oracle"}</div>
              <div>Oracle Route Valid: {r.oracleRouteValid ? "YES" : "NO"}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
