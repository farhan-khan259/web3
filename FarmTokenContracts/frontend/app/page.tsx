"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, formatEther } from "ethers";
import { ADDRESSES, getBrowserProvider, getContracts, hasAllAddresses, shortAddress } from "../lib/contracts";

type Row = {
  tokenId: number;
  floorValue: bigint;
  snapshotValue: bigint;
  debt: bigint;
  ltv: bigint;
  panic: boolean;
  risk: boolean;
};

type WalletRow = {
  tokenId: number;
  owner: string;
  floorValue: bigint;
};

function bpsToPercent(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

export default function DashboardPage() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [account, setAccount] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [volatility, setVolatility] = useState<bigint>(0n);
  const [maxLtv, setMaxLtv] = useState<bigint>(0n);
  const [status, setStatus] = useState("Idle");
  const [walletAddressInput, setWalletAddressInput] = useState("");
  const [walletTokenIdsInput, setWalletTokenIdsInput] = useState("1");
  const [walletRows, setWalletRows] = useState<WalletRow[]>([]);
  const [walletStatus, setWalletStatus] = useState("Idle");

  const totalValue = useMemo(() => rows.reduce((acc, row) => acc + row.snapshotValue, 0n), [rows]);
  const totalDebt = useMemo(() => rows.reduce((acc, row) => acc + row.debt, 0n), [rows]);
  const walletTotalValue = useMemo(() => walletRows.reduce((acc, row) => acc + row.floorValue, 0n), [walletRows]);

  const connect = useCallback(async () => {
    try {
      const p = getBrowserProvider();
      await p.send("eth_requestAccounts", []);
      const signer = await p.getSigner();
      const signerAddress = await signer.getAddress();
      setProvider(p);
      setAccount(signerAddress);
      if (!walletAddressInput) {
        setWalletAddressInput(signerAddress);
      }
      setStatus("Wallet connected");
    } catch (error) {
      setStatus(`Connect failed: ${(error as Error).message}`);
    }
  }, [walletAddressInput]);

  const refreshWalletValues = useCallback(async () => {
    if (!provider || !hasAllAddresses()) return;
    const trimmedWallet = walletAddressInput.trim();
    if (!trimmedWallet) {
      setWalletStatus("Enter wallet address");
      return;
    }

    const parsedIds = walletTokenIdsInput
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n >= 0);

    if (!parsedIds.length) {
      setWalletStatus("Enter token IDs, e.g. 1,2,3");
      return;
    }

    try {
      const contracts = getContracts(provider);
      const results = await Promise.all(
        parsedIds.map(async (id) => {
          const [owner, floorValue] = await Promise.all([
            contracts.nft.ownerOf(BigInt(id)),
            contracts.oracle.getFloorValue(BigInt(id)),
          ]);
          return {
            tokenId: id,
            owner,
            floorValue,
          } as WalletRow;
        })
      );

      const normalizedWallet = trimmedWallet.toLowerCase();
      const owned = results.filter((r) => r.owner.toLowerCase() === normalizedWallet);
      setWalletRows(owned);
      setWalletStatus(`Loaded ${owned.length} NFTs for wallet`);
    } catch (error) {
      setWalletStatus(`Wallet valuation failed: ${(error as Error).message}`);
    }
  }, [provider, walletAddressInput, walletTokenIdsInput]);

  const refresh = useCallback(async () => {
    if (!provider || !hasAllAddresses()) return;
    try {
      const contracts = getContracts(provider);
      let lockedIds: bigint[] = [];
      let vol = 0n;
      let dynamicMax = 0n;

      try {
        lockedIds = await contracts.vault.getLockedTokenIds();
      } catch {
        lockedIds = [];
      }

      try {
        vol = await contracts.oracle.volatilityIndex();
      } catch {
        vol = 0n;
      }

      try {
        dynamicMax = await contracts.loan.getDynamicMaxLTV();
      } catch {
        dynamicMax = 0n;
      }

      const allRows = await Promise.all(
        lockedIds.map(async (id: bigint) => {
          const tokenId = Number(id);
          const [floorValue, snapshot, position, ltv, risk] = await Promise.all([
            contracts.oracle.getFloorValue(id),
            contracts.vault.getSnapshotValue(id),
            contracts.loan.positions(id),
            contracts.loan.getCurrentLTV(id),
            contracts.oracle.getRiskStatus(id),
          ]);
          return {
            tokenId,
            floorValue,
            snapshotValue: snapshot,
            debt: position.debt,
            ltv,
            panic: position.inPanic,
            risk,
          } as Row;
        })
      );

      setRows(allRows);
      setVolatility(vol);
      setMaxLtv(dynamicMax);
      setStatus(
        lockedIds.length
          ? "Live data refreshed"
          : "Live data refreshed (vault position methods unavailable for current address/network)"
      );
    } catch (error) {
      setStatus(`Refresh failed: ${(error as Error).message}`);
    }
  }, [provider]);

  useEffect(() => {
    if (!provider) return;
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [provider, refresh]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8 text-slate-100">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">Dashboard</h1>
            <p className="mt-2 text-sm text-slate-400">Real-time data from local Hardhat contracts.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={refresh} className="rounded-md border border-slate-700 px-4 py-2 text-sm hover:border-cyan-400">Refresh</button>
            <button onClick={connect} className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
              {account ? `Connected: ${shortAddress(account)}` : "Connect MetaMask"}
            </button>
          </div>
        </div>

        {!hasAllAddresses() && (
          <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            Missing NEXT_PUBLIC contract addresses.
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3"><div className="text-xs text-slate-400">Snapshot Value</div><div>{formatEther(totalValue)} ETH</div></div>
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3"><div className="text-xs text-slate-400">Debt</div><div>{formatEther(totalDebt)} ETH</div></div>
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3"><div className="text-xs text-slate-400">Volatility</div><div>{volatility.toString()}</div></div>
          <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3"><div className="text-xs text-slate-400">Dynamic Max LTV</div><div>{bpsToPercent(maxLtv)}</div></div>
        </div>

        <div className="mt-4 text-sm text-slate-300">{status}</div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <h2 className="mb-3 text-xl">Wallet NFT Valuation</h2>
        <p className="mb-3 text-sm text-slate-400">This section shows wallet-held NFT value from Oracle, separate from vault collateral/LTV.</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Wallet Address</label>
            <input
              value={walletAddressInput}
              onChange={(e) => setWalletAddressInput(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="0x..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Token IDs (comma separated)</label>
            <input
              value={walletTokenIdsInput}
              onChange={(e) => setWalletTokenIdsInput(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="1,2,3"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={refreshWalletValues} className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-200">Load Wallet Values</button>
          <div className="text-sm text-slate-300">{walletStatus}</div>
        </div>
        <div className="mt-3 text-sm text-slate-200">Wallet Total Oracle Value: {formatEther(walletTotalValue)} ETH</div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="pb-2">Token ID</th>
                <th className="pb-2">Owner</th>
                <th className="pb-2">Oracle Value</th>
              </tr>
            </thead>
            <tbody>
              {walletRows.map((row) => (
                <tr key={row.tokenId} className="border-t border-slate-800">
                  <td className="py-2">#{row.tokenId}</td>
                  <td className="py-2 font-mono text-xs">{row.owner}</td>
                  <td className="py-2">{formatEther(row.floorValue)} ETH</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
        <h2 className="mb-3 text-xl">Position Table</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="pb-2">Token ID</th>
                <th className="pb-2">Snapshot Value</th>
                <th className="pb-2">Oracle Value</th>
                <th className="pb-2">Debt</th>
                <th className="pb-2">LTV</th>
                <th className="pb-2">Panic</th>
                <th className="pb-2">Oracle Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.tokenId} className="border-t border-slate-800">
                  <td className="py-2">#{row.tokenId}</td>
                  <td className="py-2">{formatEther(row.snapshotValue)} ETH</td>
                  <td className="py-2">{formatEther(row.floorValue)} ETH</td>
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
