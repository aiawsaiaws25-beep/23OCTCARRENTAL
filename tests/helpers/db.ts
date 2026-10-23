// QA test-database helpers: create a throwaway database, install btree_gist,
// apply the project's migrations and (optionally) seed it.
// Never point these at driveeasy_dev.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

export const ROOT = join(__dirname, "..", "..");
const PROTECTED = new Set(["driveeasy_dev", "postgres", "template0", "template1"]);

function loadEnv() {
  for (const f of [".env.local", ".env.test", ".env.test.local"]) {
    const p = join(ROOT, f);
    if (existsSync(p)) process.loadEnvFile(p);
  }
}

/** Base URL of driveeasy_test (from TEST_DATABASE_URL). */
export function testDbUrl(): string {
  if (!process.env.TEST_DATABASE_URL) loadEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  return url;
}

/** Same server/credentials as TEST_DATABASE_URL, different database name. */
export function urlForDb(name: string): string {
  const u = new URL(testDbUrl());
  u.pathname = `/${name}`;
  return u.toString();
}

export function dbName(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

async function withMaintenance<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: urlForDb("postgres") });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Drop (if present) and create an empty database with btree_gist installed. */
export async function recreateDb(name: string): Promise<string> {
  if (PROTECTED.has(name)) throw new Error(`Refusing to recreate protected database ${name}`);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Bad database name ${name}`);
  await withMaintenance(async (c) => {
    await c.query(`drop database if exists ${name} with (force)`);
    await c.query(`create database ${name}`);
  });
  const url = urlForDb(name);
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("create extension if not exists btree_gist");
  } finally {
    await c.end();
  }
  return url;
}

export async function dropDb(name: string): Promise<void> {
  if (PROTECTED.has(name)) throw new Error(`Refusing to drop protected database ${name}`);
  await withMaintenance((c) => c.query(`drop database if exists ${name} with (force)`));
}

export function hasMigrations(): boolean {
  return existsSync(join(ROOT, "drizzle", "meta", "_journal.json"));
}

function run(cmd: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status}):\n${r.stdout}\n${r.stderr}`);
  }
  return r.stdout;
}

/** Apply migrations through the project's own CLI entry point (`pnpm db:migrate`). */
export function migrate(url: string): string {
  if (!hasMigrations()) throw new Error("No drizzle migrations yet (drizzle/meta/_journal.json missing)");
  return run("pnpm", ["db:migrate"], { DATABASE_URL: url, DATABASE_URL_UNPOOLED: url });
}

export function hasSeed(): boolean {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return Boolean(pkg.scripts?.["db:seed"]);
}

/** Run the project's seed (`pnpm db:seed`) against url. */
export function seed(url: string): string {
  if (!hasSeed()) throw new Error("No db:seed script yet");
  return run("pnpm", ["db:seed"], { DATABASE_URL: url, DATABASE_URL_UNPOOLED: url });
}

/** Fresh DB → migrate → optional seed. Returns its URL. */
export async function resetDb(name: string, opts: { seed?: boolean } = {}): Promise<string> {
  const url = await recreateDb(name);
  migrate(url);
  if (opts.seed) seed(url);
  return url;
}

export async function query<T = Record<string, unknown>>(url: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}
