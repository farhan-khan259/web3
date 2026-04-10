const { PrismaClient } = require("@prisma/client");

function withSslRequired(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) {
    return value;
  }

  // Supabase Postgres requires SSL; keep existing query params and add sslmode=require when missing.
  if (/sslmode=/i.test(value)) {
    return value;
  }

  return value.includes("?") ? `${value}&sslmode=require` : `${value}?sslmode=require`;
}

const databaseUrl = withSslRequired(process.env.DATABASE_URL);

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
});

module.exports = prisma;