"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useWriteContract } from "wagmi";
import { formatEther, type Address, parseEther } from "viem";
import { ADDRESSES, getContracts, getReadProvider } from "../../../../lib/contracts";
import { isAdmin } from "../../../../lib/auth";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";

type UpdateRow = {
  id: string;
  tokenId: number;
  floorPriceEth: number;
  rarityMultiplier: number;
  at: string;
  source: string;
};

type CurrentValuation = {
  tokenId: number;
  floorValueEth: string;
  appraisalValueEth: string;
  liquidationValueEth: string;
};

const oracleAdminAbi = [
  "function setValuation(uint256 rightsId, uint256 price, uint256 rarityMultiplier, string trademarkRef) external",
  "function getFloorValue(uint256 rightsId) external view returns (uint256)",
  "function getValuations(uint256 rightsId) external view returns (uint256 liquidationValue, uint256 appraisalValue)",
] as const;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

export default function OracleAdminPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const [tokenIdInput, setTokenIdInput] = useState("1");
  const [floorPriceEth, setFloorPriceEth] = useState("1.0");
  const [currentValuation, setCurrentValuation] = useState<CurrentValuation | null>(null);
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [loadingValuation, setLoadingValuation] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [trademarkCheckedAt, setTrademarkCheckedAt] = useState<string>(new Date().toLocaleString());
  const [reverifying, setReverifying] = useState(false);

  const adminWallet = useMemo(() => Boolean(address && isAdmin(address)), [address]);

  useEffect(() => {
    let mounted = true;

    async function loadRecentUpdates() {
      try {
        const res = await fetch("/api/admin/oracle/updates", { cache: "no-store" });
        if (!res.ok) {
          return;
        }

        const json = await res.json();
        const rows = (json?.updates ?? []).map((u: any, idx: number) => ({
          id: String(u?.id ?? `remote-${idx}`),
          tokenId: Number(u?.tokenId ?? 0),
          floorPriceEth: toNumber(u?.floorPriceEth ?? 0),
          rarityMultiplier: toNumber(u?.rarityMultiplier ?? 1),
          at: String(u?.at ?? "-"),
          source: "event",
        })) as UpdateRow[];

        if (mounted && rows.length) {
          setUpdates(rows);
        }
      } catch {
        // Optional feed endpoint: ignore if absent.
      }
    }

    loadRecentUpdates();
    return () => {
      mounted = false;
    };
  }, []);

  async function fetchCurrentValuation() {
    const tokenId = Number(tokenIdInput);
    if (!Number.isFinite(tokenId) || tokenId <= 0) {
      setError("Enter a valid tokenId to fetch current valuation.");
      return;
    }

    setLoadingValuation(true);
    setError("");

    try {
      const contracts = getContracts(getReadProvider());
      const [floorValue, valuations] = await Promise.all([
        contracts.oracle.getFloorValue(BigInt(tokenId)),
        contracts.oracle.getValuations(BigInt(tokenId)),
      ]);

      setCurrentValuation({
        tokenId,
        floorValueEth: formatEther(floorValue),
        liquidationValueEth: formatEther(valuations.liquidationValue),
        appraisalValueEth: formatEther(valuations.appraisalValue),
      });
    } catch (err) {
      setError((err as Error).message || "Unable to fetch valuation");
    } finally {
      setLoadingValuation(false);
    }
  }

  async function pushToOracleRegistry() {
    if (!address || !adminWallet) {
      setError("Admin multisig signer wallet is required.");
      return;
    }

    const price = Number(floorPriceEth);
    if (!Number.isFinite(price) || price <= 0) {
      setError("Floor price must be greater than 0.");
      return;
    }

    setPushing(true);
    setError("");
    setSuccess("");

    try {
      const tokenId = Number(tokenIdInput);
      if (!Number.isFinite(tokenId) || tokenId <= 0) {
        throw new Error("Enter a valid tokenId.");
      }

      const valueWei = parseEther(price.toString());

      await writeContractAsync({
        abi: oracleAdminAbi,
        address: ADDRESSES.oracle as Address,
        functionName: "setValuation",
        args: [BigInt(tokenId), valueWei, parseEther("1.0"), "UK00003897277"],
      } as never);

      setUpdates((prev) => [
        {
          id: `${Date.now()}-${tokenId}`,
          tokenId,
          floorPriceEth: price,
          rarityMultiplier: 1.0,
          at: new Date().toLocaleString(),
          source: "manual",
        },
        ...prev,
      ].slice(0, 20));

      // Let NFT Gallery know values changed, then refresh current route cache.
      window.localStorage.setItem("nftGalleryRefreshAt", String(Date.now()));
      window.dispatchEvent(new CustomEvent("nft-gallery-refresh"));
      router.refresh();

      setSuccess(`Valuation set for token #${tokenId}. NFT gallery refresh requested.`);
      await fetchCurrentValuation();
    } catch (err) {
      setError((err as Error).message || "Push to oracle registry failed");
    } finally {
      setPushing(false);
    }
  }

  async function mockReverifyTrademark() {
    setReverifying(true);
    setTimeout(() => {
      setTrademarkCheckedAt(new Date().toLocaleString());
      setReverifying(false);
      setSuccess("Trademark verification refreshed (mock). Verified: UK00003897277");
    }, 700);
  }

  if (!isConnected || !address) {
    return (
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold">Oracle Admin</h1>
        <p className="text-sm opacity-80">Connect your admin wallet to manage oracle valuations.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Oracle Admin</h1>
        <p className="mt-1 text-sm opacity-80">Set floor valuations, inspect current token valuation, and monitor oracle updates.</p>
        <p className="mt-2 text-sm text-amber-300">Chainlink feed not available – prices are set manually by admin.</p>
      </div>

      {!adminWallet ? (
        <Card>
          <CardContent className="pt-6 text-sm text-rose-300">Connected wallet is not an authorized multisig signer.</CardContent>
        </Card>
      ) : null}

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

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Set Floor Valuation</CardTitle>
            <CardDescription>Enter tokenId and floor price (ETH), then call OracleRegistry.setValuation(...).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-sm">tokenId</label>
              <input
                className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                value={tokenIdInput}
                onChange={(e) => setTokenIdInput(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">floorPrice (ETH)</label>
              <input
                className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                value={floorPriceEth}
                onChange={(e) => setFloorPriceEth(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={fetchCurrentValuation} variant="outline" disabled={loadingValuation}>
                {loadingValuation ? "Loading..." : "Display Current Valuation"}
              </Button>
              <Button onClick={pushToOracleRegistry} disabled={!adminWallet || pushing}>
                {pushing ? "Submitting..." : "Set Valuation"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Current Token Valuation</CardTitle>
            <CardDescription>Live read from OracleRegistry contract.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingValuation ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : currentValuation ? (
              <div className="space-y-2 text-sm">
                <div>Token: <strong>#{currentValuation.tokenId}</strong></div>
                <div>Floor Value: <strong>{currentValuation.floorValueEth} ETH</strong></div>
                <div>Liquidation Value: <strong>{currentValuation.liquidationValueEth} ETH</strong></div>
                <div>Appraisal Value: <strong>{currentValuation.appraisalValueEth} ETH</strong></div>
              </div>
            ) : (
              <p className="text-sm opacity-80">No token valuation loaded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Oracle Updates</CardTitle>
          <CardDescription>Recent valuation updates from local session and optional event feed.</CardDescription>
        </CardHeader>
        <CardContent>
          {updates.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Token ID</TableHead>
                  <TableHead>Floor Price (ETH)</TableHead>
                  <TableHead>Rarity Multiplier</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {updates.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.at}</TableCell>
                    <TableCell>#{u.tokenId}</TableCell>
                    <TableCell>{u.floorPriceEth.toFixed(4)}</TableCell>
                    <TableCell>{u.rarityMultiplier.toFixed(1)}</TableCell>
                    <TableCell>{u.source}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm opacity-80">No updates yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trademark Verification</CardTitle>
          <CardDescription>Banksy collection legal anchor status.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <Badge variant="success">Verified: UK00003897277</Badge>
          </div>
          <div>Last checked: {trademarkCheckedAt}</div>
          <Button variant="outline" onClick={mockReverifyTrademark} disabled={reverifying}>
            {reverifying ? "Re-verifying..." : "Re-verify (mock)"}
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
