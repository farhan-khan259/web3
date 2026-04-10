"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { type Address, formatEther } from "viem";
import { ADDRESSES, getContracts, getReadProvider } from "../../../../lib/contracts";
import { isAdmin } from "../../../../lib/auth";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";

type LockedRight = {
  tokenId: number;
  owner: string;
  lockTimestamp: string;
  snapshotValuationEth: number;
};

const liquidationAbi = [
  "function checkAndLiquidate(uint256 rightsId) external returns (bool)",
] as const;

export default function VaultAdminPage() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<LockedRight[]>([]);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("Risk threshold exceeded");
  const [selectedTokenId, setSelectedTokenId] = useState<string>("");
  const [forcingLiquidation, setForcingLiquidation] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [message, setMessage] = useState("");

  const adminWallet = useMemo(() => Boolean(address && isAdmin(address)), [address]);

  useEffect(() => {
    let mounted = true;

    async function loadLockedRights() {
      setLoading(true);
      setError("");

      try {
        const contracts = getContracts(getReadProvider());
        const idsRaw = await contracts.vault.getLockedRightIds();
        const tokenIds = (idsRaw as bigint[]).map((id) => Number(id));

        const nextRows: LockedRight[] = [];
        for (const tokenId of tokenIds) {
          const [owner, snapshot] = await Promise.all([
            contracts.vault.lockedBy(BigInt(tokenId)),
            contracts.vault.getSnapshotValue(BigInt(tokenId)),
          ]);

          // Lock timestamp is not stored in the current Vault contract storage layout.
          nextRows.push({
            tokenId,
            owner: String(owner),
            lockTimestamp: "N/A",
            snapshotValuationEth: Number(formatEther(snapshot)),
          });
        }

        if (mounted) {
          setRows(nextRows);
          if (!selectedTokenId && nextRows[0]) {
            setSelectedTokenId(String(nextRows[0].tokenId));
          }
        }
      } catch (err) {
        if (mounted) {
          setError((err as Error).message || "Failed to load locked rights");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadLockedRights();
    return () => {
      mounted = false;
    };
  }, [selectedTokenId]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => String(row.tokenId).includes(q) || row.owner.toLowerCase().includes(q));
  }, [rows, search]);

  async function forceLiquidate() {
    if (!adminWallet || !selectedTokenId) {
      setError("Admin wallet and token selection are required.");
      return;
    }

    setForcingLiquidation(true);
    setError("");
    setMessage("");

    try {
      const tokenId = Number(selectedTokenId);
      if (!Number.isFinite(tokenId) || tokenId <= 0) {
        throw new Error("Invalid tokenId for liquidation");
      }

      await writeContractAsync({
        abi: liquidationAbi,
        address: ADDRESSES.loan as Address,
        functionName: "checkAndLiquidate",
        args: [BigInt(tokenId)],
      } as never);

      setMessage(`Force liquidation submitted for token #${tokenId}. Reason: ${reason}`);
    } catch (err) {
      setError((err as Error).message || "Force liquidation failed");
    } finally {
      setForcingLiquidation(false);
    }
  }

  async function pauseVault() {
    if (!adminWallet) {
      setError("Admin wallet is required.");
      return;
    }

    setPausing(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/propose-vault-pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposer: address,
          action: "Vault.pause()",
          reason,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to create vault pause multisig proposal");
      }

      setMessage("Pause Vault proposal submitted to multisig workflow.");
    } catch (err) {
      setError((err as Error).message || "Pause proposal failed");
    } finally {
      setPausing(false);
    }
  }

  if (!isConnected || !address) {
    return (
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold">Vault Manager</h1>
        <p className="text-sm opacity-80">Connect your admin wallet to access vault controls.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Vault Manager</h1>
        <p className="mt-1 text-sm opacity-80">Locked rights inventory, search filters, and emergency controls.</p>
      </div>

      {!adminWallet ? (
        <Card><CardContent className="pt-6 text-sm text-rose-300">Connected wallet is not an admin signer.</CardContent></Card>
      ) : null}

      {error ? <Card><CardContent className="pt-6 text-sm text-rose-300">{error}</CardContent></Card> : null}
      {message ? <Card><CardContent className="pt-6 text-sm text-emerald-300">{message}</CardContent></Card> : null}

      <Card>
        <CardHeader>
          <CardTitle>Locked Minting Rights</CardTitle>
          <CardDescription>Token ID, owner, lock timestamp, snapshot valuation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            className="w-full rounded border bg-transparent px-3 py-2 text-sm"
            placeholder="Search by owner or tokenId"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token ID</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Lock Timestamp</TableHead>
                  <TableHead>Snapshot Valuation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow
                    key={row.tokenId}
                    className={selectedTokenId === String(row.tokenId) ? "bg-cyan-500/10" : ""}
                    onClick={() => setSelectedTokenId(String(row.tokenId))}
                  >
                    <TableCell>#{row.tokenId}</TableCell>
                    <TableCell>{row.owner}</TableCell>
                    <TableCell>{row.lockTimestamp}</TableCell>
                    <TableCell>{row.snapshotValuationEth.toFixed(4)} ETH</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Emergency Actions</CardTitle>
          <CardDescription>Force liquidation and vault pause controls (admin/multisig paths).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">Selected Token:</span>
            <Badge variant="secondary">{selectedTokenId ? `#${selectedTokenId}` : "None"}</Badge>
          </div>
          <textarea
            className="w-full rounded border bg-transparent px-3 py-2 text-sm"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={forceLiquidate} disabled={!adminWallet || forcingLiquidation || !selectedTokenId}>
              {forcingLiquidation ? "Submitting..." : "Force Liquidate"}
            </Button>
            <Button variant="outline" onClick={pauseVault} disabled={!adminWallet || pausing}>
              {pausing ? "Submitting..." : "Pause Vault"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
