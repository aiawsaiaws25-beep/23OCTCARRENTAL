// Raw-SQL test data factory for integration tests against driveeasy_test.
// Every call creates fresh, uniquely-named rows so tests never depend on seed
// data or ordering and can run in parallel.
import { randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { testDbUrl } from "./db";

let pool: Pool | undefined;
export function qaPool(): Pool {
  // QA_FACTORY_DATABASE_URL lets e2e specs reuse this factory against driveeasy_e2e.
  pool ??= new Pool({ connectionString: process.env.QA_FACTORY_DATABASE_URL ?? testDbUrl(), max: 40 });
  return pool;
}
export async function closeQaPool() {
  await pool?.end();
  pool = undefined;
}

const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
export function uniqueVin() {
  const b = randomBytes(17);
  return Array.from(b, (x) => VIN_CHARS[x % VIN_CHARS.length]).join("");
}
export function uniqueCode(prefix = "Q") {
  return (prefix + randomBytes(6).toString("hex").toUpperCase()).slice(0, 10);
}
export const uid = () => randomUUID().slice(0, 8);

type Q = Pool | PoolClient;

export async function createUser(opts: { role?: "CUSTOMER" | "ADMIN"; email?: string } = {}, db: Q = qaPool()) {
  const email = opts.email ?? `qa-${uid()}-${Date.now()}@example.test`;
  const { rows } = await db.query(
    `insert into users (name, email, role) values ($1, $2, $3) returning id, email, role`,
    [`QA ${uid()}`, email, opts.role ?? "CUSTOMER"],
  );
  return rows[0] as { id: string; email: string; role: string };
}

export async function createBranch(opts: { code?: string } = {}, db: Q = qaPool()) {
  const code = opts.code ?? uniqueCode("QB");
  const { rows } = await db.query(
    `insert into branches (code, name, city, emirate, address, phone, opening_hours)
     values ($1, $2, 'Dubai', 'Dubai', 'QA Street 1', '+971400000000', 'Open 24 hours') returning id, code`,
    [code, `QA Branch ${code}`],
  );
  return rows[0] as { id: string; code: string };
}

export async function createCategory(opts: { dailyRateFils?: number; depositFils?: number } = {}, db: Q = qaPool()) {
  const slug = `qa-cat-${uid()}`;
  const { rows } = await db.query(
    `insert into vehicle_categories (slug, name, daily_rate_fils, deposit_fils) values ($1, $1, $2, $3) returning id`,
    [slug, opts.dailyRateFils ?? 15_000, opts.depositFils ?? 100_000],
  );
  return rows[0] as { id: string };
}

export async function createVehicle(
  opts: {
    branchId?: string;
    categoryId?: string;
    dailyRateFils?: number | null;
    transmission?: "AUTOMATIC" | "MANUAL";
    fuelType?: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
    seats?: number;
    status?: "AVAILABLE" | "RESERVED" | "ON_RENT" | "MAINTENANCE" | "RETIRED";
    make?: string;
  } = {},
  db: Q = qaPool(),
) {
  const branchId = opts.branchId ?? (await createBranch({}, db)).id;
  const categoryId = opts.categoryId ?? (await createCategory({}, db)).id;
  const { rows } = await db.query(
    `insert into vehicles (branch_id, category_id, slug, make, model, year, plate_number, vin, transmission, fuel_type, seats, doors, luggage, daily_rate_fils, status)
     values ($1, $2, 'toyota-yaris', $6, 'Yaris', 2025, $3, $4, $7, $8, $9, 4, 2, $5, $10) returning id`,
    [
      branchId,
      categoryId,
      `QA-${uniqueCode("P")}`,
      uniqueVin(),
      opts.dailyRateFils ?? null,
      opts.make ?? "Toyota",
      opts.transmission ?? "AUTOMATIC",
      opts.fuelType ?? "PETROL",
      opts.seats ?? 5,
      opts.status ?? "AVAILABLE",
    ],
  );
  return { id: rows[0].id as string, branchId, categoryId };
}

export type RawReservation = {
  userId: string;
  vehicleId: string;
  branchId: string;
  startAt: Date;
  endAt: Date;
  status?: "PENDING" | "CONFIRMED" | "PICKED_UP" | "RETURNED" | "CANCELLED" | "EXPIRED" | "REFUNDED";
  holdExpiresAt?: Date;
};

/** Inserts a reservation row directly (bypasses services) — for DB-constraint tests. */
export async function insertReservation(r: RawReservation, db: Q = qaPool()) {
  const status = r.status ?? "PENDING";
  const hold = r.holdExpiresAt ?? (status === "PENDING" ? new Date(Date.now() + 15 * 60_000) : null);
  const breakdown = { days: 1, totalFils: 10500 };
  const { rows } = await db.query(
    `insert into reservations (reference, user_id, vehicle_id, pickup_branch_id, return_branch_id, start_at, end_at, status,
        hold_expires_at, idempotency_key, days, daily_rate_fils, base_fils, subtotal_fils, vat_rate_bps, vat_fils, total_fils,
        deposit_fils, price_breakdown)
     values ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9, 1, 10000, 10000, 10000, 500, 500, 10500, 100000, $10)
     returning id, status`,
    [`QA-${uniqueCode("R")}`, r.userId, r.vehicleId, r.branchId, r.startAt, r.endAt, status, hold, randomUUID(), breakdown],
  );
  return rows[0] as { id: string; status: string };
}

/** Fixed future instants (UTC) relative to a base day offset, for deterministic ranges. */
export function at(dayOffset: number, hour = 10, minute = 0) {
  const base = Date.UTC(2031, 0, 1); // far future so "now" never interferes
  return new Date(base + dayOffset * 86_400_000 + hour * 3_600_000 + minute * 60_000);
}

export function pgCode(err: unknown): string | undefined {
  let e = err as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; i < 5 && e; i++) {
    if (e.code && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
    e = e.cause as typeof e;
  }
  return undefined;
}

export async function insertMaintenance(vehicleId: string, startAt: Date, endAt: Date, db: Q = qaPool()) {
  const { rows } = await db.query(
    `insert into maintenance_blocks (vehicle_id, start_at, end_at, reason) values ($1, $2, $3, 'QA service') returning id`,
    [vehicleId, startAt, endAt],
  );
  return rows[0] as { id: string };
}

export async function createExtra(
  opts: { pricing?: "PER_DAY" | "PER_RENTAL"; priceFils?: number; maxPriceFils?: number | null; maxQuantity?: number; active?: boolean } = {},
  db: Q = qaPool(),
) {
  const code = `QA_${uniqueCode("X")}`;
  const { rows } = await db.query(
    `insert into extras (code, name, pricing, price_fils, max_price_fils, max_quantity, active)
     values ($1, $1, $2, $3, $4, $5, $6) returning id, code`,
    [code, opts.pricing ?? "PER_DAY", opts.priceFils ?? 2_500, opts.maxPriceFils ?? null, opts.maxQuantity ?? 2, opts.active ?? true],
  );
  return rows[0] as { id: string; code: string };
}

/** Branch-pair specific so it never affects prices in other tests. */
export async function createOneWayRule(pickupBranchId: string, returnBranchId: string, feeFils: number, db: Q = qaPool()) {
  const { rows } = await db.query(
    `insert into pricing_rules (name, type, pickup_branch_id, return_branch_id, fee_fils) values ('QA one-way', 'ONE_WAY_FEE', $1, $2, $3) returning id`,
    [pickupBranchId, returnBranchId, feeFils],
  );
  return rows[0] as { id: string };
}

/** Category specific so it never affects prices in other tests. */
export async function createSeasonalRule(categoryId: string, from: Date, to: Date, adjustmentBp: number, db: Q = qaPool()) {
  const { rows } = await db.query(
    `insert into pricing_rules (name, type, category_id, valid_during, adjustment_bp)
     values ('QA season', 'SEASONAL', $1, tstzrange($2, $3, '[)'), $4) returning id`,
    [categoryId, from, to, adjustmentBp],
  );
  return rows[0] as { id: string };
}
