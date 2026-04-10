"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";

type ActiveLoan = {
  tokenId: number;
  borrowedAmount: number;
  debtRemaining: number;
  interestAccrued: number;
  healthFactor: number;
  nextPaymentDate: string;
  liquidated?: boolean;
};

function healthVariant(healthFactor: number): "success" | "warning" | "danger" {
  if (healthFactor >= 1.5) return "success";
  if (healthFactor >= 1.1) return "warning";
  return "danger";
}

export default function LoansPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loans, setLoans] = useState<ActiveLoan[]>([]);

  useEffect(() => {
    let mounted = true;

    async function loadActiveLoans() {
      if (!address) {
        setLoans([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const res = await fetch(`/api/loans/active?wallet=${encodeURIComponent(address)}`, { cache: "no-store" });
        if (!res.ok) {
          throw new Error("Failed to load active loans");
        }

        const json = await res.json();
        const rows = (json?.loans ?? json ?? []).map((row: any) => ({
          tokenId: Number(row?.tokenId ?? 0),
          borrowedAmount: Number(row?.borrowedAmount ?? row?.principal ?? 0),
          debtRemaining: Number(row?.debtRemaining ?? row?.debt ?? 0),
          interestAccrued: Number(row?.interestAccrued ?? 0),
          healthFactor: Number(row?.healthFactor ?? 0),
          nextPaymentDate: String(row?.nextPaymentDate ?? "-"),
          liquidated: Boolean(row?.liquidated),
        })) as ActiveLoan[];

        if (mounted) {
          setLoans(rows);
        }
      } catch (err) {
        if (mounted) {
          setError((err as Error).message || "Failed to load loans");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadActiveLoans();
    return () => {
      mounted = false;
    };
  }, [address]);

  const hasLoans = useMemo(() => loans.length > 0, [loans]);

  if (!isConnected || !address) {
    return (
      <section className="mx-auto max-w-6xl p-6">
        <h1 className="text-3xl font-semibold">Active Loans</h1>
        <p className="mt-2 text-sm opacity-80">Connect your wallet to view active loans.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold">Active Loans</h1>
        <p className="mt-2 text-sm opacity-80">Current loan status and repayment actions.</p>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-rose-300">{error}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Loan Positions</CardTitle>
          <CardDescription>Fetched from /api/loans/active</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : hasLoans ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token ID</TableHead>
                  <TableHead>Borrowed Amount</TableHead>
                  <TableHead>Debt Remaining</TableHead>
                  <TableHead>Interest Accrued</TableHead>
                  <TableHead>Health Factor</TableHead>
                  <TableHead>Next Payment Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loans.map((loan) => (
                  <TableRow key={loan.tokenId}>
                    <TableCell>#{loan.tokenId}</TableCell>
                    <TableCell>{loan.borrowedAmount.toFixed(4)}</TableCell>
                    <TableCell>{loan.debtRemaining.toFixed(4)}</TableCell>
                    <TableCell>{loan.interestAccrued.toFixed(4)}</TableCell>
                    <TableCell>
                      <Badge variant={healthVariant(loan.healthFactor)}>{loan.healthFactor.toFixed(2)}</Badge>
                    </TableCell>
                    <TableCell>{loan.nextPaymentDate}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => router.push(`/repay/${loan.tokenId}`)}>Repay</Button>
                        {loan.liquidated ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => router.push(`/transactions?tokenId=${loan.tokenId}&type=liquidation`)}
                          >
                            Liquidation History
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm opacity-80">No active loans found.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
