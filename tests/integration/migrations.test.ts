// Q11: migrations on a clean database. Creates driveeasy_clean from nothing,
// runs the project's own `pnpm db:migrate` + `pnpm db:seed`, and checks the
// schema invariants the rest of the app relies on.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropDb, hasMigrations, hasSeed, migrate, query, recreateDb, seed } from "../helpers/db";

const NAME = "driveeasy_clean";
let url: string;

describe.runIf(hasMigrations())("migrations on a clean database", () => {
  beforeAll(async () => {
    url = await recreateDb(NAME);
  });
  afterAll(async () => {
    if (process.env.QA_KEEP_CLEAN_DB !== "1") await dropDb(NAME);
  });

  it("pnpm db:migrate succeeds on an empty database", () => {
    expect(() => migrate(url)).not.toThrow();
  });

  it("running migrate again is a no-op", () => {
    expect(() => migrate(url)).not.toThrow();
  });

  it("btree_gist is installed", async () => {
    const rows = await query(url, "select 1 from pg_extension where extname = 'btree_gist'");
    expect(rows).toHaveLength(1);
  });

  it("creates the domain tables (>= 18 app tables)", async () => {
    const rows = await query<{ table_name: string }>(
      url,
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
    );
    const names = rows.map((r) => r.table_name);
    expect(names.length).toBeGreaterThanOrEqual(18);
    for (const t of ["users", "branches", "vehicles", "reservations"]) expect(names).toContain(t);
  });

  it("has an EXCLUDE USING gist (vehicle_id =, period &&) constraint on vehicle_occupancy", async () => {
    const rows = await query<{ table: string; def: string }>(
      url,
      `select c.conrelid::regclass::text as table, pg_get_constraintdef(c.oid) as def
         from pg_constraint c where c.contype = 'x'`,
    );
    const defs = rows.map((r) => `${r.table}: ${r.def}`);
    // Reservations/holds and maintenance blocks are both mirrored into vehicle_occupancy (D2).
    expect(
      defs.some((d) => /^vehicle_occupancy:/.test(d) && /gist/i.test(d) && /vehicle_id WITH =/.test(d) && /period WITH &&/.test(d)),
      defs.join("\n"),
    ).toBe(true);
    const trg = await query<{ tgname: string; table: string }>(
      url,
      `select tgname, tgrelid::regclass::text as table from pg_trigger where not tgisinternal`,
    );
    const tables = trg.map((t) => t.table);
    expect(tables).toContain("reservations");
    expect(tables).toContain("maintenance_blocks");
  });

  it("uses tstzrange periods and half-open bounds", async () => {
    const rows = await query<{ table_name: string; column_name: string }>(
      url,
      `select table_name, column_name from information_schema.columns
        where table_schema='public' and udt_name = 'tstzrange'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("uses uuid primary keys on domain tables", async () => {
    const rows = await query<{ table_name: string; data_type: string }>(
      url,
      `select tc.table_name, c.data_type
         from information_schema.table_constraints tc
         join information_schema.key_column_usage k on k.constraint_name = tc.constraint_name and k.table_schema = tc.table_schema
         join information_schema.columns c on c.table_name = k.table_name and c.column_name = k.column_name and c.table_schema = k.table_schema
        where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'
          and tc.table_name not like '%drizzle%'`,
    );
    const nonUuid = rows.filter((r) => r.data_type !== "uuid").map((r) => `${r.table_name}:${r.data_type}`);
    expect(nonUuid).toEqual([]);
  });

  it("stores money as integers (no float/numeric money columns)", async () => {
    const rows = await query<{ table_name: string; column_name: string; data_type: string }>(
      url,
      `select table_name, column_name, data_type from information_schema.columns
        where table_schema='public' and data_type in ('real','double precision','numeric','money')
          and (column_name ~ '(fils|price|amount|fee|rate|total|cost|deposit|charge)')`,
    );
    expect(rows.map((r) => `${r.table_name}.${r.column_name}:${r.data_type}`)).toEqual([]);
  });

  it("timestamps are timestamptz", async () => {
    const rows = await query<{ table_name: string; column_name: string }>(
      url,
      `select table_name, column_name from information_schema.columns
        where table_schema='public' and data_type = 'timestamp without time zone'`,
    );
    expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([]);
  });

  it("has foreign keys, check constraints and unique plate/VIN/branch code", async () => {
    const rows = await query<{ contype: string; table: string; def: string }>(
      url,
      `select contype, conrelid::regclass::text as table, pg_get_constraintdef(oid) as def
         from pg_constraint where connamespace = 'public'::regnamespace`,
    );
    expect(rows.filter((r) => r.contype === "f").length).toBeGreaterThanOrEqual(10);
    expect(rows.filter((r) => r.contype === "c").length).toBeGreaterThanOrEqual(3);
    const idx = await query<{ indexdef: string }>(url, "select indexdef from pg_indexes where schemaname='public'");
    const uniques = [
      ...rows.filter((r) => r.contype === "u").map((r) => `${r.table} ${r.def}`),
      ...idx.map((r) => r.indexdef).filter((d) => /UNIQUE/i.test(d)),
    ].join("\n");
    expect(uniques).toMatch(/vehicles[\s\S]*plate/i);
    expect(uniques).toMatch(/vehicles[\s\S]*vin/i);
    expect(uniques).toMatch(/branches[\s\S]*code/i);
  });

  it.runIf(hasSeed())("pnpm db:seed succeeds and the exclusion constraint holds on seeded data", async () => {
    expect(() => seed(url)).not.toThrow();
    const [b] = await query<{ n: number }>(url, "select count(*)::int as n from branches");
    const [v] = await query<{ n: number }>(url, "select count(*)::int as n from vehicles");
    expect(b.n).toBeGreaterThan(0);
    expect(v.n).toBeGreaterThan(0);
  });
});
