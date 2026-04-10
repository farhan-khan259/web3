const express = require("express");
const { Contract, JsonRpcProvider, Interface, isAddress, getAddress, formatEther } = require("ethers");
const { createNftRoutes } = require("./nfts");

const vaultAbi = [
  "function getLockedRightsByWallet(address owner) external view returns (uint256[] memory)",
  "function getSnapshotValue(uint256 rightsId) external view returns (uint256)",
  "function isLocked(uint256 rightsId) external view returns (bool)",
];

const loanAbi = [
  "function outstandingDebt(uint256 rightsId) external view returns (uint256)",
  "function isPanicMode(uint256 rightsId) external view returns (bool)",
  "function getCurrentLTV(uint256 rightsId) external view returns (uint256)",
  "function getDynamicMaxLTV(uint256 rightsId) external view returns (uint256)",
  "function panicThresholdBps() external view returns (uint256)",
  "function checkAndLiquidate(uint256 rightsId) external returns (bool)",
  "function setPanicThresholdBps(uint256 newThresholdBps) external",
];

const licenseAbi = [
  "function isLicenseValid(uint256 licenseId) external view returns (bool)",
];

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function decimalToString(value, fallback = "0") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value.toString === "function") return value.toString();
  return fallback;
}

function toBigIntSafe(value) {
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

function jsonError(response, status, message, extra = {}) {
  return response.status(status).json({ error: message, ...extra });
}

function normalizeWallet(wallet) {
  const candidate = String(wallet || "").trim();
  if (!candidate || !isAddress(candidate)) return "";
  return getAddress(candidate);
}

function buildContracts() {
  const rpcUrl = String(process.env.RPC_URL || process.env.ALCHEMY_URL || "").trim();
  if (!rpcUrl) {
    return { provider: null, vault: null, loan: null, license: null };
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const vaultAddress = String(process.env.VAULT_ADDRESS || process.env.NEXT_PUBLIC_VAULT_ADDRESS || "").trim();
  const loanAddress = String(process.env.LOAN_ENGINE_ADDRESS || process.env.NEXT_PUBLIC_LOAN_ENGINE_ADDRESS || "").trim();
  const licenseAddress = String(process.env.LICENSE_TOKEN_ADDRESS || process.env.NEXT_PUBLIC_LICENSE_TOKEN_ADDRESS || "").trim();

  return {
    provider,
    vault: isAddress(vaultAddress) ? new Contract(getAddress(vaultAddress), vaultAbi, provider) : null,
    loan: isAddress(loanAddress) ? new Contract(getAddress(loanAddress), loanAbi, provider) : null,
    license: isAddress(licenseAddress) ? new Contract(getAddress(licenseAddress), licenseAbi, provider) : null,
  };
}

function createRoutes({ prisma, requireAdminJwt }) {
  const router = express.Router();
  const contracts = buildContracts();

  router.use(createNftRoutes({ contracts, jsonError }));

  async function enrichLoanRealtime(tokenId) {
    if (!contracts.loan) {
      return {
        onchainDebt: null,
        onchainLtvBps: null,
        onchainPanicMode: null,
      };
    }

    const id = BigInt(tokenId);
    const [debt, ltv, panic] = await Promise.all([
      contracts.loan.outstandingDebt(id).catch(() => null),
      contracts.loan.getCurrentLTV(id).catch(() => null),
      contracts.loan.isPanicMode(id).catch(() => null),
    ]);

    return {
      onchainDebt: debt !== null ? decimalToString(debt) : null,
      onchainLtvBps: ltv !== null ? toNumber(ltv) : null,
      onchainPanicMode: panic !== null ? Boolean(panic) : null,
    };
  }

  router.get("/api/user/collateral", async (request, response) => {
    try {
      const wallet = normalizeWallet(request.query.wallet);
      if (!wallet) return jsonError(response, 400, "Valid wallet query parameter is required");

      const user = await prisma.user.findUnique({ where: { walletAddress: wallet.toLowerCase() } });
      const deposits = await prisma.deposit.findMany({
        where: { userId: user?.id || "", withdrawnAt: null },
        orderBy: { depositedAt: "desc" },
      });

      const tokenIds = deposits.map((d) => d.tokenId);
      const lockedByWallet = contracts.vault
        ? await contracts.vault.getLockedRightsByWallet(wallet).catch(() => [])
        : [];
      const lockedSet = new Set((lockedByWallet || []).map((id) => id.toString()));

      const collateralRows = await Promise.all(
        tokenIds.map(async (tokenId) => {
          const snapshotValue = contracts.vault
            ? await contracts.vault.getSnapshotValue(tokenId).catch(() => 0n)
            : 0n;
          const isLocked = contracts.vault
            ? await contracts.vault.isLocked(tokenId).catch(() => lockedSet.has(tokenId.toString()))
            : lockedSet.has(tokenId.toString());

          return {
            tokenId: tokenId.toString(),
            collectionAddress: deposits.find((d) => d.tokenId.toString() === tokenId.toString())?.collectionAddress || "",
            snapshotValueWei: decimalToString(snapshotValue),
            snapshotValueEth: Number(formatEther(snapshotValue || 0n)),
            isLocked: Boolean(isLocked),
          };
        })
      );

      return response.json({
        status: "ok",
        wallet,
        total: collateralRows.length,
        items: collateralRows,
      });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to load collateral");
    }
  });

  router.get("/api/user/debt", async (request, response) => {
    try {
      const wallet = normalizeWallet(request.query.wallet);
      if (!wallet) return jsonError(response, 400, "Valid wallet query parameter is required");

      const user = await prisma.user.findUnique({ where: { walletAddress: wallet.toLowerCase() } });
      if (!user) {
        return response.json({ status: "ok", wallet, totals: { activeDebt: "0", loanCount: 0 }, loans: [] });
      }

      const loans = await prisma.loan.findMany({
        where: { borrowerId: user.id, status: { in: ["ACTIVE", "PANIC"] } },
        orderBy: { createdAt: "desc" },
      });

      let activeDebt = 0;
      const items = [];
      for (const loan of loans) {
        activeDebt += toNumber(loan.debtTokenAmount, 0);
        const realtime = await enrichLoanRealtime(loan.tokenId);
        items.push({
          id: loan.id,
          tokenId: loan.tokenId.toString(),
          status: loan.status,
          debtTokenAmount: decimalToString(loan.debtTokenAmount),
          healthFactor: toNumber(loan.healthFactor),
          createdAt: loan.createdAt,
          ...realtime,
        });
      }

      return response.json({
        status: "ok",
        wallet,
        totals: {
          activeDebt: activeDebt.toString(),
          loanCount: items.length,
        },
        loans: items,
      });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to load debt");
    }
  });

  router.get("/api/user/available-borrowing-power", async (request, response) => {
    try {
      const wallet = normalizeWallet(request.query.wallet);
      if (!wallet) return jsonError(response, 400, "Valid wallet query parameter is required");

      const user = await prisma.user.findUnique({ where: { walletAddress: wallet.toLowerCase() } });
      if (!user) {
        return response.json({ status: "ok", wallet, borrowingPowerWei: "0", borrowingPowerEth: 0 });
      }

      const activeLoans = await prisma.loan.findMany({
        where: { borrowerId: user.id, status: { in: ["ACTIVE", "PANIC"] } },
      });

      const deposits = await prisma.deposit.findMany({ where: { userId: user.id, withdrawnAt: null } });

      let totalMaxBorrowWei = 0n;
      let outstandingDebtWei = 0n;

      for (const dep of deposits) {
        const tokenId = dep.tokenId;
        const snapshot = contracts.vault ? await contracts.vault.getSnapshotValue(tokenId).catch(() => 0n) : 0n;
        let dynamicLtvBps = 7000;
        if (contracts.loan) {
          dynamicLtvBps = toNumber(await contracts.loan.getDynamicMaxLTV(tokenId).catch(() => 7000));
        }
        totalMaxBorrowWei += (snapshot * BigInt(dynamicLtvBps)) / 10000n;
      }

      for (const loan of activeLoans) {
        const onchainDebt = contracts.loan
          ? await contracts.loan.outstandingDebt(loan.tokenId).catch(() => null)
          : null;
        const debtWei = onchainDebt !== null ? onchainDebt : toBigIntSafe(decimalToString(loan.debtTokenAmount)) || 0n;
        outstandingDebtWei += debtWei;
      }

      const availableWei = totalMaxBorrowWei > outstandingDebtWei ? totalMaxBorrowWei - outstandingDebtWei : 0n;

      return response.json({
        status: "ok",
        wallet,
        borrowingPowerWei: availableWei.toString(),
        borrowingPowerEth: Number(formatEther(availableWei)),
        totalMaxBorrowWei: totalMaxBorrowWei.toString(),
        outstandingDebtWei: outstandingDebtWei.toString(),
      });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to load borrowing power");
    }
  });

  router.get("/api/user/panic-alerts", async (request, response) => {
    try {
      const wallet = normalizeWallet(request.query.wallet);
      if (!wallet) return jsonError(response, 400, "Valid wallet query parameter is required");

      const user = await prisma.user.findUnique({ where: { walletAddress: wallet.toLowerCase() } });
      if (!user) return response.json({ status: "ok", wallet, alerts: [] });

      const loans = await prisma.loan.findMany({
        where: { borrowerId: user.id },
        select: { id: true, tokenId: true },
      });

      const panicEvents = await prisma.panicEvent.findMany({
        where: { loanId: { in: loans.map((l) => l.id) }, exitedAt: null },
        orderBy: { enteredAt: "desc" },
      });

      const alerts = await Promise.all(
        panicEvents.map(async (event) => {
          const realtime = await enrichLoanRealtime(event.tokenId);
          return {
            id: event.id,
            tokenId: event.tokenId.toString(),
            triggerLtv: decimalToString(event.triggerLtv),
            panicThreshold: decimalToString(event.panicThreshold),
            enteredAt: event.enteredAt,
            ...realtime,
          };
        })
      );

      return response.json({ status: "ok", wallet, alerts });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to load panic alerts");
    }
  });

  router.get("/api/user/debt-history", async (request, response) => {
    try {
      const wallet = normalizeWallet(request.query.wallet);
      if (!wallet) return jsonError(response, 400, "Valid wallet query parameter is required");
      const limit = Math.min(toNumber(request.query.limit, 100), 500);

      const user = await prisma.user.findUnique({ where: { walletAddress: wallet.toLowerCase() } });
      if (!user) return response.json({ status: "ok", wallet, items: [] });

      const loans = await prisma.loan.findMany({
        where: { borrowerId: user.id },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      const items = await Promise.all(
        loans.map(async (loan) => ({
          id: loan.id,
          tokenId: loan.tokenId.toString(),
          amountBorrowed: decimalToString(loan.amountBorrowed),
          debtTokenAmount: decimalToString(loan.debtTokenAmount),
          status: loan.status,
          createdAt: loan.createdAt,
          repaidAt: loan.repaidAt,
          ...await enrichLoanRealtime(loan.tokenId),
        }))
      );

      return response.json({ status: "ok", wallet, items });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to load debt history");
    }
  });

  router.get("/api/loans/active", async (request, response) => {
    try {
      const wallet = normalizeWallet(request.query.wallet);
      if (!wallet) return jsonError(response, 400, "Valid wallet query parameter is required");

      const user = await prisma.user.findUnique({ where: { walletAddress: wallet.toLowerCase() } });
      if (!user) return response.json({ status: "ok", wallet, items: [] });

      const loans = await prisma.loan.findMany({
        where: { borrowerId: user.id, status: { in: ["ACTIVE", "PANIC"] } },
        orderBy: { createdAt: "desc" },
      });

      const items = await Promise.all(
        loans.map(async (loan) => ({
          id: loan.id,
          tokenId: loan.tokenId.toString(),
          amountBorrowed: decimalToString(loan.amountBorrowed),
          debtTokenAmount: decimalToString(loan.debtTokenAmount),
          status: loan.status,
          createdAt: loan.createdAt,
          ...await enrichLoanRealtime(loan.tokenId),
        }))
      );

      return response.json({ status: "ok", wallet, items });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to load active loans");
    }
  });

  router.get("/api/loans/history", async (request, response) => {
    try {
      const wallet = normalizeWallet(request.query.wallet);
      const limit = Math.min(toNumber(request.query.limit, 100), 500);

      const where = {};
      if (wallet) {
        const user = await prisma.user.findUnique({ where: { walletAddress: wallet.toLowerCase() } });
        if (!user) return response.json({ status: "ok", wallet, items: [] });
        where.borrowerId = user.id;
      }

      const loans = await prisma.loan.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      const items = await Promise.all(
        loans.map(async (loan) => ({
          id: loan.id,
          tokenId: loan.tokenId.toString(),
          amountBorrowed: decimalToString(loan.amountBorrowed),
          debtTokenAmount: decimalToString(loan.debtTokenAmount),
          status: loan.status,
          createdAt: loan.createdAt,
          repaidAt: loan.repaidAt,
          ...await enrichLoanRealtime(loan.tokenId),
        }))
      );

      return response.json({
        status: "ok",
        wallet: wallet || null,
        items,
      });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to load loan history");
    }
  });

  router.get("/api/revenue/earned", async (request, response) => {
    try {
      const wallet = normalizeWallet(request.query.wallet);
      if (!wallet) return jsonError(response, 400, "Valid wallet query parameter is required");

      const licenseRows = await prisma.license.findMany({
        where: { holderAddress: wallet.toLowerCase() },
        select: { nftTokenId: true },
      });
      const tokenIds = [...new Set(licenseRows.map((row) => row.nftTokenId.toString()))];

      const flows = await prisma.revenueFlow.findMany({
        where: { tokenId: { in: tokenIds.map((id) => BigInt(id)) } },
        orderBy: { distributedAt: "desc" },
      });

      let total = 0;
      for (const flow of flows) total += toNumber(flow.amount, 0);

      const treasuryBalance = contracts.provider && process.env.REVENUE_DISTRIBUTOR_ADDRESS
        ? await contracts.provider.getBalance(process.env.REVENUE_DISTRIBUTOR_ADDRESS).catch(() => null)
        : null;

      return response.json({
        status: "ok",
        wallet,
        totalEarned: total.toString(),
        treasuryBalanceWei: treasuryBalance ? treasuryBalance.toString() : null,
        treasuryBalanceEth: treasuryBalance ? Number(formatEther(treasuryBalance)) : null,
        items: flows.map((flow) => ({
          id: flow.id,
          tokenId: flow.tokenId.toString(),
          amount: flow.amount.toString(),
          source: flow.source,
          distributionType: flow.distributionType,
          distributedAt: flow.distributedAt,
        })),
      });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to load earned revenue");
    }
  });

  router.get("/api/license/available", async (request, response) => {
    try {
      const nftTokenId = toNumber(request.query.nftTokenId, NaN);
      if (!Number.isFinite(nftTokenId) || nftTokenId <= 0) {
        return jsonError(response, 400, "Valid nftTokenId query parameter is required");
      }

      const licenses = await prisma.license.findMany({
        where: {
          nftTokenId: BigInt(nftTokenId),
          isActive: true,
          endTimestamp: { gt: new Date() },
        },
        orderBy: { endTimestamp: "asc" },
      });

      const items = await Promise.all(
        licenses.map(async (row) => {
          const onchainValid = contracts.license
            ? await contracts.license.isLicenseValid(row.licenseTokenId).catch(() => null)
            : null;
          return {
            licenseId: row.licenseTokenId.toString(),
            holder: row.holderAddress,
            nftTokenId: row.nftTokenId.toString(),
            licenseType: row.licenseType,
            territory: row.territory,
            startTimestamp: row.startTimestamp,
            endTimestamp: row.endTimestamp,
            trademarkRef: row.trademarkRef,
            onchainValid,
          };
        })
      );

      return response.json({ status: "ok", nftTokenId: String(nftTokenId), items });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to load available license list");
    }
  });

  router.post("/api/admin/update-oracle", requireAdminJwt, async (request, response) => {
    try {
      const collectionAddress = normalizeWallet(request.body.collectionAddress || request.body.collection);
      const floorPrice = toNumber(request.body.floorPrice, NaN);
      const rarityScore = toNumber(request.body.rarityScore, 0);
      const utilityScore = toNumber(request.body.utilityScore, 0);
      const valuationPrimary = toNumber(request.body.valuationPrimary, NaN);
      const valuationSecondary = toNumber(request.body.valuationSecondary, NaN);

      if (!collectionAddress || !Number.isFinite(floorPrice) || !Number.isFinite(valuationPrimary) || !Number.isFinite(valuationSecondary)) {
        return jsonError(response, 400, "collectionAddress, floorPrice, valuationPrimary, valuationSecondary are required");
      }

      const snapshot = await prisma.oracleSnapshot.create({
        data: {
          collectionAddress: collectionAddress.toLowerCase(),
          floorPrice,
          rarityScore,
          utilityScore,
          valuationPrimary,
          valuationSecondary,
        },
      });

      const latestBlock = contracts.provider ? await contracts.provider.getBlockNumber().catch(() => null) : null;

      return response.json({
        status: "ok",
        updatedBy: request.admin.walletAddress,
        latestBlock,
        snapshot: {
          id: snapshot.id,
          collectionAddress: snapshot.collectionAddress,
          floorPrice: snapshot.floorPrice.toString(),
          rarityScore: snapshot.rarityScore.toString(),
          utilityScore: snapshot.utilityScore.toString(),
          valuationPrimary: snapshot.valuationPrimary.toString(),
          valuationSecondary: snapshot.valuationSecondary.toString(),
          timestamp: snapshot.timestamp,
        },
      });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to update oracle");
    }
  });

  router.get("/api/admin/stats", requireAdminJwt, async (request, response) => {
    try {
      const windowDays = Math.max(7, Math.min(toNumber(request.query.windowDays, 30), 180));
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

      const [activeDeposits, activeLoans, activePanicEvents, revenueFlows, recentOracle, usersCount] = await Promise.all([
        prisma.deposit.findMany({ where: { withdrawnAt: null } }),
        prisma.loan.findMany({ where: { status: { in: ["ACTIVE", "PANIC"] } } }),
        prisma.panicEvent.findMany({ where: { exitedAt: null } }),
        prisma.revenueFlow.findMany({ where: { distributedAt: { gte: since } }, orderBy: { distributedAt: "asc" } }),
        prisma.oracleSnapshot.findFirst({ orderBy: { timestamp: "desc" } }),
        prisma.user.count(),
      ]);

      const dayKey = (value) => {
        const date = new Date(value);
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
      };

      const moneyToNumber = (value) => {
        const parsed = Number(String(value || "0"));
        return Number.isFinite(parsed) ? parsed : 0;
      };

      const toEthFromWei = (value) => Number(formatEther(value || 0n));

      let totalCollateralEth = 0;
      for (const dep of activeDeposits) {
        const snapshotWei = contracts.vault ? await contracts.vault.getSnapshotValue(dep.tokenId).catch(() => 0n) : 0n;
        totalCollateralEth += toEthFromWei(snapshotWei);
      }

      let totalDebtEth = 0;
      for (const loan of activeLoans) {
        const onchainDebt = contracts.loan ? await contracts.loan.outstandingDebt(loan.tokenId).catch(() => null) : null;
        if (onchainDebt !== null) {
          totalDebtEth += toEthFromWei(onchainDebt);
        } else {
          totalDebtEth += moneyToNumber(loan.debtTokenAmount);
        }
      }

      const totalRevenue = revenueFlows.reduce((sum, row) => sum + moneyToNumber(row.amount), 0);

      const loanRowsForChart = await prisma.loan.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, amountBorrowed: true },
      });

      const panicRowsForChart = await prisma.panicEvent.findMany({
        where: { enteredAt: { gte: since } },
        orderBy: { enteredAt: "asc" },
        select: { enteredAt: true },
      });

      const loanVolumeMap = {};
      for (const row of loanRowsForChart) {
        const key = dayKey(row.createdAt);
        loanVolumeMap[key] = (loanVolumeMap[key] || 0) + moneyToNumber(row.amountBorrowed);
      }

      const revenueMap = {};
      for (const row of revenueFlows) {
        const key = dayKey(row.distributedAt);
        revenueMap[key] = (revenueMap[key] || 0) + moneyToNumber(row.amount);
      }

      const panicMap = {};
      for (const row of panicRowsForChart) {
        const key = dayKey(row.enteredAt);
        panicMap[key] = (panicMap[key] || 0) + 1;
      }

      const dateLabels = [];
      for (let i = windowDays - 1; i >= 0; i -= 1) {
        dateLabels.push(dayKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000)));
      }

      const loanVolumeSeries = dateLabels.map((label) => ({ label, value: Number((loanVolumeMap[label] || 0).toFixed(6)) }));
      const revenueSeries = dateLabels.map((label) => ({ label, value: Number((revenueMap[label] || 0).toFixed(6)) }));
      const panicSeries = dateLabels.map((label) => ({ label, value: panicMap[label] || 0 }));

      const oracleTimestamp = recentOracle?.timestamp ? new Date(recentOracle.timestamp).getTime() : 0;
      const oracleHealth = oracleTimestamp > 0 && Date.now() - oracleTimestamp < 60 * 60 * 1000 ? "green" : "stale";

      return response.json({
        status: "ok",
        kpis: {
          tvl: Number((totalCollateralEth - totalDebtEth).toFixed(6)),
          totalCollateral: Number(totalCollateralEth.toFixed(6)),
          totalDebt: Number(totalDebtEth.toFixed(6)),
          activeLoansCount: activeLoans.length,
          panicCount: activePanicEvents.length,
          totalRevenue: Number(totalRevenue.toFixed(6)),
          usersCount,
          oracleHealth,
          oracleLastUpdateTs: oracleTimestamp,
        },
        charts: {
          loanVolumeSeries,
          revenueSeries,
          panicSeries,
        },
      });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to load admin stats");
    }
  });

  router.get("/api/admin/tvl", requireAdminJwt, async (_request, response) => {
    try {
      const [activeDeposits, activeLoans] = await Promise.all([
        prisma.deposit.findMany({ where: { withdrawnAt: null } }),
        prisma.loan.findMany({ where: { status: { in: ["ACTIVE", "PANIC"] } } }),
      ]);

      let collateralWei = 0n;
      for (const dep of activeDeposits) {
        const value = contracts.vault ? await contracts.vault.getSnapshotValue(dep.tokenId).catch(() => 0n) : 0n;
        collateralWei += value;
      }

      let debtWei = 0n;
      for (const loan of activeLoans) {
        const debt = contracts.loan
          ? await contracts.loan.outstandingDebt(loan.tokenId).catch(() => null)
          : null;
        debtWei += debt !== null ? debt : toBigIntSafe(loan.debtTokenAmount.toString()) || 0n;
      }

      const vaultBalanceWei = contracts.provider && process.env.VAULT_ADDRESS
        ? await contracts.provider.getBalance(process.env.VAULT_ADDRESS).catch(() => null)
        : null;

      return response.json({
        status: "ok",
        collateralWei: collateralWei.toString(),
        collateralEth: Number(formatEther(collateralWei)),
        debtWei: debtWei.toString(),
        debtEth: Number(formatEther(debtWei)),
        tvlWei: (collateralWei - debtWei > 0n ? collateralWei - debtWei : 0n).toString(),
        vaultBalanceWei: vaultBalanceWei ? vaultBalanceWei.toString() : null,
      });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to load TVL");
    }
  });

  router.get("/api/admin/panic-list", requireAdminJwt, async (_request, response) => {
    try {
      const panicEvents = await prisma.panicEvent.findMany({
        where: { exitedAt: null },
        orderBy: { enteredAt: "desc" },
        include: { loan: { include: { borrower: true } } },
      });

      const items = await Promise.all(
        panicEvents.map(async (event) => {
          const realtime = await enrichLoanRealtime(event.tokenId);
          return {
            panicEventId: event.id,
            tokenId: event.tokenId.toString(),
            triggerLtv: event.triggerLtv.toString(),
            panicThreshold: event.panicThreshold.toString(),
            enteredAt: event.enteredAt,
            loanId: event.loanId,
            borrowerWallet: event.loan?.borrower?.walletAddress || null,
            ...realtime,
          };
        })
      );

      return response.json({ status: "ok", items });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to load panic list");
    }
  });

  router.post("/api/admin/force-liquidate", requireAdminJwt, async (request, response) => {
    try {
      const tokenId = toNumber(request.body.tokenId, NaN);
      if (!Number.isFinite(tokenId) || tokenId <= 0) {
        return jsonError(response, 400, "tokenId is required");
      }

      const loan = await prisma.loan.findFirst({
        where: { tokenId: BigInt(tokenId), status: { in: ["ACTIVE", "PANIC"] } },
        orderBy: { createdAt: "desc" },
      });
      if (!loan) return jsonError(response, 404, "Active loan not found for token");

      let simulation = { success: false, detail: "No RPC / contract configured" };
      if (contracts.loan) {
        try {
          const iface = new Interface(loanAbi);
          const data = iface.encodeFunctionData("checkAndLiquidate", [BigInt(tokenId)]);
          await contracts.provider.call({ to: await contracts.loan.getAddress(), data });
          simulation = { success: true, detail: "Multisig simulation call succeeded" };
        } catch (error) {
          simulation = { success: false, detail: error.message || "Simulation call reverted" };
        }
      }

      const adminUser = await prisma.user.upsert({
        where: { walletAddress: request.admin.walletAddress.toLowerCase() },
        update: {},
        create: {
          walletAddress: request.admin.walletAddress.toLowerCase(),
          roles: "ADMIN",
          notificationPreferences: {},
        },
      });

      const destination = contracts.loan ? await contracts.loan.getAddress() : "0x0000000000000000000000000000000000000000";
      const proposal = await prisma.multisigProposal.create({
        data: {
          proposerId: adminUser.id,
          destination,
          calldata: JSON.stringify({ action: "checkAndLiquidate", tokenId }),
          description: `Force liquidate token ${tokenId}`,
          confirmations: 1,
          executed: false,
        },
      });

      return response.json({ status: "ok", tokenId, simulation, proposal });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to force liquidate");
    }
  });

  router.put("/api/admin/parameters", requireAdminJwt, async (request, response) => {
    try {
      const requestedLtv = request.body?.ltv;
      const panicThresholdBps = request.body?.panicThresholdBps;
      const recoveryThresholdBps = request.body?.recoveryThresholdBps;

      if (requestedLtv === undefined && panicThresholdBps === undefined && recoveryThresholdBps === undefined) {
        return jsonError(response, 400, "At least one parameter is required: ltv, panicThresholdBps, recoveryThresholdBps");
      }

      const adminUser = await prisma.user.upsert({
        where: { walletAddress: request.admin.walletAddress.toLowerCase() },
        update: {},
        create: {
          walletAddress: request.admin.walletAddress.toLowerCase(),
          roles: "ADMIN",
          notificationPreferences: {},
        },
      });

      let onchainCurrentPanicThreshold = null;
      if (contracts.loan) {
        onchainCurrentPanicThreshold = toNumber(await contracts.loan.panicThresholdBps().catch(() => null), null);
      }

      const destination = contracts.loan ? await contracts.loan.getAddress() : "0x0000000000000000000000000000000000000000";
      const proposal = await prisma.multisigProposal.create({
        data: {
          proposerId: adminUser.id,
          destination,
          calldata: JSON.stringify({
            action: "update_parameters",
            params: {
              ltv: requestedLtv,
              panicThresholdBps,
              recoveryThresholdBps,
            },
            authorizedWallet: request.admin.walletAddress,
          }),
          description: "Protocol parameter update (LTV/thresholds)",
          confirmations: 1,
          executed: false,
        },
      });

      return response.json({
        status: "ok",
        proposal,
        realtime: {
          onchainCurrentPanicThreshold,
          rpcConnected: Boolean(contracts.provider),
        },
      });
    } catch (error) {
      return jsonError(response, 500, error.message || "Failed to update parameters");
    }
  });

  return router;
}

module.exports = {
  createRoutes,
};
