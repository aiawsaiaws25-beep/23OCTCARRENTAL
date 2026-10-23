import "server-only";
import { getEnv } from "@/lib/env";
import { createDb, type Database } from "./client";

export type { Database, DbOrTx, Tx } from "./client";

// The URL is read from the environment the first time this module is imported
// (NODE_ENV=test uses TEST_DATABASE_URL when set). The pool is kept on
// globalThis so dev hot reloads do not open new pools.
const env = getEnv();
const url = env.NODE_ENV === "test" ? (env.TEST_DATABASE_URL ?? env.DATABASE_URL) : env.DATABASE_URL;

const g = globalThis as unknown as { __driveeasyDb?: { url: string; db: Database } };
if (!g.__driveeasyDb || g.__driveeasyDb.url !== url) {
  g.__driveeasyDb = { url, db: createDb(url, { max: env.DB_POOL_MAX }) };
}

export const db: Database = g.__driveeasyDb.db;
export const pool = db.$client;
