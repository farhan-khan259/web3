"use client";

import { useMemo, useState } from "react";
import { BrowserProvider, parseEther } from "ethers";
import { getBrowserProvider, getContracts, hasAllAddresses, shortAddress } from "../../lib/contracts";

export default function RevenuePage() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [account, setAccount] = useState("");
  const [tokenId, setTokenId] = useState("1");
  const [amount, setAmount] = useState("0.1");
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

  async function depositRevenue() {
    if (!provider) return;
    setStatus("Submitting revenue deposit...");
    try {
      const signer = await provider.getSigner();
      const contracts = getContracts(signer);
      const tx = await contracts.router.depositRevenue(BigInt(tokenId), { value: parseEther(amount) });
      await tx.wait();
      setStatus("Revenue processed");
    } catch (error) {
      setStatus(`Revenue failed: ${(error as Error).message}`);
    }
  }

  const contractsReady = useMemo(() => hasAllAddresses(), []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 text-slate-100">
      <h1 className="text-3xl font-semibold">Revenue Router</h1>
      <p className="mt-2 text-sm text-slate-400">Deposits route 100% to debt in panic, otherwise 70% debt and 30% user payout.</p>

      {!contractsReady && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">Missing contract env config.</div>
      )}

      <div className="mt-6 flex gap-2">
        <button onClick={connect} className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm">
          {account ? `Connected: ${shortAddress(account)}` : "Connect MetaMask"}
        </button>
      </div>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
        <label className="mb-2 block text-sm text-slate-300">Token ID</label>
        <input className="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={tokenId} onChange={(e) => setTokenId(e.target.value)} />

        <label className="mb-2 block text-sm text-slate-300">Deposit Amount (ETH)</label>
        <input className="mb-4 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={amount} onChange={(e) => setAmount(e.target.value)} />

        <button onClick={depositRevenue} className="rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-white">Deposit Revenue</button>
      </div>

      <div className="mt-4 text-sm text-slate-300">{status}</div>
    </main>
  );
}
