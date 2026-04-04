"use client";

import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, formatEther, parseEther } from "ethers";
import { getBrowserProvider, getContracts, hasAllAddresses, shortAddress } from "../../lib/contracts";

export default function BorrowPage() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [account, setAccount] = useState("");
  const [tokenId, setTokenId] = useState("1");
  const [amount, setAmount] = useState("0.1");
  const [snapshotValue, setSnapshotValue] = useState<bigint>(0n);
  const [debt, setDebt] = useState<bigint>(0n);
  const [maxLtv, setMaxLtv] = useState<bigint>(0n);
  const [maxBorrow, setMaxBorrow] = useState<bigint>(0n);
  const [panic, setPanic] = useState(false);
  const [status, setStatus] = useState("Idle");

  async function connect() {
    try {
      const p = getBrowserProvider();
      await p.send("eth_requestAccounts", []);
      const signer = await p.getSigner();
      setProvider(p);
      setAccount(await signer.getAddress());
      setStatus("Wallet connected");
    } catch (error) {
      setStatus(`Connect failed: ${(error as Error).message}`);
    }
  }

  async function refresh() {
    if (!provider || !hasAllAddresses()) return;
    try {
      const contracts = getContracts(provider);
      const parsed = BigInt(tokenId);
      const [snap, position, dynamicMax, panicMode] = await Promise.all([
        contracts.vault.getSnapshotValue(parsed),
        contracts.loan.positions(parsed),
        contracts.loan.getDynamicMaxLTV(),
        contracts.loan.isPanicMode(parsed),
      ]);
      const dynamicMaxBps = BigInt(dynamicMax);
      const allowed = (snap * dynamicMaxBps) / 10000n;
      const headroom = allowed > position.debt ? allowed - position.debt : 0n;
      setSnapshotValue(snap);
      setDebt(position.debt);
      setMaxLtv(dynamicMaxBps);
      setMaxBorrow(headroom);
      setPanic(panicMode);
      setStatus("Borrow state refreshed");
    } catch (error) {
      setStatus(`Refresh failed: ${(error as Error).message}`);
    }
  }

  useEffect(() => {
    if (provider) refresh();
  }, [provider, tokenId]);

  async function executeBorrow() {
    if (!provider) return;
    setStatus("Submitting borrow...");
    try {
      const signer = await provider.getSigner();
      const contracts = getContracts(signer);
      const tx = await contracts.loan.borrow(BigInt(tokenId), parseEther(amount));
      await tx.wait();
      await refresh();
      setStatus("Borrow completed");
    } catch (error) {
      setStatus(`Borrow failed: ${(error as Error).message}`);
    }
  }

  async function runPanicCheck() {
    if (!provider) return;
    setStatus("Running panic check...");
    try {
      const signer = await provider.getSigner();
      const contracts = getContracts(signer);
      const tx = await contracts.loan.checkAndUpdatePanic(BigInt(tokenId));
      await tx.wait();
      await refresh();
      setStatus("Panic state recalculated");
    } catch (error) {
      setStatus(`Panic check failed: ${(error as Error).message}`);
    }
  }

  const contractsReady = useMemo(() => hasAllAddresses(), []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 text-slate-100">
      <h1 className="text-3xl font-semibold">Borrow</h1>
      <p className="mt-2 text-sm text-slate-400">Borrow against vault snapshot value with dynamic LTV and panic controls on localhost.</p>

      {!contractsReady && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">Missing contract env config.</div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <button onClick={connect} className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm">
          {account ? `Connected: ${shortAddress(account)}` : "Connect MetaMask"}
        </button>
        <button onClick={refresh} className="rounded-md border border-slate-700 px-4 py-2 text-sm">Refresh</button>
      </div>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
        <label className="mb-2 block text-sm text-slate-300">Token ID</label>
        <input className="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={tokenId} onChange={(e) => setTokenId(e.target.value)} />

        <label className="mb-2 block text-sm text-slate-300">Borrow Amount (ETH)</label>
        <input className="mb-4 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={amount} onChange={(e) => setAmount(e.target.value)} />

        <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2 text-sm">
          <div>Snapshot Value: {formatEther(snapshotValue)} ETH</div>
          <div>Current Debt: {formatEther(debt)} ETH</div>
          <div>Dynamic Max LTV: {(Number(maxLtv) / 100).toFixed(2)}%</div>
          <div>Max Borrow: {formatEther(maxBorrow)} ETH</div>
          <div>Status: {panic ? "PANIC" : "SAFE"}</div>
        </div>

        <div className="flex gap-2">
          <button onClick={executeBorrow} className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950">Execute Borrow</button>
          <button onClick={runPanicCheck} className="rounded-md bg-rose-500 px-4 py-2 text-sm font-medium text-white">Run Panic Check</button>
        </div>
      </div>

      <div className="mt-4 text-sm text-slate-300">{status}</div>
    </main>
  );
}
