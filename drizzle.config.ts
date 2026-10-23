import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// loadEnvFile never overrides variables that are already set, so
// `DATABASE_URL=... pnpm db:studio` targets another database.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Migrations and schema tools use the direct (unpooled) connection when one is
// configured (Neon: DATABASE_URL_UNPOOLED); the app itself uses the pooled DATABASE_URL.
// Prefer `pnpm db:migrate` (scripts/db.ts), which applies the same rule.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL)! },
});
