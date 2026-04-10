"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { type Address, parseEther } from "viem";
import { ADDRESSES } from "../../../../lib/contracts";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Skeleton } from "../../../../components/ui/skeleton";

type LoanDetails = {
  tokenId: number;
  principal: number;
  debtRemaining: number;
  interestAccrued: number;
  healthFactor: number;
  collateralValue?: number;
  currency?: "ETH" | "USDC";
};

const repayLoanAbi = [
  "function repayLoan(uint256 tokenId, uint256 amount) external",
] as const;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

export default function RepayTokenPage() {
  const router = useRouter();
  const params = useParams();
  const tokenIdParam = Array.isArray(params?.tokenId) ? params?.tokenId[0] : params?.tokenId;
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const numericTokenId = Number(tokenIdParam || 0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<LoanDetails | null>(null);
  const [amount, setAmount] = useState("0");
  const [currency, setCurrency] = useState<"ETH" | "USDC">("ETH");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");

  async function loadDetails() {
    if (!address || !Number.isFinite(numericTokenId) || numericTokenId <= 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/loans/active?wallet=${encodeURIComponent(address)}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Failed to load loan details");
      }

      const json = await res.json();
      const all = json?.loans ?? json ?? [];
      const row = all.find((item: any) => Number(item?.tokenId) === numericTokenId);

      if (!row) {
        throw new Error("Loan not found for this token");
      }

      const next: LoanDetails = {
        tokenId: numericTokenId,
        principal: toNumber(row?.borrowedAmount ?? row?.principal ?? 0),
        debtRemaining: toNumber(row?.debtRemaining ?? row?.debt ?? 0),
        interestAccrued: toNumber(row?.interestAccrued ?? 0),
        healthFactor: toNumber(row?.healthFactor ?? 0),
        collateralValue: toNumber(row?.collateralValue ?? 0),
        currency: (row?.currency === "USDC" ? "USDC" : "ETH") as "ETH" | "USDC",
      };

      setDetails(next);
      setCurrency(next.currency || "ETH");
      setAmount(Math.min(next.debtRemaining, next.debtRemaining * 0.25).toFixed(4));
    } catch (err) {
      setError((err as Error).message || "Failed to load repay details");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, numericTokenId]);

  const amountNum = useMemo(() => Number(amount) || 0, [amount]);

  const projected = useMemo(() => {
    if (!details) {
      return { debtAfter: 0, healthAfter: 0 };
    }

    const debtAfter = Math.max(0, details.debtRemaining - amountNum);

    // If collateral value is available, estimate health factor as collateral / debt.
    let healthAfter = details.healthFactor;
    if (details.collateralValue && details.collateralValue > 0) {
      healthAfter = debtAfter > 0 ? details.collateralValue / debtAfter : 999;
    } else if (details.debtRemaining > 0) {
      const ratio = debtAfter / details.debtRemaining;
      healthAfter = ratio > 0 ? details.healthFactor / ratio : 999;
    }

    return { debtAfter, healthAfter };
  }, [details, amountNum]);

  const validAmount = details ? amountNum > 0 && amountNum <= details.debtRemaining : false;

  async function repay() {
    if (!details || !validAmount) {
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await writeContractAsync({
        abi: repayLoanAbi,
        address: ADDRESSES.loan as Address,
        functionName: "repayLoan",
        args: [BigInt(details.tokenId), parseEther(amount)],
      } as never);

      setSuccess(`Repayment submitted for token #${details.tokenId}.`);
      await loadDetails();
    } catch (err) {
      setError((err as Error).message || "Repayment failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isConnected || !address) {
    return (
      <section className="mx-auto max-w-3xl p-6">
        <h1 className="text-3xl font-semibold">Repay Loan</h1>
        <p className="mt-2 text-sm opacity-80">Connect your wallet to continue.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Repay Loan #{numericTokenId}</h1>
        <Button variant="outline" onClick={() => router.push("/loans")}>Back to Loans</Button>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-rose-300">{error}</CardContent>
        </Card>
      ) : null}

      {success ? (
        <Card>
          <CardContent className="pt-6 text-sm text-emerald-300">{success}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Loan Details</CardTitle>
          <CardDescription>Current debt and projected post-repay metrics.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading || !details ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded border p-3 text-sm">Borrowed Amount: <strong>{details.principal.toFixed(4)}</strong></div>
                <div className="rounded border p-3 text-sm">Debt Remaining: <strong>{details.debtRemaining.toFixed(4)}</strong></div>
                <div className="rounded border p-3 text-sm">Interest Accrued: <strong>{details.interestAccrued.toFixed(4)}</strong></div>
                <div className="rounded border p-3 text-sm">
                  Health Factor: <Badge variant={details.healthFactor >= 1.5 ? "success" : details.healthFactor >= 1.1 ? "warning" : "danger"}>{details.healthFactor.toFixed(2)}</Badge>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm">Repay Amount</label>
                <input
                  className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <div className="mt-2 text-xs opacity-80">Maximum repayable now: {details.debtRemaining.toFixed(4)}</div>
              </div>

              <div>
                <label className="mb-2 block text-sm">Currency</label>
                <div className="flex gap-2">
                  <Button variant={currency === "ETH" ? "default" : "outline"} onClick={() => setCurrency("ETH")}>ETH</Button>
                  <Button variant={currency === "USDC" ? "default" : "outline"} onClick={() => setCurrency("USDC")}>USDC (wrapped debt token)</Button>
                </div>
              </div>

              <div className="rounded border p-3 text-sm">
                <div>Projected Debt After Repay: <strong>{projected.debtAfter.toFixed(4)}</strong></div>
                <div>
                  Projected Health Factor: <strong>{projected.healthAfter.toFixed(2)}</strong>
                </div>
              </div>

              <Button onClick={repay} disabled={!validAmount || submitting}>
                {submitting ? "Submitting..." : "Repay Loan"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
