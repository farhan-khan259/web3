"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useWriteContract, useAccount, useBalance, useReadContract } from "wagmi";
import { type Address, formatEther, parseEther } from "viem";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CheckCircle2, Coins, HeartPulse, PlusCircle, ShieldAlert, Wallet } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ADDRESSES, getBackendBaseUrl, loanAbi, licenseAbi, oracleAbi, routerAbi, shortAddress, vaultAbi } from "../../lib/contracts";

const DEFAULT_COLLECTION_NAME = "Banksy Gorilla in a Pink Mask";
const DEFAULT_COLLECTION_ADDRESS = "0x0c06d6a17eb208a9bc7bd698eb6f22379209e3a4";
const DEFAULT_WS_URL = `${getBackendBaseUrl().replace(/^http/, "ws")}/ws/health`;

const loanMetadataAbi = [
  "function requestLoan(uint256 tokenId, uint8 expectedType, uint256 amount) external",
  "function borrow(uint256 tokenId, uint8 expectedType, uint256 amount) external",
  "function repay(uint256 tokenId) external payable",
  "function getPanicStatus(uint256 tokenId) external view returns (bool isPanic, uint256 currentLTV, uint256 panicThreshold)",
  "function canBorrow(uint256 tokenId) external view returns (bool)",
] as const;

const collateralAbi = [
  "function getLockedRightsByWallet(address owner) external view returns (uint256[] memory)",
  "function rightTypeOf(uint256 rightsId) external view returns (uint8)",
  "function getSnapshotValue(uint256 rightsId) external view returns (uint256)",
  "function lockedBy(uint256 rightsId) external view returns (address)",
  "function isLocked(uint256 rightsId) external view returns (bool)",
] as const;

const oracleDetailAbi = [
  "function getFloorValue(uint256 rightsId) external view returns (uint256)",
  "function getValuations(uint256 rightsId) external view returns (uint256 liquidationValue, uint256 appraisalValue)",
  "function getDynamicLTV(uint256 rightsId) external view returns (uint256)",
  "function getEthUsdPriceE18() external view returns (uint256)",
  "function getRiskStatus(uint256 rightsId) external view returns (bool)",
] as const;

type RiskPayload = {
  tokenId?: number;
  status?: "normal" | "warning" | "panic";
  riskFlag?: boolean;
  dynamicLtvBps?: number;
  ltvBps?: number;
  updatedAt?: number;
};

type LtvPayload = {
  tokenId?: number;
  ltvBps?: number;
  dynamicLtvBps?: number;
  liquidationValueWei?: string;
  debtWei?: string;
  updatedAt?: number;
};

type TokenRow = {
  tokenId: number;
  collection: string;
  collectionAddress: string;
  image: string;
  floorEth: number;
  floorUsd: number;
  debtEth: number;
  borrowPowerEth: number;
  ltvPercent: number;
  panic: boolean;
  healthFactor: number;
  healthScore: number;
  status: "safe" | "warning" | "panic";
  nftType: number;
  lockedBy: string;
  liquidationValueEth: number;
  appraisalValueEth: number;
  backendLtv?: LtvPayload;
  backendRisk?: RiskPayload;
};

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  tone: "normal" | "warning" | "danger" | "success";
  time: string;
};

function tokenStatusColor(status: TokenRow["status"]) {
  if (status === "panic") return "danger";
  if (status === "warning") return "warning";
  return "success";
}

function pctToColorClass(status: TokenRow["status"]) {
  if (status === "panic") return "text-rose-300";
  if (status === "warning") return "text-amber-300";
  return "text-emerald-300";
}

function numberFromBigint(value: bigint | undefined): number {
  if (value === undefined) return 0;
  return Number(formatEther(value));
}

function safeHealthScore(row: Partial<TokenRow> & { ltvPercent?: number; panic?: boolean }) {
  const ltv = row.ltvPercent ?? 0;
  const panicPenalty = row.panic ? 35 : 0;
  return Math.max(0, Math.min(100, 100 - ltv - panicPenalty));
}

function fmtUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function addActivity(
  setActivity: React.Dispatch<React.SetStateAction<ActivityItem[]>>,
  title: string,
  detail: string,
  tone: ActivityItem["tone"] = "normal"
) {
  setActivity((prev) => [
    {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      detail,
      tone,
      time: new Date().toLocaleTimeString(),
    },
    ...prev,
  ].slice(0, 8));
}

function getToneBadgeVariant(tone: ActivityItem["tone"]) {
  if (tone === "danger") return "danger";
  if (tone === "warning") return "warning";
  if (tone === "success") return "success";
  return "secondary";
}

function CollectionLabel({ address }: { address: string }) {
  const isKnown = address.toLowerCase() === DEFAULT_COLLECTION_ADDRESS.toLowerCase();
  return <span>{isKnown ? DEFAULT_COLLECTION_NAME : shortAddress(address)}</span>;
}

function CollateralRow({
  tokenId,
  ethUsd,
  backendRisk,
  backendLtv,
  onResolved,
  selected,
  onSelect,
}: {
  tokenId: number;
  ethUsd: number;
  backendRisk?: RiskPayload;
  backendLtv?: LtvPayload;
  onResolved: (row: TokenRow) => void;
  selected: boolean;
  onSelect: (tokenId: number) => void;
}) {
  const { address } = useAccount();
  const owner = (address || "0x0000000000000000000000000000000000000000") as Address;
  const enabled = Boolean(address && ADDRESSES.vault && ADDRESSES.oracle && ADDRESSES.loan);

  const { data: nftTypeData } = useReadContract({
    abi: vaultAbi,
    address: ADDRESSES.vault as Address,
    functionName: "rightTypeOf",
    args: [BigInt(tokenId)],
    query: { enabled },
  });

  const { data: snapshotValue } = useReadContract({
    abi: vaultAbi,
    address: ADDRESSES.vault as Address,
    functionName: "getSnapshotValue",
    args: [BigInt(tokenId)],
    query: { enabled },
  });

  const { data: lockedBy } = useReadContract({
    abi: vaultAbi,
    address: ADDRESSES.vault as Address,
    functionName: "lockedBy",
    args: [BigInt(tokenId)],
    query: { enabled },
  });

  const { data: debt } = useReadContract({
    abi: loanMetadataAbi,
    address: ADDRESSES.loan as Address,
    functionName: "getPanicStatus",
    args: [BigInt(tokenId)],
    query: { enabled },
  });

  const { data: floorValue } = useReadContract({
    abi: oracleDetailAbi,
    address: ADDRESSES.oracle as Address,
    functionName: "getFloorValue",
    args: [BigInt(tokenId)],
    query: { enabled },
  });

  const { data: valuations } = useReadContract({
    abi: oracleDetailAbi,
    address: ADDRESSES.oracle as Address,
    functionName: "getValuations",
    args: [BigInt(tokenId)],
    query: { enabled },
  });

  const { data: dynamicLtv } = useReadContract({
    abi: oracleDetailAbi,
    address: ADDRESSES.oracle as Address,
    functionName: "getDynamicLTV",
    args: [BigInt(tokenId)],
    query: { enabled },
  });

  useEffect(() => {
    if (!snapshotValue || !floorValue || !valuations || !debt) return;

    const [isPanic, currentLtvBps] = debt as unknown as [boolean, bigint, bigint];
    const liquidationValueEth = numberFromBigint((valuations as { liquidationValue: bigint; appraisalValue: bigint }).liquidationValue);
    const appraisalValueEth = numberFromBigint((valuations as { liquidationValue: bigint; appraisalValue: bigint }).appraisalValue);
    const debtEth = numberFromBigint(currentLtvBps);
    const floorEth = numberFromBigint(floorValue as bigint);
    const ltvPercent = liquidationValueEth > 0 ? (debtEth / liquidationValueEth) * 100 : 0;
    const borrowPowerEth = Math.max(0, liquidationValueEth * (Number(dynamicLtv ?? 0n) / 10000) - debtEth);
    const status: TokenRow["status"] = isPanic || ltvPercent >= 85 ? "panic" : ltvPercent >= 60 ? "warning" : "safe";
    const row: TokenRow = {
      tokenId,
      collection: DEFAULT_COLLECTION_NAME,
      collectionAddress: process.env.NEXT_PUBLIC_COLLECTION_ADDRESS || DEFAULT_COLLECTION_ADDRESS,
      image: `https://placehold.co/96x96/08111f/67e8f9.png?text=#${tokenId}`,
      floorEth,
      floorUsd: floorEth * ethUsd,
      debtEth,
      borrowPowerEth,
      ltvPercent,
      panic: isPanic || (backendRisk?.status === "panic"),
      healthFactor: debtEth === 0 ? 99.99 : liquidationValueEth / debtEth,
      healthScore: safeHealthScore({ ltvPercent, panic: isPanic || (backendRisk?.status === "panic") }),
      status,
      nftType: Number(nftTypeData ?? 0n),
      lockedBy: String(lockedBy ?? owner),
      liquidationValueEth,
      appraisalValueEth,
      backendLtv,
      backendRisk,
    };

    onResolved(row);
  }, [snapshotValue, floorValue, valuations, debt, dynamicLtv, nftTypeData, lockedBy, ethUsd, backendRisk, backendLtv, tokenId, owner, onResolved]);

  const [isPanic, currentLtvBps, currentDebt] = (debt ?? [false, 0n, 0n]) as unknown as [boolean, bigint, bigint];
  const liquidationValueEth = numberFromBigint(((valuations as { liquidationValue: bigint; appraisalValue: bigint } | undefined)?.liquidationValue) as bigint | undefined);
  const appraisalValueEth = numberFromBigint(((valuations as { liquidationValue: bigint; appraisalValue: bigint } | undefined)?.appraisalValue) as bigint | undefined);
  const ltvPercent = liquidationValueEth > 0 ? (numberFromBigint(currentDebt) / liquidationValueEth) * 100 : 0;
  const status: TokenRow["status"] = isPanic || ltvPercent >= 85 || backendRisk?.status === "panic" ? "panic" : ltvPercent >= 60 || backendRisk?.status === "warning" ? "warning" : "safe";

  return (
    <TableRow className={selected ? "bg-cyan-500/5" : ""}>
      <TableCell className="min-w-[9rem]">
        <div className="flex items-center gap-3">
          <img
            src={`https://placehold.co/96x96/08111f/67e8f9.png?text=#${tokenId}`}
            alt={`NFT ${tokenId}`}
            className="h-12 w-12 rounded-xl border border-slate-800 object-cover"
          />
          <div>
            <div className="font-semibold">{DEFAULT_COLLECTION_NAME}</div>
            <div className="text-xs text-slate-400">{shortAddress(process.env.NEXT_PUBLIC_COLLECTION_ADDRESS || DEFAULT_COLLECTION_ADDRESS)}</div>
          </div>
        </div>
      </TableCell>
      <TableCell>{DEFAULT_COLLECTION_NAME}</TableCell>
      <TableCell>#{tokenId}</TableCell>
      <TableCell>{liquidationValueEth.toFixed(4)} ETH / {fmtUsd(liquidationValueEth * ethUsd)}</TableCell>
      <TableCell>{ltvPercent.toFixed(2)}%</TableCell>
      <TableCell>
        <Badge variant={getToneBadgeVariant(status === "safe" ? "success" : status === "warning" ? "warning" : "danger")}>{status.toUpperCase()}</Badge>
      </TableCell>
      <TableCell>{(debt && (debt as unknown as [boolean, bigint, bigint])[1] ? 0 : (liquidationValueEth > 0 && numberFromBigint(currentDebt) > 0 ? liquidationValueEth / numberFromBigint(currentDebt) : 99.99)).toFixed(2)}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onSelect(tokenId)}>View Details</Button>
          <Button size="sm" variant="secondary" onClick={() => onSelect(tokenId)}>Repay</Button>
          <Button size="sm" onClick={() => onSelect(tokenId)}>Deposit More</Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function LoanRow({ token }: { token: TokenRow }) {
  const interest = token.debtEth * 0.08;
  const nextPaymentDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString();
  const status = token.status === "panic" ? "Critical" : token.status === "warning" ? "Attention" : "Current";

  return (
    <TableRow>
      <TableCell>
        <div className="font-semibold">{token.collection} #{token.tokenId}</div>
        <div className="text-xs text-slate-400">{shortAddress(token.collectionAddress)}</div>
      </TableCell>
      <TableCell>{token.debtEth.toFixed(4)} ETH</TableCell>
      <TableCell>{interest.toFixed(4)} ETH</TableCell>
      <TableCell>{nextPaymentDue}</TableCell>
      <TableCell>
        <Badge variant={token.status === "panic" ? "danger" : token.status === "warning" ? "warning" : "success"}>{status}</Badge>
      </TableCell>
    </TableRow>
  );
}

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const { data: nativeBalance } = useBalance({
    address: address as Address | undefined,
    query: { enabled: Boolean(address) },
  });
  const { writeContractAsync, isPending: isWritePending } = useWriteContract();
  const [selectedTokenId, setSelectedTokenId] = useState<string>("1");
  const [loanAmountEth, setLoanAmountEth] = useState("1");
  const [repayAmountEth, setRepayAmountEth] = useState("0.1");
  const [depositMoreEth, setDepositMoreEth] = useState("0.05");
  const [licenseDays, setLicenseDays] = useState("365");
  const [licenseType, setLicenseType] = useState("1");
  const [territory, setTerritory] = useState("1");
  const [tokenRows, setTokenRows] = useState<Record<number, TokenRow>>({});
  const [backendRiskByToken, setBackendRiskByToken] = useState<Record<number, RiskPayload>>({});
  const [backendLtvByToken, setBackendLtvByToken] = useState<Record<number, LtvPayload>>({});
  const [activity, setActivity] = useState<ActivityItem[]>([
    {
      id: "seed",
      title: "Dashboard ready",
      detail: "Connect your wallet to inspect collateral health and liquidity.",
      tone: "normal",
      time: "--:--:--",
    },
  ]);
  const [wsState, setWsState] = useState<"connecting" | "connected" | "closed" | "error">("connecting");
  const [selectedTab, setSelectedTab] = useState("overview");

  const vaultTokenIds = useReadContract({
    abi: collateralAbi,
    address: ADDRESSES.vault as Address,
    functionName: "getLockedRightsByWallet",
    args: address ? [address as Address] : undefined,
    query: {
      enabled: Boolean(address && ADDRESSES.vault),
      refetchInterval: 30_000,
    },
  }).data as bigint[] | undefined;

  const ethUsdWei = useReadContract({
    abi: oracleDetailAbi,
    address: ADDRESSES.oracle as Address,
    functionName: "getEthUsdPriceE18",
    args: undefined,
    query: {
      enabled: Boolean(ADDRESSES.oracle),
      refetchInterval: 30_000,
    },
  }).data as bigint | undefined;

  const ethUsd = Number(formatEther(ethUsdWei ?? 0n));
  const ownedTokens = useMemo(() => (vaultTokenIds ?? []).map((token) => Number(token)), [vaultTokenIds]);
  const ownedTokensKey = useMemo(() => ownedTokens.join(","), [ownedTokens]);

  useEffect(() => {
    setActivity((prev) =>
      prev.map((item) =>
        item.id === "seed"
          ? {
              ...item,
              time: new Date().toLocaleTimeString(),
            }
          : item
      )
    );
  }, []);

  useEffect(() => {
    if (!ownedTokens.length) return;

    const abortController = new AbortController();
    const baseUrl = getBackendBaseUrl();

    (async () => {
      try {
        const results = await Promise.allSettled(
          ownedTokens.map(async (tokenId) => {
            const [riskResponse, ltvResponse] = await Promise.all([
              fetch(`${baseUrl}/risk/${tokenId}`, { signal: abortController.signal }),
              fetch(`${baseUrl}/ltv/${tokenId}`, { signal: abortController.signal }),
            ]);

            const nextRisk: RiskPayload | undefined = riskResponse.ok ? await riskResponse.json() : undefined;
            const nextLtv: LtvPayload | undefined = ltvResponse.ok ? await ltvResponse.json() : undefined;

            if (nextRisk) {
              setBackendRiskByToken((prev) => ({ ...prev, [tokenId]: nextRisk }));
            }
            if (nextLtv) {
              setBackendLtvByToken((prev) => ({ ...prev, [tokenId]: nextLtv }));
            }

            addActivity(
              setActivity,
              `Backend refresh for NFT #${tokenId}`,
              `Risk=${nextRisk?.status || "unknown"}, LTV=${nextLtv?.ltvBps ? (nextLtv.ltvBps / 100).toFixed(2) : "n/a"}%`,
              nextRisk?.status === "panic" ? "danger" : nextRisk?.status === "warning" ? "warning" : "normal"
            );
          })
        );

        if (results.some((result) => result.status === "rejected")) {
          addActivity(setActivity, "Backend refresh partial failure", "Some NFT risk/LTV requests failed", "warning");
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          addActivity(setActivity, "Backend unavailable", String((error as Error).message || error), "warning");
        }
      }
    })();

    return () => abortController.abort();
  }, [ownedTokensKey]);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_HEALTH_WS_URL || DEFAULT_WS_URL;
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(wsUrl);
      setWsState("connecting");
      socket.onopen = () => setWsState("connected");
      socket.onclose = () => setWsState("closed");
      socket.onerror = () => setWsState("error");
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data));
          const tokenId = Number(payload.tokenId ?? payload.rightsId ?? selectedTokenId);
          const healthFactor = payload.healthFactor ?? payload.currentLTV ?? payload.ltvBps;
          addActivity(
            setActivity,
            `Health update for NFT #${tokenId}`,
            `Health factor changed to ${String(healthFactor)}`,
            Number(payload.currentLTV ?? payload.ltvBps ?? 0) >= 8500 ? "danger" : "success"
          );
        } catch {
          addActivity(setActivity, "WebSocket message", String(event.data), "normal");
        }
      };
    } catch {
      setWsState("error");
    }

    return () => socket?.close();
  }, [selectedTokenId]);

  const rows = useMemo(() => Object.values(tokenRows).sort((a, b) => a.tokenId - b.tokenId), [tokenRows]);
  const activeLoans = useMemo(() => rows.filter((row) => row.debtEth > 0), [rows]);

  const portfolioTotals = useMemo(() => {
    const totalCollateralEth = rows.reduce((sum, row) => sum + row.floorEth, 0);
    const totalDebt = rows.reduce((sum, row) => sum + row.debtEth, 0);
    const borrowPower = rows.reduce((sum, row) => sum + row.borrowPowerEth, 0);
    const averageHealth = rows.length ? rows.reduce((sum, row) => sum + row.healthScore, 0) / rows.length : 0;
    return {
      totalCollateralEth,
      totalCollateralUsd: totalCollateralEth * ethUsd,
      totalDebt,
      borrowPower,
      averageHealth,
    };
  }, [rows, ethUsd]);

  const selectedRow = rows.find((row) => String(row.tokenId) === selectedTokenId) ?? rows[0];

  async function writeAndLog(
    label: string,
    params: any,
    successMessage: string,
    tone: ActivityItem["tone"] = "success"
  ) {
    try {
      await writeContractAsync(params as never);
      addActivity(setActivity, label, successMessage, tone);
    } catch (error) {
      addActivity(setActivity, `${label} failed`, String((error as Error).message || error), "danger");
      throw error;
    }
  }

  const handleRepay = async () => {
    if (!selectedRow || !address) return;
    await writeAndLog(
      `Repay NFT #${selectedRow.tokenId}`,
      {
        abi: loanAbi,
        address: ADDRESSES.loan as Address,
        functionName: "repay",
        args: [BigInt(selectedRow.tokenId)],
        value: parseEther(repayAmountEth || "0") as any,
      },
      `Repayment submitted for NFT #${selectedRow.tokenId}`
    );
  };

  const handleRequestLoan = async () => {
    if (!selectedRow || !address) return;
    await writeAndLog(
      `Request loan for NFT #${selectedRow.tokenId}`,
      {
        abi: loanMetadataAbi,
        address: ADDRESSES.loan as Address,
        functionName: "requestLoan",
        args: [BigInt(selectedRow.tokenId), BigInt(selectedRow.nftType), parseEther(loanAmountEth || "0")],
      },
      `Loan request submitted for NFT #${selectedRow.tokenId}`
    );
  };

  const handleDepositNFT = async () => {
    if (!selectedRow || !address) return;
    await writeAndLog(
      `Deposit NFT #${selectedRow.tokenId}`,
      {
        abi: vaultAbi,
        address: ADDRESSES.vault as Address,
        functionName: "lockMintRight",
        args: [BigInt(selectedRow.tokenId), BigInt(selectedRow.nftType), address as Address],
      },
      `Deposit request submitted for NFT #${selectedRow.tokenId}`
    );
  };

  const handleDepositMore = async (tokenId: number) => {
    await writeAndLog(
      `Deposit more for NFT #${tokenId}`,
      {
        abi: routerAbi,
        address: ADDRESSES.router as Address,
        functionName: "depositRevenue",
        args: [BigInt(tokenId)],
        value: parseEther(depositMoreEth || "0") as any,
      },
      `Additional value routed to NFT #${tokenId}`
    );
  };

  const handleBuyLicense = async () => {
    if (!selectedRow || !address) return;
    const licenseAddress = ADDRESSES.licenseToken as Address;
    if (!licenseAddress) {
      addActivity(setActivity, "Buy license blocked", "LicenseToken address not configured", "warning");
      return;
    }

    await writeAndLog(
      `Buy license for NFT #${selectedRow.tokenId}`,
      {
        abi: licenseAbi,
        address: licenseAddress,
        functionName: "mintLicense",
        args: [
          address as Address,
          BigInt(Number(process.env.NEXT_PUBLIC_COLLECTION_ADDRESS ? 1 : 0) || 1),
          BigInt(selectedRow.tokenId),
          BigInt(Number(licenseDays || 365)),
          BigInt(Number(licenseType || 1)),
          BigInt(Number(territory || 1)),
          "UKIPO-REF-0001",
        ],
      },
      `License purchase submitted for NFT #${selectedRow.tokenId}`
    );
  };

  const tokenCount = rows.length;
  const ready = isConnected && Boolean(address);

  return (
    <main className="space-y-6 text-slate-100">
      <section className="rounded-[1.5rem] border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-950 to-cyan-950/30 p-6 shadow-[0_30px_120px_rgba(0,0,0,0.35)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100">
              <HeartPulse className="h-3.5 w-3.5" /> Live NFT collateral dashboard
            </div>
            <h1 className="text-4xl font-semibold tracking-tight">User Dashboard</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              Monitor wallet connectivity, portfolio health, outstanding debt, and active licenses in one place.
              The dashboard listens to backend risk/LTV APIs and WebSocket health updates while remaining fully on-chain aware.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
            <ConnectButton showBalance chainStatus="icon" accountStatus="avatar" />
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-4 w-4 text-cyan-300" /> Wallet</CardTitle>
            <CardDescription>Connection and balance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Status</span>
                <Badge variant={ready ? "success" : "danger"}>{ready ? "Connected" : "Disconnected"}</Badge>
              </div>
              <div className="break-all font-mono text-slate-200">{address || "No wallet connected"}</div>
              <div className="text-slate-300">{nativeBalance ? `${nativeBalance.formatted} ${nativeBalance.symbol}` : "0.0000 ETH"}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Coins className="h-4 w-4 text-emerald-300" /> Total Collateral Value</CardTitle>
            <CardDescription>ETH / USD</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{portfolioTotals.totalCollateralEth.toFixed(4)} ETH</div>
            <div className="text-sm text-slate-400">{fmtUsd(portfolioTotals.totalCollateralUsd)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ArrowUpRight className="h-4 w-4 text-amber-300" /> Total Debt Outstanding</CardTitle>
            <CardDescription>Borrowed balance across NFTs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{portfolioTotals.totalDebt.toFixed(4)} ETH</div>
            <div className="text-sm text-slate-400">Across {activeLoans.length} active loans</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-4 w-4 text-cyan-300" /> Health Score</CardTitle>
            <CardDescription>Average across NFTs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{portfolioTotals.averageHealth.toFixed(1)} / 100</div>
            <div className="text-sm text-slate-400">Borrow power: {portfolioTotals.borrowPower.toFixed(4)} ETH</div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.75fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>NFT Collateral</CardTitle>
            <CardDescription>Color-coded by health status with live backend overlays and on-chain data</CardDescription>
          </CardHeader>
          <CardContent>
            {ownedTokens.length === 0 ? (
              <div className="space-y-3">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-400">
                  Connect a wallet to load collateral positions.
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>NFT Image</TableHead>
                      <TableHead>Collection</TableHead>
                      <TableHead>Token ID</TableHead>
                      <TableHead>Floor Price</TableHead>
                      <TableHead>LTV</TableHead>
                      <TableHead>Panic Status</TableHead>
                      <TableHead>Health Factor</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ownedTokens.map((tokenId) => (
                      <CollateralRow
                        key={tokenId}
                        tokenId={tokenId}
                        ethUsd={ethUsd}
                        backendRisk={backendRiskByToken[tokenId]}
                        backendLtv={backendLtvByToken[tokenId]}
                        selected={selectedTokenId === String(tokenId)}
                        onSelect={(id) => {
                          setSelectedTokenId(String(id));
                          addActivity(setActivity, `Selected NFT #${id}`, "Opened token details and quick actions.", "normal");
                        }}
                        onResolved={(row) => setTokenRows((prev) => ({ ...prev, [row.tokenId]: row }))}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Wallet Summary</CardTitle>
              <CardDescription>Quick on-chain and backend signals</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between"><span className="text-slate-400">WebSocket</span><Badge variant={wsState === "connected" ? "success" : wsState === "connecting" ? "warning" : "danger"}>{wsState}</Badge></div>
                <div className="flex items-center justify-between"><span className="text-slate-400">NFTs</span><span>{tokenCount}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-400">Wallet</span><span>{shortAddress(address || "") || "—"}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-400">Network</span><span>{process.env.NEXT_PUBLIC_NETWORK_MODE || "local"}</span></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Selected NFT</CardTitle>
              <CardDescription>Details panel for quick actions</CardDescription>
            </CardHeader>
            <CardContent>
              {selectedRow ? (
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Token</span>
                    <Badge variant={tokenStatusColor(selectedRow.status)}>{selectedRow.status.toUpperCase()}</Badge>
                  </div>
                  <div className="text-lg font-semibold">{selectedRow.collection} #{selectedRow.tokenId}</div>
                  <div className="text-slate-400">Floor: {selectedRow.floorEth.toFixed(4)} ETH</div>
                  <div className="text-slate-400">Debt: {selectedRow.debtEth.toFixed(4)} ETH</div>
                  <div className="text-slate-400">Health Factor: {selectedRow.healthFactor.toFixed(2)}</div>
                  <div className="text-slate-400">Backend risk: {selectedRow.backendRisk?.status || "n/a"}</div>
                </div>
              ) : (
                <div className="text-sm text-slate-400">Select an NFT row to view details.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Active Loans</CardTitle>
            <CardDescription>Borrowed amount, interest, and payment schedule</CardDescription>
          </CardHeader>
          <CardContent>
            {activeLoans.length === 0 ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>NFT</TableHead>
                      <TableHead>Borrowed Amount</TableHead>
                      <TableHead>Interest</TableHead>
                      <TableHead>Next Payment Due</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeLoans.map((token) => (
                      <LoanRow key={token.tokenId} token={token} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Smart contract events, backend responses, and wallet actions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {activity.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{item.title}</div>
                    <Badge variant={getToneBadgeVariant(item.tone)}>{item.time}</Badge>
                  </div>
                  <div className="mt-1 text-sm text-slate-400">{item.detail}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Deposit NFT, request loan, or buy a license for the selected NFT</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="collateral" value={selectedTab} onValueChange={setSelectedTab}>
            <TabsList className="mb-4 gap-2">
              <TabsTrigger value="collateral">Collateral</TabsTrigger>
              <TabsTrigger value="loan">Loan</TabsTrigger>
              <TabsTrigger value="license">License</TabsTrigger>
            </TabsList>

            <TabsContent value="collateral" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-wide text-slate-400">Selected Token</label>
                  <input value={selectedTokenId} onChange={(e) => setSelectedTokenId(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm outline-none focus:border-cyan-500" />
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-wide text-slate-400">Deposit More (ETH)</label>
                  <input value={depositMoreEth} onChange={(e) => setDepositMoreEth(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm outline-none focus:border-cyan-500" />
                </div>
                <div className="flex items-end gap-3">
                  <Button onClick={handleDepositNFT} disabled={isWritePending || !selectedRow}>Deposit NFT</Button>
                  <Button variant="outline" onClick={() => selectedRow && handleDepositMore(selectedRow.tokenId)} disabled={isWritePending || !selectedRow}>Deposit More</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="loan" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-wide text-slate-400">Loan Amount (ETH)</label>
                  <input value={loanAmountEth} onChange={(e) => setLoanAmountEth(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm outline-none focus:border-cyan-500" />
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-wide text-slate-400">Repay Amount (ETH)</label>
                  <input value={repayAmountEth} onChange={(e) => setRepayAmountEth(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm outline-none focus:border-cyan-500" />
                </div>
                <div className="flex items-end gap-3">
                  <Button onClick={handleRequestLoan} disabled={isWritePending || !selectedRow}>Request Loan</Button>
                  <Button variant="secondary" onClick={handleRepay} disabled={isWritePending || !selectedRow}>Repay</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="license" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-wide text-slate-400">License Type</label>
                  <input value={licenseType} onChange={(e) => setLicenseType(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm outline-none focus:border-cyan-500" />
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-wide text-slate-400">Territory</label>
                  <input value={territory} onChange={(e) => setTerritory(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm outline-none focus:border-cyan-500" />
                </div>
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-wide text-slate-400">Duration (days)</label>
                  <input value={licenseDays} onChange={(e) => setLicenseDays(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm outline-none focus:border-cyan-500" />
                </div>
                <div className="flex items-end">
                  <Button onClick={handleBuyLicense} disabled={isWritePending || !selectedRow}>Buy License</Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </main>
  );
}
