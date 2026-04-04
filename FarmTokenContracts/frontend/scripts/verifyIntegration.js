const fs = require("fs");
const path = require("path");

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(path.resolve(process.cwd(), ".env"));

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function computeHealth({ valuation, ipStatus, provenanceVerified, minValuation }) {
  if (valuation < minValuation) {
    return { status: "PANIC", reason: "Valuation below $10M floor trigger" };
  }

  if (ipStatus !== "Registered") {
    return { status: "PANIC", reason: "IP status is not Registered" };
  }

  if (!provenanceVerified) {
    return { status: "WARNING", reason: "Provenance not verified" };
  }

  return { status: "HEALTHY", reason: "All oracle checks passed" };
}

function main() {
  try {
    const env = process.env;

    assert(env.NEXT_PUBLIC_ORACLE_VALUATION_MIN, "Missing NEXT_PUBLIC_ORACLE_VALUATION_MIN");
    assert(env.NEXT_PUBLIC_ORACLE_VALUATION_MAX, "Missing NEXT_PUBLIC_ORACLE_VALUATION_MAX");
    assert(env.NEXT_PUBLIC_ORACLE_APPRAISER, "Missing NEXT_PUBLIC_ORACLE_APPRAISER");
    assert(env.NEXT_PUBLIC_ORACLE_TRADEMARK, "Missing NEXT_PUBLIC_ORACLE_TRADEMARK");
    assert(env.NEXT_PUBLIC_ORACLE_IP_STATUS, "Missing NEXT_PUBLIC_ORACLE_IP_STATUS");
    assert(env.NEXT_PUBLIC_ORACLE_AUTH_CODE, "Missing NEXT_PUBLIC_ORACLE_AUTH_CODE");

    pass("All required oracle .env variables are loaded");

    const min = Number(env.NEXT_PUBLIC_ORACLE_VALUATION_MIN);
    const max = Number(env.NEXT_PUBLIC_ORACLE_VALUATION_MAX);

    assert(min === 10_000_000, "Valuation min must be 10,000,000");
    assert(max === 25_000_000, "Valuation max must be 25,000,000");
    pass("Valuation range matches expected client data");

    const healthy = computeHealth({
      valuation: 12_000_000,
      ipStatus: env.NEXT_PUBLIC_ORACLE_IP_STATUS.replace(/^"|"$/g, ""),
      provenanceVerified: true,
      minValuation: min,
    });

    assert(healthy.status === "HEALTHY", "Expected HEALTHY status for baseline test");
    pass("Health check returns HEALTHY for valid oracle data");

    const valuationPanic = computeHealth({
      valuation: 9_000_000,
      ipStatus: "Registered",
      provenanceVerified: true,
      minValuation: min,
    });

    assert(valuationPanic.status === "PANIC", "Expected PANIC when valuation < $10M");
    pass("Panic mode triggers when valuation drops below $10M");

    const ipPanic = computeHealth({
      valuation: 12_000_000,
      ipStatus: "Expired",
      provenanceVerified: true,
      minValuation: min,
    });

    assert(ipPanic.status === "PANIC", "Expected PANIC when IP status is not Registered");
    pass("Panic mode triggers when IP status changes from Registered");

    const provenanceWarning = computeHealth({
      valuation: 12_000_000,
      ipStatus: "Registered",
      provenanceVerified: false,
      minValuation: min,
    });

    assert(provenanceWarning.status === "WARNING", "Expected WARNING when provenance is not verified");
    pass("Provenance verification check returns WARNING when missing");

    console.log("Integration verification completed successfully.");
  } catch (err) {
    fail(err.message);
    process.exit(1);
  }
}

main();
