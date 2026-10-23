import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };
/** A database handle or an open transaction; services accept either. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

/**
 * Creates a Drizzle client for any connection string (the pg driver works for
 * local Postgres and for Neon's pooled URL alike). Used by the app (via ./index),
 * migrations, seeding and tests. Call `db.$client.end()` when done in scripts.
 */
export function createDb(url: string, config: Omit<PoolConfig, "connectionString"> = {}): Database {
  const pool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, ...config });
  return drizzle(pool, { schema }) as Database;
}
