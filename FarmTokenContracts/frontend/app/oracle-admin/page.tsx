"use client";

import { useMemo, useState } from "react";
import { BrowserProvider, parseEther } from "ethers";
import { getBrowserProvider, getContracts, hasAllAddresses, shortAddress } from "../../lib/contracts";

export default function OracleAdminPage() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [account, setAccount] = useState("");
  const [tokenId, setTokenId] = useState("1");
  const [valueEth, setValueEth] = useState("20");
  const [volatility, setVolatility] = useState("10");
  const [trademarkValid, setTrademarkValid] = useState(true);
  const [provenanceValid, setProvenanceValid] = useState(true);
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

  async function pushOracleData() {
    if (!provider) return;
    setStatus("Submitting oracle update...");
    try {
      const signer = await provider.getSigner();
      const contracts = getContracts(signer);
      const tx = await contracts.oracle.setOracleData(
        BigInt(tokenId),
        parseEther(valueEth),
        BigInt(volatility),
        trademarkValid,
        provenanceValid
      );
      await tx.wait();
      setStatus("Oracle updated on-chain");
    } catch (error) {
      setStatus(`Oracle update failed: ${(error as Error).message}`);
    }
  }

  const contractsReady = useMemo(() => hasAllAddresses(), []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 text-slate-100">
      <h1 className="text-3xl font-semibold">Oracle Admin</h1>
      <p className="mt-2 text-sm text-slate-400">Push valuation, volatility, trademark, and provenance data directly on-chain.</p>

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

        <label className="mb-2 block text-sm text-slate-300">Value (ETH)</label>
        <input className="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={valueEth} onChange={(e) => setValueEth(e.target.value)} />

        <label className="mb-2 block text-sm text-slate-300">Volatility Index (0-100)</label>
        <input className="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={volatility} onChange={(e) => setVolatility(e.target.value)} />

        <div className="mb-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={trademarkValid} onChange={(e) => setTrademarkValid(e.target.checked)} />
          Trademark Valid
        </div>
        <div className="mb-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={provenanceValid} onChange={(e) => setProvenanceValid(e.target.checked)} />
          Provenance Valid
        </div>

        <button onClick={pushOracleData} className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-slate-950">Set Oracle Data</button>
      </div>

      <div className="mt-4 text-sm text-slate-300">{status}</div>
    </main>
  );
}
