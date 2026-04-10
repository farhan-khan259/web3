"use client";

import { useEffect, useMemo, useState } from "react";
import { useWriteContract, useAccount } from "wagmi";
import { type Address, formatEther } from "viem";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { ADDRESSES, getContracts, getReadProvider, vaultAbi } from "../../../lib/contracts";

type DepositRow = {
  tokenId: number;
  valuationEth: number;
  maxBorrowEth: number;
  nftType: number;
};

const COLLECTION_ADDRESS = "0x0c06d6a17eb208a9bc7bd698eb6f22379209e3a4";

function normalizeTokenId(raw: any): number {
  const tokenIdRaw = raw?.tokenId ?? raw?.id?.tokenId ?? 0;
  if (typeof tokenIdRaw === "string" && tokenIdRaw.startsWith("0x")) {
    return parseInt(tokenIdRaw, 16);
  }
  return Number(tokenIdRaw) || 0;
}

export default function VaultDepositPage() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const [rows, setRows] = useState<DepositRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [depositingTokenId, setDepositingTokenId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      if (!address) {
        setRows([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      setToast(null);

      try {
        const contracts = getContracts(getReadProvider());
        const [ownedRes, lockedIdsRaw] = await Promise.all([
          fetch(`/api/nfts/owned?wallet=${encodeURIComponent(address)}&collection=${encodeURIComponent(COLLECTION_ADDRESS)}`, {
            cache: "no-store",
          }),
          contracts.vault.getLockedRightsByWallet(address),
        ]);

        if (!ownedRes.ok) {
          throw new Error("Failed to load wallet NFTs");
        }

        const ownedJson = await ownedRes.json();
        const ownedNfts = ownedJson?.nfts ?? ownedJson?.ownedNfts ?? ownedJson ?? [];
        const ownedTokenIds = ownedNfts.map((item: any) => normalizeTokenId(item)).filter((id: number) => Number.isFinite(id));

        const lockedSet = new Set<number>((lockedIdsRaw as bigint[]).map((id) => Number(id)));
        const unlockedTokenIds = ownedTokenIds.filter((id: number) => !lockedSet.has(id));

        const nextRows = await Promise.all(
          unlockedTokenIds.map(async (tokenId: number) => {
            let valuationRaw = 0n;
            let nftTypeRaw = 0n;
            try {
              [valuationRaw, nftTypeRaw] = await Promise.all([
                contracts.oracle.getFloorValue(BigInt(tokenId)),
                contracts.oracle.rightTypeOf(BigInt(tokenId)),
              ]);
            } catch {
              valuationRaw = 0n;
              nftTypeRaw = 0n;
            }

            const valuationEth = Number(formatEther(valuationRaw));
            return {
              tokenId,
              valuationEth,
              maxBorrowEth: valuationEth * 0.7,
              nftType: Number(nftTypeRaw),
            };
          })
        );

        if (mounted) {
          setRows(nextRows);
        }
      } catch (err) {
        if (mounted) {
          setError((err as Error).message || "Failed to load vault deposit data");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadData();
    return () => {
      mounted = false;
    };
  }, [address]);

  const hasRows = useMemo(() => rows.length > 0, [rows]);

  async function handleDeposit(row: DepositRow) {
    if (!address) {
      return;
    }

    setDepositingTokenId(row.tokenId);
    setToast(null);

    try {
      // In this codebase, lockMintingRights accepts a single rightsId (not an array) plus type/locker/ack flag.
      await writeContractAsync({
        abi: vaultAbi,
        address: ADDRESSES.vault as Address,
        functionName: "lockMintingRights",
        args: [BigInt(row.tokenId), BigInt(row.nftType), address as Address, true],
      } as never);

      setToast({ kind: "success", message: `Token #${row.tokenId} deposited successfully.` });
      setRows((prev) => prev.filter((entry) => entry.tokenId !== row.tokenId));
    } catch (err) {
      setToast({ kind: "error", message: (err as Error).message || "Deposit failed" });
    } finally {
      setDepositingTokenId(null);
    }
  }

  if (!isConnected || !address) {
    return (
      <section className="mx-auto max-w-6xl p-6">
        <h1 className="text-3xl font-semibold">Vault Deposit</h1>
        <p className="mt-2 text-sm opacity-80">Connect your wallet to view unlocked NFTs for rights locking.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold">Vault Deposit</h1>
        <p className="mt-2 text-sm opacity-80">
          Rights-only lock flow. No ERC721 transfer is performed; only minting rights are locked in vault.
        </p>
      </div>

      {toast ? (
        <Card>
          <CardContent className={`pt-6 text-sm ${toast.kind === "success" ? "text-emerald-300" : "text-rose-300"}`}>
            {toast.message}
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-rose-300">{error}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Unlocked NFTs</CardTitle>
          <CardDescription>
            Filtered using MintingRightsVault locked-rights state for your wallet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : hasRows ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token ID</TableHead>
                  <TableHead>Oracle Valuation</TableHead>
                  <TableHead>Estimated Max Borrow (70%)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.tokenId}>
                    <TableCell>#{row.tokenId}</TableCell>
                    <TableCell>{row.valuationEth.toFixed(4)} ETH</TableCell>
                    <TableCell>{row.maxBorrowEth.toFixed(4)} ETH</TableCell>
                    <TableCell>
                      <Badge variant="secondary">Unlocked</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        onClick={() => handleDeposit(row)}
                        disabled={depositingTokenId === row.tokenId}
                      >
                        {depositingTokenId === row.tokenId ? "Depositing..." : "Deposit"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm opacity-80">No unlocked NFTs found for this wallet.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
