"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { getBackendBaseUrl } from "../../../lib/contracts";

type NftRow = {
  tokenId: string;
  oracleValuationEth: number;
  isLocked: boolean;
  ltvPct: number | null;
  panicActive: boolean;
};

type DashboardState = {
  rows: NftRow[];
  totalCollateral: number;
  totalDebt: number;
  availableBorrowingPower: number;
};

const EMPTY_STATE: DashboardState = {
  rows: [],
  totalCollateral: 0,
  totalDebt: 0,
  availableBorrowingPower: 0,
};

const CLIENT_TEST_WALLET_FALLBACK = "0xc82A59594560A3010F336ebe2e9CC4794DCD46cf";

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toEthFromWeiString(value: unknown): number {
  try {
    if (value === null || value === undefined) return 0;
    return Number(formatEther(BigInt(String(value))));
  } catch {
    return 0;
  }
}

function MetricCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function UserDashboardPage() {
  const router = useRouter();
  const { isConnected, address } = useAccount();

  const [state, setState] = useState<DashboardState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const backendBase = useMemo(() => getBackendBaseUrl(), []);

  const demoWallet = useMemo(
    () => String(process.env.NEXT_PUBLIC_TEST_WALLET_ADDRESS || CLIENT_TEST_WALLET_FALLBACK),
    []
  );

  const effectiveWallet = useMemo(() => {
    const connected = String(address || "");
    if (!connected) return demoWallet;
    return connected.toLowerCase() === demoWallet.toLowerCase() ? connected : demoWallet;
  }, [address, demoWallet]);

  const fetchDashboard = useCallback(async () => {
    if (!effectiveWallet) return;

    setError("");

    try {
      const [nftsRes, loansRes] = await Promise.all([
        fetch(`${backendBase}/api/nfts/owned?wallet=${encodeURIComponent(effectiveWallet)}`, { cache: "no-store" }),
        fetch(`${backendBase}/api/loans/active?wallet=${encodeURIComponent(effectiveWallet)}`, { cache: "no-store" }),
      ]);

      if (!nftsRes.ok || !loansRes.ok) {
        throw new Error("Failed to load dashboard data from backend.");
      }

      const nftsJson = await nftsRes.json();
      const loansJson = await loansRes.json();

      const nftItems = Array.isArray(nftsJson?.items) ? nftsJson.items : [];
      const activeLoans = Array.isArray(loansJson?.items) ? loansJson.items : [];

      const loanByTokenId = new Map<string, any>(
        activeLoans.map((loan: any) => [String(loan?.tokenId || ""), loan])
      );

      const rows: NftRow[] = nftItems.map((nft: any) => {
        const tokenId = String(nft?.tokenId || "0");
        const loan = loanByTokenId.get(tokenId);

        const ltvPct = nft?.isLocked && loan
          ? toNumber(loan?.onchainLtvBps, 0) / 100
          : null;

        const panicActive = Boolean(
          nft?.isLocked && loan && (loan?.onchainPanicMode || String(loan?.status || "").toUpperCase() === "PANIC")
        );

        return {
          tokenId,
          oracleValuationEth: toNumber(nft?.valuation, 0),
          isLocked: Boolean(nft?.isLocked),
          ltvPct,
          panicActive,
        };
      });

      const totalCollateral = rows
        .filter((row) => row.isLocked)
        .reduce((sum, row) => sum + row.oracleValuationEth, 0);

      const totalDebt = activeLoans.reduce((sum: number, loan: any) => {
        const onchainDebtEth = toEthFromWeiString(loan?.onchainDebt);
        if (onchainDebtEth > 0) return sum + onchainDebtEth;
        return sum + toNumber(loan?.debtTokenAmount, 0);
      }, 0);

      const availableBorrowingPower = totalCollateral * 0.7 - totalDebt;

      setState({
        rows,
        totalCollateral,
        totalDebt,
        availableBorrowingPower,
      });
    } catch (err) {
      setError((err as Error).message || "Failed to load dashboard.");
    }
  }, [backendBase, effectiveWallet]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDashboard();
    setRefreshing(false);
  }, [fetchDashboard]);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      setLoading(true);
      await fetchDashboard();
      if (mounted) setLoading(false);
    }

    boot();
    return () => {
      mounted = false;
    };
  }, [fetchDashboard]);

  if (!isConnected || !address) {
    return (
      <section className="mx-auto max-w-6xl p-6">
        <h1 className="text-3xl font-semibold">Dashboard</h1>
        <p className="mt-2 text-sm opacity-80">Connect your wallet to view dashboard data.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">User Dashboard</h1>
          <p className="mt-1 text-sm opacity-80">Connected Wallet: {address}</p>
          <p className="text-sm opacity-80">Data Wallet: {effectiveWallet}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={refresh} variant="outline" disabled={refreshing || loading}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
          <Button onClick={() => router.push("/vault-deposit")}>Vault Deposit</Button>
          <Button variant="secondary" onClick={() => router.push("/borrow")}>Borrow</Button>
          <Button variant="outline" onClick={() => router.push("/repay")}>Repay</Button>
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-sm text-rose-300">{error}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {loading ? (
          <>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </>
        ) : (
          <>
            <MetricCard
              title="Total Collateral Value"
              value={`${state.totalCollateral.toFixed(4)} ETH`}
              hint="Sum of valuations of locked NFTs"
            />
            <MetricCard
              title="Total Debt"
              value={`${state.totalDebt.toFixed(4)} ETH`}
              hint="From active loans"
            />
            <MetricCard
              title="Available Borrowing Power"
              value={`${state.availableBorrowingPower.toFixed(4)} ETH`}
              hint="totalCollateral * 0.7 - totalDebt"
            />
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>NFT Risk Overview</CardTitle>
          <CardDescription>Token ID, oracle valuation, LTV (if locked + active loan), and panic status.</CardDescription>
        </CardHeader>
        <CardContent>
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
                  <TableHead>Oracle Valuation</TableHead>
                  <TableHead>LTV</TableHead>
                  <TableHead>Panic Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.rows.map((row) => (
                  <TableRow key={row.tokenId}>
                    <TableCell>#{row.tokenId}</TableCell>
                    <TableCell>{row.oracleValuationEth.toFixed(4)} ETH</TableCell>
                    <TableCell>
                      {row.ltvPct === null ? (
                        <span className="opacity-70">N/A</span>
                      ) : (
                        `${row.ltvPct.toFixed(2)}%`
                      )}
                    </TableCell>
                    <TableCell>
                      {row.ltvPct === null ? (
                        <Badge variant="secondary">NO LOAN</Badge>
                      ) : row.panicActive ? (
                        <Badge variant="danger">PANIC</Badge>
                      ) : (
                        <Badge variant="success">OK</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
