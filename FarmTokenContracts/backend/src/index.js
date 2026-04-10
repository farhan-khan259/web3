const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  formatEther,
  parseEther,
  verifyMessage,
  isAddress,
  getAddress,
} = require("ethers");
const { WebSocketServer, WebSocket } = require("ws");
const { Prisma } = require("@prisma/client");
const dotenv = require("dotenv");
const { createRoutes } = require("./routes");
const { createRealtimeSocketServer } = require("./websocket");
const { createAuthRouter, requireAdminJwt } = require("./auth");
const prisma = require("./db");

function loadEnv(filePath) {
  if (fs.existsSync(filePath)) {
    dotenv.config({ path: filePath, override: true });
  }
}

loadEnv(path.resolve(__dirname, "..", ".env.local"));
loadEnv(path.resolve(__dirname, "..", "..", ".env.local"));
loadEnv(path.resolve(__dirname, ".env.local"));

const app = express();
const server = http.createServer(app);
const wsServer = new WebSocketServer({ server, path: "/ws" });

const generalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 240),
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLimiter = rateLimit({
  windowMs: Number(process.env.ADMIN_RATE_LIMIT_WINDOW_MS || 60_000),
  limit: Number(process.env.ADMIN_RATE_LIMIT_PER_MINUTE || 30),
  standardHeaders: true,
  legacyHeaders: false,
});

const corsOrigins = String(process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const jwtSecret = String(process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || "").trim();
const adminWalletAllowlist = String(
  process.env.ADMIN_WALLET_ALLOWLIST || process.env.MULTISIG_SIGNERS || process.env.NEXT_PUBLIC_MULTISIG_SIGNERS || ""
)
  .split(",")
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

const rpcUrl = String(process.env.RPC_URL || process.env.ALCHEMY_URL || "").trim();
const loanEngineAddress = String(process.env.LOAN_ENGINE_ADDRESS || process.env.NEXT_PUBLIC_LOAN_ENGINE_ADDRESS || "").trim();
const revenueDistributorAddress = String(process.env.REVENUE_DISTRIBUTOR_ADDRESS || process.env.NEXT_PUBLIC_REVENUE_ROUTER_ADDRESS || "").trim();
const vaultAddress = String(process.env.VAULT_ADDRESS || process.env.NEXT_PUBLIC_VAULT_ADDRESS || "").trim();
const adminPrivateKey = String(process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY || "").trim();
const oracleWebhookUrl = String(process.env.ORACLE_UPDATE_WEBHOOK_URL || "").trim();
const revenueWebhookUrl = String(process.env.REVENUE_DISTRIBUTION_WEBHOOK_URL || "").trim();

const loanEngineAbi = [
  "function forceExitPanic(uint256 tokenId) external returns (bool)",
  "function exitPanicMode(uint256 tokenId) external returns (bool)",
  "function setPanicThresholdBps(uint256 newThresholdBps) external",
  "function setRevenueDistributor(address newDistributor) external",
];

const adminCallInterface = new Interface(loanEngineAbi);
let provider = null;
let signer = null;
let loanEngineContract = null;

if (rpcUrl) {
  provider = new JsonRpcProvider(rpcUrl);
  if (adminPrivateKey) {
    signer = new Wallet(adminPrivateKey, provider);
    if (loanEngineAddress && isAddress(loanEngineAddress)) {
      loanEngineContract = new Contract(getAddress(loanEngineAddress), loanEngineAbi, signer);
    }
  }
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.length === 0 || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS origin blocked"));
    },
    credentials: true,
  })
);
app.use(generalLimiter);

// Health check endpoint
app.get("/health", (request, response) => {
  response.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.use(createAuthRouter());
app.use(createRoutes({ prisma, requireAdminJwt }));

const socketServer = createRealtimeSocketServer({
  httpServer: server,
  prisma,
  corsOrigins,
  rpcUrl,
  loanEngineAddress,
  vaultAddress,
});

function jsonError(response, status, message, extra = {}) {
  return response.status(status).json({ error: message, ...extra });
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "bigint") return Number(value);
  if (typeof value.toString === "function") {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringValue(value, fallback = "0") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value.toString === "function") return value.toString();
  return fallback;
}

function toDecimalNumber(value, fallback = 0) {
  return toNumber(value, fallback);
}

function parseIdList(input) {
  if (!input) return [];
  return String(input)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));
}

function parseEnumValue(value, allowedValues, fallback) {
  if (!value) return fallback;
  const candidate = String(value).trim().toUpperCase();
  return allowedValues.includes(candidate) ? candidate : fallback;
}

function isAdminWallet(address) {
  if (!address) return false;
  return adminWalletAllowlist.includes(address.trim().toLowerCase());
}

async function authenticateAdmin(request, response, next) {
  try {
    const authorization = String(request.headers.authorization || "");
    const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    const walletAddress = String(request.headers["x-wallet-address"] || request.body?.walletAddress || "").trim();
    const walletMessage = String(request.headers["x-wallet-message"] || request.body?.walletMessage || "").trim();
    const walletSignature = String(request.headers["x-wallet-signature"] || request.body?.walletSignature || "").trim();

    if (!bearerToken) {
      return jsonError(response, 401, "Missing bearer token");
    }

    if (!jwtSecret) {
      return jsonError(response, 500, "JWT secret is not configured");
    }

    let jwtPayload;
    try {
      jwtPayload = jwt.verify(bearerToken, jwtSecret);
    } catch {
      return jsonError(response, 401, "Invalid bearer token");
    }

    if (!walletAddress || !walletSignature || !walletMessage) {
      return jsonError(response, 401, "Missing wallet signature headers");
    }

    const recovered = verifyMessage(walletMessage, walletSignature);
    if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
      return jsonError(response, 401, "Wallet signature verification failed");
    }

    if (jwtPayload?.walletAddress && jwtPayload.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return jsonError(response, 403, "JWT wallet does not match signed wallet");
    }

    if (jwtPayload?.role && !["ADMIN", "RISK_MANAGER", "TREASURY_MANAGER"].includes(String(jwtPayload.role).toUpperCase())) {
      return jsonError(response, 403, "Insufficient role permissions");
    }

    if (adminWalletAllowlist.length > 0 && !isAdminWallet(walletAddress)) {
      return jsonError(response, 403, "Wallet is not in the admin allowlist");
    }

    request.admin = {
      walletAddress,
      jwtPayload,
    };

    return next();
  } catch (error) {
    return jsonError(response, 500, error.message || "Admin authentication failed");
  }
}

function serializeLoan(loan, extra = {}) {
  return {
    id: loan.id,
    borrowerId: loan.borrowerId,
    lenderId: loan.lenderId,
    vaultId: loan.vaultId,
    tokenId: toStringValue(loan.tokenId),
    amountBorrowed: toStringValue(loan.amountBorrowed),
    debtTokenAmount: toStringValue(loan.debtTokenAmount),
    interestRate: toDecimalNumber(loan.interestRate),
    ltvAtIssuance: toDecimalNumber(loan.ltvAtIssuance),
    healthFactor: toDecimalNumber(loan.healthFactor),
    status: loan.status,
    createdAt: loan.createdAt,
    repaidAt: loan.repaidAt,
    ...extra,
  };
}

function serializePanicEvent(event) {
  return {
    id: event.id,
    tokenId: toStringValue(event.tokenId),
    loanId: event.loanId,
    triggerLtv: toDecimalNumber(event.triggerLtv),
    panicThreshold: toDecimalNumber(event.panicThreshold),
    enteredAt: event.enteredAt,
    exitedAt: event.exitedAt,
    exitReason: event.exitReason,
    loan: event.loan ? serializeLoan(event.loan) : undefined,
  };
}

function serializeRevenueFlow(flow) {
  return {
    id: flow.id,
    tokenId: toStringValue(flow.tokenId),
    loanId: flow.loanId,
    amount: toStringValue(flow.amount),
    source: flow.source,
    distributionType: flow.distributionType,
    distributedAt: flow.distributedAt,
  };
}

function serializeSnapshot(snapshot) {
  return {
    id: snapshot.id,
    collectionAddress: snapshot.collectionAddress,
    floorPrice: toStringValue(snapshot.floorPrice),
    rarityScore: toDecimalNumber(snapshot.rarityScore),
    utilityScore: toDecimalNumber(snapshot.utilityScore),
    valuationPrimary: toStringValue(snapshot.valuationPrimary),
    valuationSecondary: toStringValue(snapshot.valuationSecondary),
    timestamp: snapshot.timestamp,
  };
}

function serializeUser(user) {
  return {
    id: user.id,
    walletAddress: user.walletAddress,
    email: user.email,
    roles: user.roles,
    notificationPreferences: user.notificationPreferences,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    counts: user._count || undefined,
  };
}

function computeRiskScore(ltv, panicThreshold, healthFactor, volatility = 0) {
  const ltvComponent = Math.min(100, Math.max(0, (ltv / Math.max(1, panicThreshold)) * 70));
  const healthComponent = Math.min(20, Math.max(0, 20 - Math.min(20, healthFactor * 2)));
  const volatilityComponent = Math.min(10, Math.max(0, volatility / 10));
  return Number((ltvComponent + healthComponent + volatilityComponent).toFixed(2));
}

async function getLatestOracleSnapshot(collectionAddress) {
  const where = collectionAddress ? { collectionAddress: collectionAddress.toLowerCase() } : undefined;
  const snapshot = await prisma.oracleSnapshot.findFirst({
    where,
    orderBy: { timestamp: "desc" },
  });
  return snapshot ? serializeSnapshot(snapshot) : null;
}

async function getLatestLoanByToken(tokenId) {
  return prisma.loan.findFirst({
    where: { tokenId: BigInt(tokenId) },
    orderBy: { createdAt: "desc" },
    include: {
      borrower: true,
      lender: true,
    },
  });
}

async function getActivePanicEvent(tokenId) {
  return prisma.panicEvent.findFirst({
    where: { tokenId: BigInt(tokenId), exitedAt: null },
    orderBy: { enteredAt: "desc" },
    include: { loan: { include: { borrower: true, lender: true } } },
  });
}

async function buildRealtimeSnapshot() {
  const [activePanicCount, riskyLoanCount, latestOracle] = await Promise.all([
    prisma.panicEvent.count({ where: { exitedAt: null } }),
    prisma.loan.count({ where: { status: { in: ["ACTIVE", "PANIC"] } } }),
    prisma.oracleSnapshot.findFirst({ orderBy: { timestamp: "desc" } }),
  ]);

  const activePanic = await prisma.panicEvent.findMany({
    where: { exitedAt: null },
    orderBy: { enteredAt: "desc" },
    take: 20,
    include: { loan: { include: { borrower: true } } },
  });

  return {
    type: "realtime-snapshot",
    timestamp: new Date().toISOString(),
    summary: {
      activePanicCount,
      riskyLoanCount,
    },
    oracle: latestOracle ? serializeSnapshot(latestOracle) : null,
    activePanic: activePanic.map(serializePanicEvent),
  };
}

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wsServer.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

async function broadcastRealtimeUpdate() {
  try {
    const payload = await buildRealtimeSnapshot();
    broadcast(payload);
  } catch (error) {
    console.error("Realtime broadcast failed:", error);
  }
}

async function forwardToWebhook(url, body) {
  if (!url) return null;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Webhook request failed with status ${response.status}`);
  }
  return payload;
}

app.get("/health", async (_request, response) => {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return response.json({
      status: "ok",
      db: "connected",
      websocketClients: wsServer.clients.size,
      hasSigner: Boolean(signer),
    });
  } catch (error) {
    return response.status(503).json({
      status: "degraded",
      db: "unavailable",
      error: error.message,
    });
  }
});

app.get("/oracle/latest", async (request, response) => {
  const collectionAddress = String(request.query.collectionAddress || "").trim();
  const snapshot = await getLatestOracleSnapshot(collectionAddress);
  if (!snapshot) {
    return response.json({ status: "empty", snapshot: null });
  }
  return response.json({ status: "ok", snapshot });
});

app.get("/oracle/history/:collection", async (request, response) => {
  const collectionAddress = String(request.params.collection || "").trim().toLowerCase();
  const limit = Math.min(Number(request.query.limit || 100), 500);
  const offset = Math.max(Number(request.query.offset || 0), 0);

  const snapshots = await prisma.oracleSnapshot.findMany({
    where: { collectionAddress },
    orderBy: { timestamp: "asc" },
    take: limit,
    skip: offset,
  });

  return response.json({
    status: "ok",
    collectionAddress,
    items: snapshots.map(serializeSnapshot),
  });
});

app.post("/oracle/update", adminLimiter, authenticateAdmin, async (request, response) => {
  try {
    const collectionAddress = String(request.body.collectionAddress || request.body.collection || "").trim().toLowerCase();
    const floorPrice = toNumber(request.body.floorPrice, NaN);
    const rarityScore = toDecimalNumber(request.body.rarityScore, 0);
    const utilityScore = toDecimalNumber(request.body.utilityScore, 0);
    const valuationPrimary = toNumber(request.body.valuationPrimary, NaN);
    const valuationSecondary = toNumber(request.body.valuationSecondary, NaN);

    if (oracleWebhookUrl) {
      const forwarded = await forwardToWebhook(oracleWebhookUrl, {
        ...request.body,
        admin: request.admin,
      });
      return response.json({ status: "queued", forwarded });
    }

    if (!collectionAddress || !Number.isFinite(floorPrice) || !Number.isFinite(valuationPrimary) || !Number.isFinite(valuationSecondary)) {
      return jsonError(response, 400, "collectionAddress, floorPrice, valuationPrimary, and valuationSecondary are required when no webhook is configured");
    }

    const snapshot = await prisma.oracleSnapshot.create({
      data: {
        collectionAddress,
        floorPrice: new Prisma.Decimal(floorPrice),
        rarityScore: new Prisma.Decimal(rarityScore),
        utilityScore: new Prisma.Decimal(utilityScore),
        valuationPrimary: new Prisma.Decimal(valuationPrimary),
        valuationSecondary: new Prisma.Decimal(valuationSecondary),
      },
    });

    await socketServer.emitOracleUpdate(snapshot);

    await broadcastRealtimeUpdate();

    return response.json({ status: "ok", snapshot: serializeSnapshot(snapshot) });
  } catch (error) {
    return jsonError(response, 500, error.message || "Oracle update failed");
  }
});

app.get("/ltv/:tokenId", async (request, response) => {
  try {
    const tokenId = Number(request.params.tokenId);
    if (!Number.isFinite(tokenId)) {
      return jsonError(response, 400, "Invalid tokenId");
    }

    const loan = await getLatestLoanByToken(tokenId);
    if (!loan) {
      return jsonError(response, 404, "Loan not found for token");
    }

    const activePanic = await getActivePanicEvent(tokenId);
    const currentLtv = toDecimalNumber(loan.ltvAtIssuance, 0);
    const panicThreshold = toNumber(activePanic?.panicThreshold, 85);
    const healthFactor = toDecimalNumber(loan.healthFactor, 0);

    return response.json({
      status: "ok",
      tokenId: tokenId.toString(),
      currentLtv,
      healthFactor,
      panicStatus: Boolean(activePanic || loan.status === "PANIC"),
      panicThreshold,
      debtAmount: toStringValue(loan.debtTokenAmount),
      borrowerId: loan.borrowerId,
      vaultId: loan.vaultId,
      loan: serializeLoan(loan),
      activePanic: activePanic ? serializePanicEvent(activePanic) : null,
    });
  } catch (error) {
    return jsonError(response, 500, error.message || "Failed to load LTV");
  }
});

app.get("/ltv/batch", async (request, response) => {
  const tokenIds = parseIdList(request.query.tokenIds || request.query.tokenId);
  if (tokenIds.length === 0) {
    return jsonError(response, 400, "tokenIds query parameter is required");
  }

  const loans = await prisma.loan.findMany({
    where: { tokenId: { in: tokenIds.map((id) => BigInt(id)) } },
    orderBy: { createdAt: "desc" },
  });

  const activePanicEvents = await prisma.panicEvent.findMany({
    where: { tokenId: { in: tokenIds.map((id) => BigInt(id)) }, exitedAt: null },
    orderBy: { enteredAt: "desc" },
  });

  const panicByToken = new Map(activePanicEvents.map((event) => [event.tokenId.toString(), event]));

  return response.json({
    status: "ok",
    items: tokenIds.map((tokenId) => {
      const loan = loans.find((entry) => entry.tokenId.toString() === String(tokenId));
      const panic = panicByToken.get(String(tokenId));
      if (!loan) {
        return { tokenId: String(tokenId), found: false };
      }
      return {
        tokenId: String(tokenId),
        found: true,
        currentLtv: toDecimalNumber(loan.ltvAtIssuance, 0),
        healthFactor: toDecimalNumber(loan.healthFactor, 0),
        panicStatus: Boolean(panic || loan.status === "PANIC"),
        panicThreshold: toDecimalNumber(panic?.panicThreshold || loan.healthFactor, 85),
        debtAmount: toStringValue(loan.debtTokenAmount),
        loan: serializeLoan(loan),
      };
    }),
  });
});

app.get("/risk/:tokenId", async (request, response) => {
  try {
    const tokenId = Number(request.params.tokenId);
    if (!Number.isFinite(tokenId)) {
      return jsonError(response, 400, "Invalid tokenId");
    }

    const loan = await getLatestLoanByToken(tokenId);
    if (!loan) {
      return jsonError(response, 404, "Loan not found for token");
    }

    const activePanic = await getActivePanicEvent(tokenId);
    const latestSnapshot = await prisma.oracleSnapshot.findFirst({ orderBy: { timestamp: "desc" } });
    const volatility = toDecimalNumber(latestSnapshot?.rarityScore, 0) + toDecimalNumber(latestSnapshot?.utilityScore, 0);
    const currentLtv = toDecimalNumber(loan.ltvAtIssuance, 0);
    const panicThreshold = toDecimalNumber(activePanic?.panicThreshold, 85);
    const healthFactor = toDecimalNumber(loan.healthFactor, 0);
    const riskScore = computeRiskScore(currentLtv, panicThreshold, healthFactor, volatility);

    return response.json({
      status: "ok",
      tokenId: tokenId.toString(),
      riskScore,
      volatility,
      panicThreshold,
      currentLtv,
      panicStatus: Boolean(activePanic || loan.status === "PANIC"),
      loanStatus: loan.status,
      activePanic: activePanic ? serializePanicEvent(activePanic) : null,
      loan: serializeLoan(loan),
    });
  } catch (error) {
    return jsonError(response, 500, error.message || "Failed to load risk");
  }
});

app.get("/risk/overview", async (_request, response) => {
  const loans = await prisma.loan.findMany({
    where: { status: { in: ["ACTIVE", "PANIC"] } },
    orderBy: [{ healthFactor: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  const activePanicEvents = await prisma.panicEvent.findMany({
    where: { exitedAt: null },
    orderBy: { enteredAt: "desc" },
  });
  const panicTokens = new Set(activePanicEvents.map((event) => event.tokenId.toString()));

  const riskyPositions = loans.map((loan) => {
    const ltv = toDecimalNumber(loan.ltvAtIssuance, 0);
    const healthFactor = toDecimalNumber(loan.healthFactor, 0);
    const panicThreshold = panicTokens.has(loan.tokenId.toString()) ? 85 : 90;
    const riskScore = computeRiskScore(ltv, panicThreshold, healthFactor);
    return {
      tokenId: loan.tokenId.toString(),
      vaultId: loan.vaultId,
      status: loan.status,
      ltv,
      healthFactor,
      riskScore,
      panicStatus: panicTokens.has(loan.tokenId.toString()) || loan.status === "PANIC",
    };
  });

  return response.json({
    status: "ok",
    counts: {
      totalPositions: loans.length,
      panicPositions: activePanicEvents.length,
      riskyPositions: riskyPositions.filter((entry) => entry.riskScore >= 70).length,
    },
    riskyPositions,
  });
});

app.get("/panic/active", async (_request, response) => {
  const panicEvents = await prisma.panicEvent.findMany({
    where: { exitedAt: null },
    orderBy: { enteredAt: "desc" },
    include: { loan: { include: { borrower: true, lender: true } } },
  });

  return response.json({
    status: "ok",
    items: panicEvents.map(serializePanicEvent),
  });
});

app.get("/panic/history", async (request, response) => {
  const tokenIdValue = request.query.tokenId;
  if (tokenIdValue !== undefined && tokenIdValue !== null && String(tokenIdValue).trim() !== "" && !/^\d+$/.test(String(tokenIdValue).trim())) {
    return jsonError(response, 400, "Invalid tokenId");
  }
  const tokenId = tokenIdValue !== undefined && tokenIdValue !== null && String(tokenIdValue).trim() !== "" ? BigInt(String(tokenIdValue).trim()) : undefined;
  const limit = Math.min(Number(request.query.limit || 100), 500);
  const offset = Math.max(Number(request.query.offset || 0), 0);

  const where = tokenId ? { tokenId } : undefined;
  const panicEvents = await prisma.panicEvent.findMany({
    where,
    orderBy: { enteredAt: "desc" },
    take: limit,
    skip: offset,
    include: { loan: { include: { borrower: true, lender: true } } },
  });

  return response.json({
    status: "ok",
    items: panicEvents.map(serializePanicEvent),
  });
});

app.post("/panic/exit/:tokenId", adminLimiter, authenticateAdmin, async (request, response) => {
  try {
    const tokenId = Number(request.params.tokenId);
    if (!Number.isFinite(tokenId)) {
      return jsonError(response, 400, "Invalid tokenId");
    }

    const exitReason = parseEnumValue(request.body.exitReason, ["AUTO_RECOVERY", "MANUAL", "LIQUIDATION"], "MANUAL");
    const reason = String(request.body.reason || "manual exit").trim();
    const activeEvent = await getActivePanicEvent(tokenId);

    if (!activeEvent) {
      return jsonError(response, 404, "No active panic event found for token");
    }

    let onChainTxHash = null;
    if (loanEngineContract) {
      try {
        const tx = await loanEngineContract.forceExitPanic(BigInt(tokenId));
        const receipt = await tx.wait();
        onChainTxHash = receipt?.hash || tx.hash || null;
      } catch (error) {
        if (!String(error.message || "").toLowerCase().includes("forceexitpanic")) {
          throw error;
        }
      }
    }

    const updatedEvent = await prisma.panicEvent.update({
      where: { id: activeEvent.id },
      data: {
        exitedAt: new Date(),
        exitReason,
      },
      include: { loan: { include: { borrower: true, lender: true } } },
    });

    await prisma.multisigProposal.create({
      data: {
        proposerId: request.admin?.jwtPayload?.userId ? String(request.admin.jwtPayload.userId) : (await ensureAdminUser(request.admin?.walletAddress)).id,
        destination: loanEngineAddress || revenueDistributorAddress || "0x0000000000000000000000000000000000000000",
        calldata: JSON.stringify({
          action: "force_exit_panic",
          tokenId,
          exitReason,
          reason,
          onChainTxHash,
        }),
        description: `Force exit panic for token ${tokenId}`,
        confirmations: 1,
        executed: Boolean(onChainTxHash),
      },
    });

    await broadcastRealtimeUpdate();

    return response.json({
      status: "ok",
      updatedEvent: serializePanicEvent(updatedEvent),
      onChainTxHash,
    });
  } catch (error) {
    return jsonError(response, 500, error.message || "Failed to exit panic mode");
  }
});

app.get("/revenue/total", async (_request, response) => {
  const aggregate = await prisma.revenueFlow.aggregate({
    _sum: { amount: true },
    _count: { _all: true },
  });

  return response.json({
    status: "ok",
    totalRevenue: toStringValue(aggregate._sum.amount, "0"),
    revenueEvents: aggregate._count._all,
  });
});

app.get("/revenue/:tokenId", async (request, response) => {
  const tokenId = Number(request.params.tokenId);
  if (!Number.isFinite(tokenId)) {
    return jsonError(response, 400, "Invalid tokenId");
  }

  const flows = await prisma.revenueFlow.findMany({
    where: { tokenId: BigInt(tokenId) },
    orderBy: { distributedAt: "desc" },
  });

  const bySource = {};
  const byDistribution = {};
  let total = new Prisma.Decimal(0);

  for (const flow of flows) {
    total = total.add(flow.amount);
    bySource[flow.source] = (bySource[flow.source] || new Prisma.Decimal(0)).add(flow.amount);
    byDistribution[flow.distributionType] = (byDistribution[flow.distributionType] || new Prisma.Decimal(0)).add(flow.amount);
  }

  return response.json({
    status: "ok",
    tokenId: String(tokenId),
    totalAmount: total.toString(),
    bySource: Object.fromEntries(Object.entries(bySource).map(([key, value]) => [key, value.toString()])),
    byDistributionType: Object.fromEntries(Object.entries(byDistribution).map(([key, value]) => [key, value.toString()])),
    items: flows.map(serializeRevenueFlow),
  });
});

app.post("/revenue/distribute", adminLimiter, authenticateAdmin, async (request, response) => {
  try {
    const tokenId = Number(request.body.tokenId);
    const amount = toNumber(request.body.amount, NaN);
    const source = parseEnumValue(request.body.source, ["LICENSE", "MARKETPLACE", "OTHER"], "OTHER");
    const distributionType = parseEnumValue(request.body.distributionType, ["DEBT_REPAYMENT", "RESERVE", "SURPLUS"], "DEBT_REPAYMENT");

    if (!Number.isFinite(tokenId) || !Number.isFinite(amount)) {
      return jsonError(response, 400, "tokenId and amount are required");
    }

    if (revenueWebhookUrl) {
      const forwarded = await forwardToWebhook(revenueWebhookUrl, {
        ...request.body,
        admin: request.admin,
      });
      return response.json({ status: "queued", forwarded });
    }

    const created = await prisma.revenueFlow.create({
      data: {
        tokenId: BigInt(tokenId),
        loanId: request.body.loanId ? String(request.body.loanId) : null,
        amount: new Prisma.Decimal(amount),
        source,
        distributionType,
      },
    });

    await broadcastRealtimeUpdate();

    return response.json({ status: "ok", flow: serializeRevenueFlow(created) });
  } catch (error) {
    return jsonError(response, 500, error.message || "Revenue distribution failed");
  }
});

app.get("/admin/users", authenticateAdmin, async (_request, response) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          deposits: true,
          borrowedLoans: true,
          lentLoans: true,
          proposals: true,
        },
      },
    },
  });

  return response.json({
    status: "ok",
    items: users.map(serializeUser),
  });
});

app.get("/admin/stats", authenticateAdmin, async (_request, response) => {
  const [userCount, depositCount, loanCount, panicCount, activePanicCount, revenueAggregate, proposalCount, latestSnapshot] = await Promise.all([
    prisma.user.count(),
    prisma.deposit.count(),
    prisma.loan.count(),
    prisma.panicEvent.count(),
    prisma.panicEvent.count({ where: { exitedAt: null } }),
    prisma.revenueFlow.aggregate({ _sum: { amount: true } }),
    prisma.multisigProposal.count(),
    prisma.oracleSnapshot.findFirst({ orderBy: { timestamp: "desc" } }),
  ]);

  return response.json({
    status: "ok",
    stats: {
      userCount,
      depositCount,
      loanCount,
      panicCount,
      activePanicCount,
      proposalCount,
      totalRevenue: toStringValue(revenueAggregate._sum.amount, "0"),
      latestOracleSnapshot: latestSnapshot ? serializeSnapshot(latestSnapshot) : null,
      websocketClients: wsServer.clients.size,
    },
  });
});

app.post("/admin/pause", adminLimiter, authenticateAdmin, async (request, response) => {
  try {
    const destination = String(request.body.destination || loanEngineAddress || revenueDistributorAddress || "0x0000000000000000000000000000000000000000").trim();
    const description = String(request.body.description || "Emergency pause requested").trim();
    const calldata = String(request.body.calldata || adminCallInterface.encodeFunctionData("setPanicThresholdBps", [BigInt(request.body.panicThresholdBps || 8500)])).trim();

    const proposal = await prisma.multisigProposal.create({
      data: {
        proposerId: request.admin?.jwtPayload?.userId ? String(request.admin.jwtPayload.userId) : (await ensureAdminUser(request.admin?.walletAddress)).id,
        destination,
        calldata: JSON.stringify({ action: "pause", calldata, description }),
        description,
        confirmations: 1,
        executed: false,
      },
    });

    return response.json({ status: "ok", proposal: proposal });
  } catch (error) {
    return jsonError(response, 500, error.message || "Pause proposal failed");
  }
});

app.post("/admin/update-params", adminLimiter, authenticateAdmin, async (request, response) => {
  try {
    const destination = String(request.body.destination || loanEngineAddress || revenueDistributorAddress || "0x0000000000000000000000000000000000000000").trim();
    const description = String(request.body.description || "Protocol parameter update").trim();
    const calls = [];

    if (request.body.panicThresholdBps !== undefined) {
      calls.push({
        target: loanEngineAddress,
        calldata: adminCallInterface.encodeFunctionData("setPanicThresholdBps", [BigInt(request.body.panicThresholdBps)]),
      });
    }

    if (request.body.revenueDistributor) {
      calls.push({
        target: loanEngineAddress,
        calldata: adminCallInterface.encodeFunctionData("setRevenueDistributor", [String(request.body.revenueDistributor)]),
      });
    }

    if (request.body.autoPanicEnabled !== undefined) {
      calls.push({
        target: loanEngineAddress,
        calldata: JSON.stringify({ action: "setAutoPanicEnabled", value: Boolean(request.body.autoPanicEnabled) }),
      });
    }

    if (request.body.recoveryLtvBps !== undefined) {
      calls.push({
        target: loanEngineAddress,
        calldata: JSON.stringify({ action: "setRecoveryLtvBps", value: Number(request.body.recoveryLtvBps) }),
      });
    }

    if (calls.length === 0) {
      return jsonError(response, 400, "At least one parameter must be provided");
    }

    const proposal = await prisma.multisigProposal.create({
      data: {
        proposerId: request.admin?.jwtPayload?.userId ? String(request.admin.jwtPayload.userId) : (await ensureAdminUser(request.admin?.walletAddress)).id,
        destination,
        calldata: JSON.stringify({ description, calls, requestedBy: request.admin.walletAddress }),
        description,
        confirmations: 1,
        executed: false,
      },
    });

    return response.json({ status: "ok", proposal });
  } catch (error) {
    return jsonError(response, 500, error.message || "Parameter update proposal failed");
  }
});

async function ensureAdminUser(walletAddress) {
  const normalized = String(walletAddress || "").trim().toLowerCase();
  if (!normalized) {
    throw new Error("Admin wallet address is required");
  }

  const existing = await prisma.user.findUnique({
    where: { walletAddress: normalized },
  });

  if (existing) {
    return existing;
  }

  return prisma.user.create({
    data: {
      walletAddress: normalized,
      roles: "ADMIN",
      notificationPreferences: {},
    },
  });
}

app.use((error, _request, response, _next) => {
  console.error(error);
  const status = error.status || 500;
  response.status(status).json({
    error: error.message || "Internal server error",
  });
});

wsServer.on("connection", async (socket) => {
  try {
    socket.send(JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }));
    socket.send(JSON.stringify(await buildRealtimeSnapshot()));
  } catch (error) {
    socket.send(JSON.stringify({ type: "error", error: error.message || "Failed to load realtime snapshot" }));
  }

  socket.on("message", async (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());
      if (message?.type === "subscribe") {
        socket.send(JSON.stringify({ type: "subscribed", topics: message.topics || [] }));
      }
      if (message?.type === "refresh") {
        socket.send(JSON.stringify(await buildRealtimeSnapshot()));
      }
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", error: error.message || "Invalid message" }));
    }
  });
});

setInterval(() => {
  broadcastRealtimeUpdate().catch((error) => console.error(error));
}, Number(process.env.REALTIME_POLL_INTERVAL_MS || 15_000));

const port = Number(process.env.PORT || 8000);

server.listen(port, () => {
  console.log(`Express backend listening on http://0.0.0.0:${port}`);
});
