const express = require("express");
const jwt = require("jsonwebtoken");
const { SiweMessage, generateNonce } = require("siwe");
const { isAddress, getAddress } = require("ethers");

const NONCE_TTL_MS = Number(process.env.SIWE_NONCE_TTL_MS || 5 * 60 * 1000);
const NONCE_SWEEP_MS = Number(process.env.SIWE_NONCE_SWEEP_MS || 60 * 1000);

const nonceStore = new Map();

function getJwtSecret() {
  return String(process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || "").trim();
}

function getAdminAllowlist() {
  return String(
    process.env.ADMIN_WALLET_ALLOWLIST || process.env.MULTISIG_SIGNERS || process.env.NEXT_PUBLIC_MULTISIG_SIGNERS || ""
  )
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeWallet(wallet) {
  const candidate = String(wallet || "").trim();
  if (!candidate || !isAddress(candidate)) return "";
  return getAddress(candidate);
}

function isAdminWallet(walletAddress) {
  const normalized = normalizeWallet(walletAddress);
  if (!normalized) return false;

  const allowlist = getAdminAllowlist();
  if (allowlist.length === 0) return true;
  return allowlist.includes(normalized.toLowerCase());
}

function jsonError(response, status, message, extra = {}) {
  return response.status(status).json({ error: message, ...extra });
}

function createNonce(value) {
  nonceStore.set(value, {
    createdAt: Date.now(),
    consumed: false,
  });
}

function isNonceValid(value) {
  const row = nonceStore.get(value);
  if (!row) return false;
  if (row.consumed) return false;
  if (Date.now() - row.createdAt > NONCE_TTL_MS) return false;
  return true;
}

function consumeNonce(value) {
  const row = nonceStore.get(value);
  if (!row) return;
  nonceStore.set(value, { ...row, consumed: true });
}

function sweepExpiredNonces() {
  const now = Date.now();
  for (const [nonce, row] of nonceStore.entries()) {
    if (row.consumed || now - row.createdAt > NONCE_TTL_MS) {
      nonceStore.delete(nonce);
    }
  }
}

setInterval(sweepExpiredNonces, NONCE_SWEEP_MS).unref();

function createAuthRouter() {
  const router = express.Router();

  router.post("/auth/nonce", (_request, response) => {
    const nonce = generateNonce();
    createNonce(nonce);
    return response.json({ nonce });
  });

  router.post("/auth/verify", async (request, response) => {
    try {
      const message = String(request.body?.message || "").trim();
      const signature = String(request.body?.signature || "").trim();

      if (!message || !signature) {
        return jsonError(response, 400, "message and signature are required");
      }

      let siwe;
      try {
        siwe = new SiweMessage(message);
      } catch {
        return jsonError(response, 400, "Invalid SIWE message format");
      }

      if (!siwe.nonce || !isNonceValid(siwe.nonce)) {
        return jsonError(response, 400, "Invalid or expired nonce");
      }

      const expectedDomain = String(process.env.SIWE_DOMAIN || "").trim();
      const expectedUri = String(process.env.SIWE_URI || "").trim();

      const verifyResult = await siwe.verify({
        signature,
        nonce: siwe.nonce,
        domain: expectedDomain || undefined,
      });

      if (!verifyResult?.success) {
        return jsonError(response, 401, "SIWE signature verification failed");
      }

      if (expectedUri && String(siwe.uri || "") !== expectedUri) {
        return jsonError(response, 401, "SIWE uri mismatch");
      }

      const walletAddress = normalizeWallet(siwe.address);
      if (!walletAddress) {
        return jsonError(response, 400, "Invalid wallet address in SIWE message");
      }

      if (!isAdminWallet(walletAddress)) {
        return jsonError(response, 403, "Wallet is not authorized for admin actions");
      }

      const jwtSecret = getJwtSecret();
      if (!jwtSecret) {
        return jsonError(response, 500, "JWT secret is not configured");
      }

      consumeNonce(siwe.nonce);

      const token = jwt.sign(
        {
          walletAddress,
          role: "ADMIN",
          nonce: siwe.nonce,
        },
        jwtSecret,
        { expiresIn: "1h" }
      );

      return response.json({
        token,
        expiresIn: 3600,
        walletAddress,
      });
    } catch (error) {
      return jsonError(response, 500, error.message || "SIWE verify failed");
    }
  });

  return router;
}

function requireAdminJwt(request, response, next) {
  try {
    const authorization = String(request.headers.authorization || "");
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

    if (!token) {
      return jsonError(response, 401, "Missing Authorization bearer token");
    }

    const jwtSecret = getJwtSecret();
    if (!jwtSecret) {
      return jsonError(response, 500, "JWT secret is not configured");
    }

    let payload;
    try {
      payload = jwt.verify(token, jwtSecret);
    } catch {
      return jsonError(response, 401, "Invalid or expired token");
    }

    const walletAddress = normalizeWallet(payload?.walletAddress);
    if (!walletAddress) {
      return jsonError(response, 401, "Token wallet is invalid");
    }

    if (!isAdminWallet(walletAddress)) {
      return jsonError(response, 403, "Wallet is not authorized for admin actions");
    }

    request.admin = {
      walletAddress,
      jwtPayload: payload,
    };

    return next();
  } catch (error) {
    return jsonError(response, 500, error.message || "Authorization failed");
  }
}

module.exports = {
  createAuthRouter,
  requireAdminJwt,
  isAdminWallet,
};
