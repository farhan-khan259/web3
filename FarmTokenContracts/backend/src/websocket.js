const { Server } = require("socket.io");
const { Contract, JsonRpcProvider, getAddress, isAddress } = require("ethers");

const loanEngineEventAbi = [
  "event PanicModeEntered(uint256 indexed tokenId, uint256 currentLTV, uint256 panicThreshold)",
  "event PanicModeExited(uint256 indexed tokenId, uint256 currentLTV, uint256 recoveryThreshold)",
  "event Liquidated(uint256 indexed rightsId, uint256 debtCleared, uint256 ltvBps)",
  "event LoanRepaid(uint256 indexed tokenId, address indexed payer, uint256 amount, uint256 debtAfter)",
  "function getCurrentLTV(uint256 rightsId) external view returns (uint256)",
] ;

const vaultAbi = [
  "function lockedBy(uint256 rightsId) external view returns (address)",
  "function getSnapshotValue(uint256 rightsId) external view returns (uint256)",
];

const loanStateAbi = [
  "function outstandingDebt(uint256 rightsId) external view returns (uint256)",
];

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAddress(value) {
  const maybe = String(value || "").trim();
  if (!maybe || !isAddress(maybe)) return "";
  return getAddress(maybe);
}

function toWalletRoom(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return "";
  return `wallet-${normalized.toLowerCase()}`;
}

async function fetchHealthFactorFromPrisma(prisma, tokenId) {
  if (!prisma) return null;

  try {
    const loan = await prisma.loan.findFirst({
      where: { tokenId: BigInt(tokenId) },
      orderBy: { createdAt: "desc" },
      select: { healthFactor: true },
    });

    return loan ? toNumber(loan.healthFactor, null) : null;
  } catch {
    return null;
  }
}

async function buildLtvPayload({ tokenId, loanContract, vaultContract, loanStateContract, prisma }) {
  const id = BigInt(tokenId);

  const [ltvBpsRaw, debtRaw, snapshotRaw, owner, healthFactor] = await Promise.all([
    loanContract.getCurrentLTV(id).catch(() => null),
    loanStateContract.outstandingDebt(id).catch(() => null),
    vaultContract.getSnapshotValue(id).catch(() => null),
    vaultContract.lockedBy(id).catch(() => null),
    fetchHealthFactorFromPrisma(prisma, tokenId),
  ]);

  return {
    tokenId: Number(tokenId),
    ltvBps: ltvBpsRaw !== null ? toNumber(ltvBpsRaw, 0) : null,
    ltvPct: ltvBpsRaw !== null ? toNumber(ltvBpsRaw, 0) / 100 : null,
    debtWei: debtRaw !== null ? String(debtRaw) : null,
    snapshotValueWei: snapshotRaw !== null ? String(snapshotRaw) : null,
    healthFactor,
    walletAddress: normalizeAddress(owner),
    at: new Date().toISOString(),
  };
}

function createRealtimeSocketServer({
  httpServer,
  prisma = null,
  corsOrigins = [],
  rpcUrl = process.env.RPC_URL || process.env.ALCHEMY_URL || "",
  loanEngineAddress = process.env.LOAN_ENGINE_ADDRESS || process.env.NEXT_PUBLIC_LOAN_ENGINE_ADDRESS || "",
  vaultAddress = process.env.VAULT_ADDRESS || process.env.NEXT_PUBLIC_VAULT_ADDRESS || "",
  path = "/socket.io",
}) {
  const io = new Server(httpServer, {
    path,
    cors: {
      origin: corsOrigins.length > 0 ? corsOrigins : true,
      credentials: true,
    },
  });

  let provider = null;
  let loanContract = null;
  let vaultContract = null;
  let loanStateContract = null;
  let oraclePollTimer = null;
  let lastOracleSnapshotId = null;

  if (rpcUrl && isAddress(loanEngineAddress) && isAddress(vaultAddress)) {
    provider = new JsonRpcProvider(rpcUrl);
    loanContract = new Contract(getAddress(loanEngineAddress), loanEngineEventAbi, provider);
    loanStateContract = new Contract(getAddress(loanEngineAddress), loanStateAbi, provider);
    vaultContract = new Contract(getAddress(vaultAddress), vaultAbi, provider);
  }

  io.on("connection", (socket) => {
    socket.emit("connected", {
      socketId: socket.id,
      at: new Date().toISOString(),
      info: "Use subscribe-ltv with tokenId to join ltv-${tokenId} room",
    });

    socket.on("subscribe-ltv", (payload) => {
      const tokenId = toNumber(payload?.tokenId, NaN);
      if (!Number.isFinite(tokenId) || tokenId <= 0) {
        socket.emit("subscription-error", { reason: "tokenId must be a positive number" });
        return;
      }

      const room = `ltv-${tokenId}`;
      socket.join(room);
      socket.emit("subscribed", { room, tokenId });
    });

    socket.on("unsubscribe-ltv", (payload) => {
      const tokenId = toNumber(payload?.tokenId, NaN);
      if (!Number.isFinite(tokenId) || tokenId <= 0) return;
      const room = `ltv-${tokenId}`;
      socket.leave(room);
      socket.emit("unsubscribed", { room, tokenId });
    });

    socket.on("subscribe-wallet", (payload) => {
      const room = toWalletRoom(payload?.walletAddress);
      if (!room) {
        socket.emit("subscription-error", { reason: "invalid walletAddress" });
        return;
      }
      socket.join(room);
      socket.emit("subscribed", { room });
    });
  });

  async function emitLtvUpdate({ tokenId, triggerEvent, txHash = null, rawEvent = null }) {
    if (!loanContract || !vaultContract || !loanStateContract) return;

    const payload = await buildLtvPayload({
      tokenId,
      loanContract,
      vaultContract,
      loanStateContract,
      prisma,
    });

    const envelope = {
      event: "ltv-update",
      triggerEvent,
      txHash,
      rawEvent,
      payload,
    };

    io.emit("ltv-update", envelope);
    io.to(`ltv-${payload.tokenId}`).emit("ltv-update", envelope);

    const walletRoom = toWalletRoom(payload.walletAddress);
    if (walletRoom) {
      io.to(walletRoom).emit("ltv-update", envelope);
    }
  }

  async function emitOracleUpdate(snapshot) {
    const payload = {
      event: "oracle-update",
      id: snapshot?.id || null,
      collectionAddress: snapshot?.collectionAddress || null,
      floorPrice: snapshot?.floorPrice?.toString ? snapshot.floorPrice.toString() : String(snapshot?.floorPrice || ""),
      rarityScore: snapshot?.rarityScore?.toString ? snapshot.rarityScore.toString() : String(snapshot?.rarityScore || ""),
      utilityScore: snapshot?.utilityScore?.toString ? snapshot.utilityScore.toString() : String(snapshot?.utilityScore || ""),
      valuationPrimary: snapshot?.valuationPrimary?.toString ? snapshot.valuationPrimary.toString() : String(snapshot?.valuationPrimary || ""),
      valuationSecondary: snapshot?.valuationSecondary?.toString ? snapshot.valuationSecondary.toString() : String(snapshot?.valuationSecondary || ""),
      timestamp: snapshot?.timestamp || new Date().toISOString(),
    };

    io.emit("oracle-update", payload);
  }

  function startOracleSnapshotPolling() {
    if (!prisma) return;

    oraclePollTimer = setInterval(async () => {
      try {
        const latest = await prisma.oracleSnapshot.findFirst({
          orderBy: { timestamp: "desc" },
        });

        if (!latest) return;
        if (latest.id === lastOracleSnapshotId) return;

        lastOracleSnapshotId = latest.id;
        await emitOracleUpdate(latest);
      } catch {
        // Keep polling even if transient DB issues occur.
      }
    }, Number(process.env.ORACLE_SNAPSHOT_POLL_MS || 2_000));
  }

  function bindLoanEventListeners() {
    if (!loanContract) return;

    loanContract.on("PanicModeEntered", async (tokenId, currentLTV, panicThreshold, event) => {
      await emitLtvUpdate({
        tokenId: Number(tokenId),
        triggerEvent: "PanicModeEntered",
        txHash: event?.log?.transactionHash || null,
        rawEvent: { currentLTV: String(currentLTV), panicThreshold: String(panicThreshold) },
      });
    });

    loanContract.on("PanicModeExited", async (tokenId, currentLTV, recoveryThreshold, event) => {
      await emitLtvUpdate({
        tokenId: Number(tokenId),
        triggerEvent: "PanicModeExited",
        txHash: event?.log?.transactionHash || null,
        rawEvent: { currentLTV: String(currentLTV), recoveryThreshold: String(recoveryThreshold) },
      });
    });

    loanContract.on("Liquidated", async (rightsId, debtCleared, ltvBps, event) => {
      await emitLtvUpdate({
        tokenId: Number(rightsId),
        triggerEvent: "Liquidated",
        txHash: event?.log?.transactionHash || null,
        rawEvent: { debtCleared: String(debtCleared), ltvBps: String(ltvBps) },
      });
    });

    loanContract.on("LoanRepaid", async (tokenId, payer, amount, debtAfter, event) => {
      await emitLtvUpdate({
        tokenId: Number(tokenId),
        triggerEvent: "LoanRepaid",
        txHash: event?.log?.transactionHash || null,
        rawEvent: { payer: String(payer), amount: String(amount), debtAfter: String(debtAfter) },
      });
    });
  }

  function stop() {
    if (oraclePollTimer) {
      clearInterval(oraclePollTimer);
      oraclePollTimer = null;
    }

    if (loanContract) {
      loanContract.removeAllListeners("PanicModeEntered");
      loanContract.removeAllListeners("PanicModeExited");
      loanContract.removeAllListeners("Liquidated");
      loanContract.removeAllListeners("LoanRepaid");
    }

    io.close();
  }

  bindLoanEventListeners();
  startOracleSnapshotPolling();

  return {
    io,
    emitOracleUpdate,
    emitLtvUpdate,
    stop,
  };
}

module.exports = {
  createRealtimeSocketServer,
};
