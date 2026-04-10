"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useWriteContract } from "wagmi";
import { type Address, formatEther, parseEther } from "viem";
import { ADDRESSES, getContracts, getReadProvider } from "../../../lib/contracts";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";

type EligibleRow = {
  tokenId: number;
  nftType: number;
  valuationEth: number;
  dynamicLtvBps: number;
  maxBorrowEth: number;
};

const borrowRequestAbi = [
  "function requestLoan(uint256 tokenId, uint256 amount, uint256 duration) external",
] as const;

export default function BorrowPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<EligibleRow[]>([]);
  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);
  const [loanAmountEth, setLoanAmountEth] = useState("0");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadEligible() {
      if (!address) {
        setRows([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const contracts = getContracts(getReadProvider());
        const lockedIdsRaw = await contracts.vault.getLockedRightsByWallet(address);
        const lockedIds = (lockedIdsRaw as bigint[]).map((id) => Number(id));

        const nextRows: EligibleRow[] = [];

        for (const tokenId of lockedIds) {
          const [debtRaw, panicRaw, liquidatedRaw] = await contracts.loan.positions(BigInt(tokenId));
          const isPanic = Boolean(panicRaw) || (await contracts.loan.isPanicMode(BigInt(tokenId)));
          const debt = Number(formatEther(debtRaw));
          const isLiquidated = Boolean(liquidatedRaw);

          // Eligible: locked, not active loan, not in panic, not liquidated.
          if (debt > 0 || isPanic || isLiquidated) {
            continue;
          }

          const [valuations, dynamicLtvRaw, nftTypeRaw] = await Promise.all([
            contracts.oracle.getValuations(BigInt(tokenId)),
            contracts.oracle.getDynamicLTV(BigInt(tokenId)),
            contracts.vault.rightTypeOf(BigInt(tokenId)),
          ]);

          const valuationEth = Number(formatEther((valuations as { liquidationValue: bigint }).liquidationValue));
          const dynamicLtvBps = Number(dynamicLtvRaw);
          const maxBorrowEth = (valuationEth * dynamicLtvBps) / 10_000;

          if (maxBorrowEth <= 0) {
            continue;
          }

          nextRows.push({
            tokenId,
            nftType: Number(nftTypeRaw),
            valuationEth,
            dynamicLtvBps,
            maxBorrowEth,
          });
        }

        if (mounted) {
          setRows(nextRows);
          const first = nextRows[0]?.tokenId ?? null;
          setSelectedTokenId(first);
          setLoanAmountEth(first ? String(Math.min(nextRows[0].maxBorrowEth * 0.5, nextRows[0].maxBorrowEth).toFixed(4)) : "0");
        }
      } catch (err) {
        if (mounted) {
          setError((err as Error).message || "Failed to load borrow candidates");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadEligible();
    return () => {
      mounted = false;
    };
  }, [address]);

  const selectedRow = useMemo(
    () => rows.find((row) => row.tokenId === selectedTokenId) ?? null,
    [rows, selectedTokenId]
  );

  const amountNum = useMemo(() => Number(loanAmountEth) || 0, [loanAmountEth]);
  const amountWithinMax = selectedRow ? amountNum > 0 && amountNum <= selectedRow.maxBorrowEth : false;
  const currentLtvPct = selectedRow && selectedRow.valuationEth > 0 ? (amountNum / selectedRow.valuationEth) * 100 : 0;
  const maxLtvPct = selectedRow ? selectedRow.dynamicLtvBps / 100 : 0;

  async function submitLoan() {
    if (!selectedRow || !address || !amountWithinMax) {
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await writeContractAsync({
        abi: borrowRequestAbi,
        address: ADDRESSES.loan as Address,
        functionName: "requestLoan",
        args: [BigInt(selectedRow.tokenId), parseEther(loanAmountEth), 30n],
      } as never);

      router.push("/loans");
    } catch (err) {
      setError((err as Error).message || "Loan request failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isConnected || !address) {
    return (
      <section className="mx-auto max-w-6xl p-6">
        <h1 className="text-3xl font-semibold">Borrow</h1>
        <p className="mt-2 text-sm opacity-80">Connect your wallet to request a loan.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold">Borrow</h1>
        <p className="mt-2 text-sm opacity-80">Only locked NFTs without active loans and outside panic mode are eligible.</p>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-rose-300">{error}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Eligible Collateral</CardTitle>
          <CardDescription>Select a token to configure your loan amount.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm opacity-80">No eligible locked NFTs found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token ID</TableHead>
                  <TableHead>Valuation</TableHead>
                  <TableHead>Dynamic Max LTV</TableHead>
                  <TableHead>Current Max Borrow</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.tokenId}
                    className={selectedTokenId === row.tokenId ? "bg-cyan-500/10" : ""}
                    onClick={() => {
                      setSelectedTokenId(row.tokenId);
                      setLoanAmountEth(row.maxBorrowEth.toFixed(4));
                    }}
                  >
                    <TableCell>#{row.tokenId}</TableCell>
                    <TableCell>{row.valuationEth.toFixed(4)} ETH</TableCell>
                    <TableCell>{(row.dynamicLtvBps / 100).toFixed(2)}%</TableCell>
                    <TableCell>{row.maxBorrowEth.toFixed(4)} ETH</TableCell>
                    <TableCell>
                      <Badge variant="success">Eligible</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedRow ? (
        <Card>
          <CardHeader>
            <CardTitle>Loan Terms</CardTitle>
            <CardDescription>
              Fixed terms for MVP: 5% APR, 30 days.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded border p-3 text-sm">Interest Rate: <strong>5% APR</strong></div>
              <div className="rounded border p-3 text-sm">Duration: <strong>30 days</strong></div>
              <div className="rounded border p-3 text-sm">Token: <strong>#{selectedRow.tokenId}</strong></div>
            </div>

            <div>
              <label className="mb-2 block text-sm">Loan Amount (ETH)</label>
              <input
                className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                value={loanAmountEth}
                onChange={(e) => setLoanAmountEth(e.target.value)}
              />
              <div className="mt-2 text-xs opacity-80">Max allowed: {selectedRow.maxBorrowEth.toFixed(4)} ETH</div>
            </div>

            <div>
              <label className="mb-2 block text-sm">Adjust Amount</label>
              <input
                type="range"
                min={0}
                max={Math.max(selectedRow.maxBorrowEth, 0.0001)}
                step={0.0001}
                value={Math.min(Math.max(amountNum, 0), selectedRow.maxBorrowEth)}
                onChange={(e) => setLoanAmountEth(Number(e.target.value).toFixed(4))}
                className="w-full"
              />
            </div>

            <div>
              <div className="mb-2 flex justify-between text-xs opacity-80">
                <span>Projected LTV: {currentLtvPct.toFixed(2)}%</span>
                <span>Max: {maxLtvPct.toFixed(2)}%</span>
              </div>
              <div className="h-2 rounded bg-slate-800">
                <div
                  className={`h-2 rounded ${currentLtvPct > maxLtvPct ? "bg-rose-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min(currentLtvPct, 100)}%` }}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={submitLoan} disabled={!amountWithinMax || submitting}>
                {submitting ? "Submitting..." : "Request Loan"}
              </Button>
              {!amountWithinMax ? <span className="text-xs text-rose-300">Amount must be greater than 0 and ≤ max borrow.</span> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
