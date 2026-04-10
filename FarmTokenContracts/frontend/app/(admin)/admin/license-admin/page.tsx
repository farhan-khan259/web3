"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { type Address, parseEther } from "viem";
import { ADDRESSES, licenseAbi, shortAddress } from "../../../../lib/contracts";
import { isAdmin } from "../../../../lib/auth";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";

type LicenseRow = {
  licenseId: number;
  holder: string;
  tokenId: number;
  expiryDate: string;
  trademarkRef: string;
};

type MintForm = {
  tokenId: string;
  durationDays: string;
  licenseType: "commercial" | "display";
  territory: string;
  priceEth: string;
};

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

function licenseTypeToEnum(value: MintForm["licenseType"]): number {
  return value === "display" ? 0 : 1;
}

function territoryToEnum(value: string): number {
  const v = value.trim().toLowerCase();
  if (v === "uk") return 1;
  if (v === "eu") return 2;
  if (v === "global") return 3;
  return 1;
}

export default function LicenseAdminPage() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<LicenseRow[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [minting, setMinting] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [verifyingTrademark, setVerifyingTrademark] = useState(false);

  const [form, setForm] = useState<MintForm>({
    tokenId: "1",
    durationDays: "30",
    licenseType: "commercial",
    territory: "UK",
    priceEth: "0.05",
  });

  const [trademarkLink, setTrademarkLink] = useState({
    licenseId: "",
    trademarkNumber: "UK00003897277",
  });

  const adminWallet = useMemo(() => Boolean(address && isAdmin(address)), [address]);

  useEffect(() => {
    let mounted = true;

    async function loadLicenses() {
      setLoading(true);
      setError("");

      try {
        const res = await fetch("/api/admin/licenses", { cache: "no-store" });
        let nextRows: LicenseRow[] = [];

        if (res.ok) {
          const json = await res.json();
          nextRows = (json?.licenses ?? []).map((item: any) => ({
            licenseId: Number(item?.licenseId ?? item?.id ?? 0),
            holder: String(item?.holder ?? item?.owner ?? "-"),
            tokenId: Number(item?.tokenId ?? item?.nftTokenId ?? 0),
            expiryDate: String(item?.expiryDate ?? item?.expiresAt ?? "-"),
            trademarkRef: String(item?.trademarkRef ?? "UK00003897277"),
          }));
        }

        if (mounted) {
          setRows(nextRows);
        }
      } catch (err) {
        if (mounted) {
          setError((err as Error).message || "Failed to load licenses");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    if (isConnected && address) {
      loadLicenses();
    } else {
      setLoading(false);
    }

    return () => {
      mounted = false;
    };
  }, [address, isConnected]);

  async function mintLicense() {
    if (!address || !adminWallet) {
      setError("Admin multisig signer wallet is required.");
      return;
    }

    const tokenId = Number(form.tokenId);
    const duration = Number(form.durationDays);
    const price = Number(form.priceEth);

    if (!Number.isFinite(tokenId) || tokenId <= 0) {
      setError("NFT tokenId must be a positive number.");
      return;
    }

    if (!Number.isFinite(duration) || duration <= 0) {
      setError("Duration (days) must be a positive number.");
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      setError("Price (ETH) must be a valid non-negative number.");
      return;
    }

    setMinting(true);
    setError("");
    setMessage("");

    try {
      await writeContractAsync({
        abi: licenseAbi,
        address: ADDRESSES.licenseToken as Address,
        functionName: "mintLicense",
        args: [
          address as Address,
          1n,
          BigInt(tokenId),
          BigInt(duration),
          BigInt(licenseTypeToEnum(form.licenseType)),
          BigInt(territoryToEnum(form.territory)),
          trademarkLink.trademarkNumber || "UK00003897277",
        ],
        value: price > 0 ? parseEther(form.priceEth) : undefined,
      } as never);

      // Optional off-chain persistence for listing metadata including price.
      try {
        await fetch("/api/admin/licenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tokenId,
            durationDays: duration,
            licenseType: form.licenseType,
            territory: form.territory,
            priceEth: price,
            holder: address,
            trademarkRef: trademarkLink.trademarkNumber || "UK00003897277",
          }),
        });
      } catch {
        // Optional endpoint; ignore failures.
      }

      setMessage(`License minted for token #${tokenId}.`);
      setRows((prev) => [
        {
          licenseId: Date.now(),
          holder: address,
          tokenId,
          expiryDate: `${duration} days from now`,
          trademarkRef: trademarkLink.trademarkNumber || "UK00003897277",
        },
        ...prev,
      ]);
    } catch (err) {
      setError((err as Error).message || "Mint license failed");
    } finally {
      setMinting(false);
    }
  }

  async function revokeLicense(licenseId: number) {
    if (!address || !adminWallet) {
      setError("Admin multisig signer wallet is required.");
      return;
    }

    setRevokingId(licenseId);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/propose-revoke-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposer: address, licenseId }),
      });

      if (!res.ok) {
        throw new Error("Failed to submit revoke license proposal");
      }

      setMessage(`Revoke License proposal submitted for #${licenseId}.`);
    } catch (err) {
      setError((err as Error).message || "Revoke license proposal failed");
    } finally {
      setRevokingId(null);
    }
  }

  async function verifyTrademarkLink() {
    if (!address || !adminWallet) {
      setError("Admin multisig signer wallet is required.");
      return;
    }

    const licenseId = Number(trademarkLink.licenseId);
    if (!Number.isFinite(licenseId) || licenseId <= 0) {
      setError("Enter a valid licenseId for trademark linking.");
      return;
    }

    const trademarkNumber = trademarkLink.trademarkNumber.trim();
    if (!trademarkNumber) {
      setError("Trademark number is required.");
      return;
    }

    setVerifyingTrademark(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/admin/link-trademark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposer: address,
          licenseId,
          trademarkNumber,
          verify: true,
        }),
      });

      if (!res.ok) {
        throw new Error("Trademark verification failed");
      }

      setRows((prev) => prev.map((row) => (row.licenseId === licenseId ? { ...row, trademarkRef: trademarkNumber } : row)));
      setMessage(`Trademark linked and verified for license #${licenseId}.`);
    } catch (err) {
      setError((err as Error).message || "Failed to verify trademark link");
    } finally {
      setVerifyingTrademark(false);
    }
  }

  if (!isConnected || !address) {
    return (
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold">License Admin</h1>
        <p className="text-sm opacity-80">Connect your admin wallet to mint and manage licenses.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">License Admin</h1>
        <p className="mt-1 text-sm opacity-80">Mint licenses, manage revocations, and link trademark references.</p>
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

      {message ? (
        <Card>
          <CardContent className="pt-6 text-sm text-emerald-300">{message}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Mint New License</CardTitle>
            <CardDescription>Calls LicenseToken.mintLicense</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-sm">NFT tokenId</label>
              <input
                className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                value={form.tokenId}
                onChange={(e) => setForm((prev) => ({ ...prev, tokenId: e.target.value }))}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">Duration (days)</label>
              <input
                className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                value={form.durationDays}
                onChange={(e) => setForm((prev) => ({ ...prev, durationDays: e.target.value }))}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">License type</label>
              <div className="flex gap-2">
                <Button variant={form.licenseType === "commercial" ? "default" : "outline"} onClick={() => setForm((prev) => ({ ...prev, licenseType: "commercial" }))}>Commercial</Button>
                <Button variant={form.licenseType === "display" ? "default" : "outline"} onClick={() => setForm((prev) => ({ ...prev, licenseType: "display" }))}>Display</Button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm">Territory</label>
              <input
                className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                value={form.territory}
                onChange={(e) => setForm((prev) => ({ ...prev, territory: e.target.value }))}
                placeholder="UK / EU / Global"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm">Price (ETH)</label>
              <input
                className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                value={form.priceEth}
                onChange={(e) => setForm((prev) => ({ ...prev, priceEth: e.target.value }))}
              />
            </div>

            <Button onClick={mintLicense} disabled={!adminWallet || minting}>
              {minting ? "Minting..." : "Mint License"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Link Trademark</CardTitle>
            <CardDescription>Attach and verify trademark reference for a license.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-sm">licenseId</label>
              <input
                className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                value={trademarkLink.licenseId}
                onChange={(e) => setTrademarkLink((prev) => ({ ...prev, licenseId: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm">Trademark number</label>
              <input
                className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                value={trademarkLink.trademarkNumber}
                onChange={(e) => setTrademarkLink((prev) => ({ ...prev, trademarkNumber: e.target.value }))}
                placeholder="UK00003897277"
              />
            </div>

            <Button variant="outline" onClick={verifyTrademarkLink} disabled={!adminWallet || verifyingTrademark}>
              {verifyingTrademark ? "Verifying..." : "Verify"}
            </Button>

            <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              This license grants only commercial rights as defined by UK trademark law. Physical ownership remains unaffected.
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Existing Licenses</CardTitle>
          <CardDescription>licenseId, holder, NFT tokenId, expiry date, trademark reference.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>License ID</TableHead>
                  <TableHead>Holder</TableHead>
                  <TableHead>NFT tokenId</TableHead>
                  <TableHead>Expiry Date</TableHead>
                  <TableHead>Trademark Reference</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.licenseId}>
                    <TableCell>#{row.licenseId}</TableCell>
                    <TableCell>{shortAddress(row.holder)}</TableCell>
                    <TableCell>#{row.tokenId}</TableCell>
                    <TableCell>{row.expiryDate}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.trademarkRef || "-"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => revokeLicense(row.licenseId)}
                        disabled={!adminWallet || revokingId === row.licenseId}
                      >
                        {revokingId === row.licenseId ? "Submitting..." : "Revoke License"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm opacity-80">No licenses found.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
