"use client";

import { useEffect, useMemo, useState } from "react";
import { BrowserProvider } from "ethers";
import { ADDRESSES, getBrowserProvider, getContracts, hasAllAddresses, shortAddress } from "../../lib/contracts";

export default function VaultPage() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [account, setAccount] = useState("");
  const [tokenId, setTokenId] = useState("1");
  const [receiver, setReceiver] = useState("");
  const [locked, setLocked] = useState<number[]>([]);
  const [status, setStatus] = useState("Idle");

  async function connect() {
    try {
      const p = getBrowserProvider();
      await p.send("eth_requestAccounts", []);
      const signer = await p.getSigner();
      const addr = await signer.getAddress();
      setProvider(p);
      setAccount(addr);
      if (!receiver) setReceiver(addr);
      setStatus("Wallet connected");
    } catch (error) {
      setStatus(`Connect failed: ${(error as Error).message}`);
    }
  }

  async function refresh() {
    if (!provider || !hasAllAddresses()) return;
    try {
      const contracts = getContracts(provider);
      const ids = await contracts.vault.getLockedTokenIds();
      setLocked(ids.map((id: bigint) => Number(id)));
      setStatus("Vault state refreshed");
    } catch (error) {
      setStatus(`Refresh failed: ${(error as Error).message}`);
    }
  }

  useEffect(() => {
    if (provider) {
      refresh();
    }
  }, [provider]);

  async function deposit() {
    if (!provider) return;
    setStatus("Depositing NFT...");
    try {
      const signer = await provider.getSigner();
      const contracts = getContracts(signer);
      const parsed = BigInt(tokenId);
      const txApprove = await contracts.nft.approve(ADDRESSES.vault, parsed);
      await txApprove.wait();
      const tx = await contracts.vault.depositNFT(parsed);
      await tx.wait();
      await refresh();
      setStatus("NFT deposited and snapshot captured");
    } catch (error) {
      setStatus(`Deposit failed: ${(error as Error).message}`);
    }
  }

  async function mintDemoNft() {
    if (!provider) return;
    setStatus("Minting demo NFT...");
    try {
      const signer = await provider.getSigner();
      const contracts = getContracts(signer);
      const parsed = BigInt(tokenId);
      const tx = await contracts.nft.mint(await signer.getAddress(), parsed);
      await tx.wait();
      setStatus(`Demo NFT #${tokenId} minted to connected wallet`);
    } catch (error) {
      setStatus(`Mint failed: ${(error as Error).message}`);
    }
  }

  async function withdraw() {
    if (!provider) return;
    setStatus("Withdrawing NFT...");
    try {
      const signer = await provider.getSigner();
      const contracts = getContracts(signer);
      const tx = await contracts.vault.withdrawNFT(BigInt(tokenId), receiver);
      await tx.wait();
      await refresh();
      setStatus("NFT withdrawn");
    } catch (error) {
      setStatus(`Withdraw failed: ${(error as Error).message}`);
    }
  }

  const contractsReady = useMemo(() => hasAllAddresses(), []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 text-slate-100">
      <h1 className="text-3xl font-semibold">Vault</h1>
      <p className="mt-2 text-sm text-slate-400">Mint demo NFT, deposit into vault, capture snapshot value, and manage locked positions.</p>

      {!contractsReady && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
          Missing NEXT_PUBLIC contract addresses or NFT address.
        </div>
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
        <label className="mb-2 block text-sm text-slate-300">Withdraw Receiver</label>
        <input className="mb-4 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2" value={receiver} onChange={(e) => setReceiver(e.target.value)} />
        <div className="flex gap-2">
          <button onClick={mintDemoNft} className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950">Mint Demo NFT</button>
          <button onClick={deposit} className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950">Deposit NFT</button>
          <button onClick={withdraw} className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-slate-950">Withdraw NFT</button>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
        <h2 className="mb-3 text-lg">Locked NFTs</h2>
        <div className="text-sm text-slate-200">{locked.length ? locked.map((id) => `#${id}`).join(", ") : "None"}</div>
      </div>

      <div className="mt-4 text-sm text-slate-300">{status}</div>
    </main>
  );
}
