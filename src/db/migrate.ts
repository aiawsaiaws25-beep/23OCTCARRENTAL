import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { createDb } from "./client";

export const MIGRATIONS_FOLDER = resolve(process.cwd(), "drizzle");

/**
 * Applies all pending migrations in ./drizzle to the database at `url`.
 * Use the direct/unpooled URL (DATABASE_URL_UNPOOLED on Neon) for migrations.
 * Idempotent: already-applied migrations are skipped.
 */
export async function migrateDatabase(url: string): Promise<void> {
  const db = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await db.$client.end();
  }
}

/**
 * Drops every DriveEasy object in the database at `url` (public + drizzle schemas)
 * and re-applies migrations. Destroys all data: refuses to run when NODE_ENV=production.
 */
export async function resetDatabase(url: string): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("resetDatabase refuses to run in production");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS public CASCADE`);
    await client.query(`CREATE SCHEMA public`);
  } finally {
    await client.end();
  }
  await migrateDatabase(url);
}

/** Picks the migration URL: explicit > DATABASE_URL_UNPOOLED > DATABASE_URL. */
export function migrationUrl(explicit?: string): string {
  const url = explicit || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("No database URL: pass --url or set DATABASE_URL_UNPOOLED / DATABASE_URL");
  return url;
}
