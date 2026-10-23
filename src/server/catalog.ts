import "server-only";
import { and, asc, count, eq, gte, inArray, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { DbOrTx } from "@/db/client";
import {
  branches,
  extras,
  fuelType,
  transmission,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicleOccupancy,
  vehicles,
  type Branch,
} from "@/db/schema";
import { DomainError, toResult, type Result } from "./errors";
import { computeQuote, loadPricingRules, quoteFor, validateRange, type ExtraSelection, type Quote } from "./pricing";

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

export type BranchSummary = Pick<
  Branch,
  | "id"
  | "code"
  | "name"
  | "city"
  | "emirate"
  | "address"
  | "phone"
  | "email"
  | "timeZone"
  | "openingHours"
  | "isAirport"
  | "latitude"
  | "longitude"
  | "imageUrl"
  | "active"
>;

const branchColumns = {
  id: branches.id,
  code: branches.code,
  name: branches.name,
  city: branches.city,
  emirate: branches.emirate,
  address: branches.address,
  phone: branches.phone,
  email: branches.email,
  timeZone: branches.timeZone,
  openingHours: branches.openingHours,
  isAirport: branches.isAirport,
  latitude: branches.latitude,
  longitude: branches.longitude,
  imageUrl: branches.imageUrl,
  active: branches.active,
};

/** Active branches, ordered by name. Admin screens pass { includeInactive: true }. */
export async function listBranches(opts: { includeInactive?: boolean } = {}): Promise<BranchSummary[]> {
  return db
    .select(branchColumns)
    .from(branches)
    .where(opts.includeInactive ? undefined : eq(branches.active, true))
    .orderBy(asc(branches.name));
}

export async function getBranchByCode(code: string): Promise<(BranchSummary & { vehicleCount: number }) | null> {
  const [branch] = await db.select(branchColumns).from(branches).where(eq(branches.code, code.toUpperCase()));
  if (!branch) return null;
  const [{ n }] = await db
    .select({ n: count() })
    .from(vehicles)
    .where(and(eq(vehicles.branchId, branch.id), notInArray(vehicles.status, ["RETIRED"])));
  return { ...branch, vehicleCount: n };
}

export async function getBranch(id: string): Promise<BranchSummary | null> {
  const [branch] = await db.select(branchColumns).from(branches).where(eq(branches.id, id));
  return branch ?? null;
}

// ---------------------------------------------------------------------------
// Extras and filters
// ---------------------------------------------------------------------------

export type ExtraSummary = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceFils: number;
  maxPriceFils: number | null;
  per: "day" | "rental";
  maxQuantity: number;
};

export async function listExtras(): Promise<ExtraSummary[]> {
  const rows = await db
    .select()
    .from(extras)
    .where(eq(extras.active, true))
    .orderBy(asc(extras.sortOrder), asc(extras.name));
  return rows.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
    description: e.description,
    priceFils: e.priceFils,
    maxPriceFils: e.maxPriceFils,
    per: e.pricing === "PER_DAY" ? "day" : "rental",
    maxQuantity: e.maxQuantity,
  }));
}

export type CategorySummary = { id: string; slug: string; name: string; description: string | null; dailyRateFils: number; depositFils: number };

export async function listCategories(): Promise<CategorySummary[]> {
  return db
    .select({
      id: vehicleCategories.id,
      slug: vehicleCategories.slug,
      name: vehicleCategories.name,
      description: vehicleCategories.description,
      dailyRateFils: vehicleCategories.dailyRateFils,
      depositFils: vehicleCategories.depositFils,
    })
    .from(vehicleCategories)
    .orderBy(asc(vehicleCategories.sortOrder), asc(vehicleCategories.name));
}

const effectiveRate = sql<number>`coalesce(${vehicles.dailyRateFils}, ${vehicleCategories.dailyRateFils})::int`;
/** Vehicles customers can book (MAINTENANCE = out of service indefinitely; use maintenance blocks for planned work). */
const bookable = notInArray(vehicles.status, ["RETIRED", "MAINTENANCE"]);

export type SearchFilterOptions = {
  categories: { id: string; slug: string; name: string }[];
  transmissions: ("AUTOMATIC" | "MANUAL")[];
  fuelTypes: ("PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC")[];
  seatOptions: number[];
  priceRange: { minFils: number; maxFils: number };
};

export async function getSearchFilterOptions(): Promise<SearchFilterOptions> {
  const [categories, seats, [range]] = await Promise.all([
    listCategories(),
    db.selectDistinct({ seats: vehicles.seats }).from(vehicles).where(bookable).orderBy(asc(vehicles.seats)),
    db
      .select({ min: sql<number>`coalesce(min(${effectiveRate}), 0)::int`, max: sql<number>`coalesce(max(${effectiveRate}), 0)::int` })
      .from(vehicles)
      .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
      .where(bookable),
  ]);
  return {
    categories: categories.map(({ id, slug, name }) => ({ id, slug, name })),
    transmissions: [...transmission.enumValues],
    fuelTypes: [...fuelType.enumValues],
    seatOptions: seats.map((s) => s.seats),
    priceRange: { minFils: Number(range.min), maxFils: Number(range.max) },
  };
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * SQL predicate: the vehicle has no occupancy overlapping [startAt, endAt).
 * PENDING holds whose expiry has passed do not count (they are released lazily).
 * `excludeReservationId` ignores the reservation being modified.
 */
export function isFreeSql(vehicleIdCol: SQL | typeof vehicles.id, startAt: Date, endAt: Date, excludeReservationId?: string) {
  return sql`not exists (
    select 1 from ${vehicleOccupancy} o
    left join reservations r on r.id = o.reservation_id
    where o.vehicle_id = ${vehicleIdCol}
      and o.period && tstzrange(${startAt.toISOString()}::timestamptz, ${endAt.toISOString()}::timestamptz, '[)')
      and not coalesce(r.status = 'PENDING' and r.hold_expires_at <= now(), false)
      ${excludeReservationId ? sql`and o.reservation_id is distinct from ${excludeReservationId}::uuid` : sql``}
  )`;
}

export async function isVehicleFree(tx: DbOrTx, vehicleId: string, startAt: Date, endAt: Date, excludeReservationId?: string) {
  const rows = await tx.execute(sql`select ${isFreeSql(sql`${vehicleId}::uuid`, startAt, endAt, excludeReservationId)} as free`);
  return Boolean((rows.rows[0] as { free: boolean }).free);
}

export type SearchParams = {
  pickupBranchId: string;
  returnBranchId?: string;
  pickupAt: Date;
  returnAt: Date;
  categoryId?: string;
  transmission?: "AUTOMATIC" | "MANUAL";
  fuelType?: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
  minSeats?: number;
  minDailyRateFils?: number;
  maxDailyRateFils?: number;
  sort?: "price_asc" | "price_desc";
};

export type VehicleSearchResult = {
  id: string;
  slug: string;
  make: string;
  model: string;
  year: number;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  transmission: "AUTOMATIC" | "MANUAL";
  fuelType: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
  seats: number;
  doors: number;
  luggage: number;
  imageUrl: string | null;
  dailyRateFils: number;
  depositFils: number;
  /** Server quote for the period without extras (incl. one-way fee and VAT). */
  estimatedTotalFils: number;
  oneWayFeeFils: number;
  days: number;
};

/** Vehicles at the pick-up branch that are free for the whole period. */
export async function searchVehicles(params: SearchParams, now = new Date()): Promise<Result<{ vehicles: VehicleSearchResult[] }>> {
  return toResult(async () => {
    validateRange(params.pickupAt, params.returnAt, now);
    for (const id of [params.pickupBranchId, params.returnBranchId, params.categoryId]) {
      if (id !== undefined && !isUuid(id)) throw new DomainError("not_found", "Branch or category not found.");
    }
    const returnBranchId = params.returnBranchId ?? params.pickupBranchId;
    const branchRows = await db
      .select({ id: branches.id, active: branches.active })
      .from(branches)
      .where(inArray(branches.id, [...new Set([params.pickupBranchId, returnBranchId])]));
    if (branchRows.length !== new Set([params.pickupBranchId, returnBranchId]).size) {
      throw new DomainError("not_found", "Branch not found.");
    }
    if (branchRows.some((b) => !b.active)) throw new DomainError("branch_closed", "The selected branch is currently closed.");

    const where = [
      eq(vehicles.branchId, params.pickupBranchId),
      bookable,
      isFreeSql(vehicles.id, params.pickupAt, params.returnAt),
      params.categoryId ? eq(vehicles.categoryId, params.categoryId) : undefined,
      params.transmission ? eq(vehicles.transmission, params.transmission) : undefined,
      params.fuelType ? eq(vehicles.fuelType, params.fuelType) : undefined,
      params.minSeats ? gte(vehicles.seats, params.minSeats) : undefined,
      params.minDailyRateFils !== undefined ? gte(effectiveRate, params.minDailyRateFils) : undefined,
      params.maxDailyRateFils !== undefined ? lte(effectiveRate, params.maxDailyRateFils) : undefined,
    ];
    const rows = await db
      .select({
        id: vehicles.id,
        slug: vehicles.slug,
        make: vehicles.make,
        model: vehicles.model,
        year: vehicles.year,
        categoryId: vehicles.categoryId,
        categoryName: vehicleCategories.name,
        categorySlug: vehicleCategories.slug,
        transmission: vehicles.transmission,
        fuelType: vehicles.fuelType,
        seats: vehicles.seats,
        doors: vehicles.doors,
        luggage: vehicles.luggage,
        images: vehicles.images,
        dailyRateFils: effectiveRate,
        depositFils: vehicleCategories.depositFils,
      })
      .from(vehicles)
      .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
      .where(and(...where))
      .orderBy(params.sort === "price_desc" ? sql`${effectiveRate} desc` : asc(effectiveRate), asc(vehicles.make), asc(vehicles.model));

    const rules = await loadPricingRules(db);
    return {
      vehicles: rows.map(({ images, ...v }) => {
        const quote = computeQuote({
          startAt: params.pickupAt,
          endAt: params.returnAt,
          dailyRateFils: Number(v.dailyRateFils),
          depositFils: v.depositFils,
          categoryId: v.categoryId,
          pickupBranchId: params.pickupBranchId,
          returnBranchId,
          rules,
          extras: [],
          selection: [],
        });
        return {
          ...v,
          dailyRateFils: Number(v.dailyRateFils),
          imageUrl: images[0] ?? null,
          estimatedTotalFils: quote.totalFils,
          oneWayFeeFils: quote.oneWayFeeFils,
          days: quote.days,
        };
      }),
    };
  }, "searchVehicles");
}

// ---------------------------------------------------------------------------
// Vehicle details and calendar
// ---------------------------------------------------------------------------

export type VehicleDetails = {
  id: string;
  slug: string;
  make: string;
  model: string;
  year: number;
  color: string | null;
  transmission: "AUTOMATIC" | "MANUAL";
  fuelType: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
  seats: number;
  doors: number;
  luggage: number;
  status: "AVAILABLE" | "RESERVED" | "ON_RENT" | "MAINTENANCE" | "RETIRED";
  bookable: boolean;
  images: string[];
  dailyRateFils: number;
  depositFils: number;
  category: { id: string; slug: string; name: string; description: string | null };
  branch: BranchSummary;
  features: { id: string; code: string; name: string; icon: string | null }[];
};

export async function getVehicle(id: string): Promise<VehicleDetails | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select({
      v: vehicles,
      category: {
        id: vehicleCategories.id,
        slug: vehicleCategories.slug,
        name: vehicleCategories.name,
        description: vehicleCategories.description,
        dailyRateFils: vehicleCategories.dailyRateFils,
        depositFils: vehicleCategories.depositFils,
      },
      branch: branchColumns,
    })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .where(eq(vehicles.id, id));
  if (!row) return null;
  const features = await db
    .select({ id: vehicleFeatures.id, code: vehicleFeatures.code, name: vehicleFeatures.name, icon: vehicleFeatures.icon })
    .from(vehicleFeatureMap)
    .innerJoin(vehicleFeatures, eq(vehicleFeatures.id, vehicleFeatureMap.featureId))
    .where(eq(vehicleFeatureMap.vehicleId, id))
    .orderBy(asc(vehicleFeatures.name));
  const { v, category } = row;
  return {
    id: v.id,
    slug: v.slug,
    make: v.make,
    model: v.model,
    year: v.year,
    color: v.color,
    transmission: v.transmission,
    fuelType: v.fuelType,
    seats: v.seats,
    doors: v.doors,
    luggage: v.luggage,
    status: v.status,
    bookable: v.status !== "RETIRED" && v.status !== "MAINTENANCE",
    images: v.images,
    dailyRateFils: v.dailyRateFils ?? category.dailyRateFils,
    depositFils: category.depositFils,
    category: { id: category.id, slug: category.slug, name: category.name, description: category.description },
    branch: row.branch,
    features,
  };
}

export type CalendarDay = { date: string; status: "available" | "partial" | "booked" | "maintenance" };
export type BusyInterval = { startAt: Date; endAt: Date; kind: "reservation" | "maintenance" };

/**
 * Day-by-day availability in the vehicle's branch time zone, starting at
 * `fromDate` ('YYYY-MM-DD', local) for `days` days (max 120). No customer data is exposed.
 */
export async function getVehicleCalendar(
  vehicleId: string,
  fromDate: string,
  days: number,
): Promise<{ timeZone: string; days: CalendarDay[]; busy: BusyInterval[] } | null> {
  if (!isUuid(vehicleId) || !isIsoDate(fromDate)) return null;
  const n = Math.min(Math.max(1, Math.floor(days)), 120);
  const [vehicle] = await db
    .select({ timeZone: branches.timeZone })
    .from(vehicles)
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .where(eq(vehicles.id, vehicleId));
  if (!vehicle) return null;
  const tz = vehicle.timeZone;

  const dayRows = (
    await db.execute(sql`
      select to_char(d, 'YYYY-MM-DD') as date,
             (d::timestamp at time zone ${tz}) as start_at,
             ((d + 1)::timestamp at time zone ${tz}) as end_at
      from (select ${fromDate}::date + i as d from generate_series(0, ${n - 1}::int) as i) days
      order by d`)
  ).rows as { date: string; start_at: string | Date; end_at: string | Date }[];
  const windowStart = new Date(dayRows[0].start_at);
  const windowEnd = new Date(dayRows[dayRows.length - 1].end_at);

  const busyRows = (
    await db.execute(sql`
      select lower(o.period) as start_at, upper(o.period) as end_at,
             case when o.maintenance_block_id is not null then 'maintenance' else 'reservation' end as kind
      from ${vehicleOccupancy} o
      left join reservations r on r.id = o.reservation_id
      where o.vehicle_id = ${vehicleId}::uuid
        and o.period && tstzrange(${windowStart.toISOString()}::timestamptz, ${windowEnd.toISOString()}::timestamptz, '[)')
        and not coalesce(r.status = 'PENDING' and r.hold_expires_at <= now(), false)
      order by 1`)
  ).rows as { start_at: string | Date; end_at: string | Date; kind: "reservation" | "maintenance" }[];
  const busy: BusyInterval[] = busyRows.map((b) => ({ startAt: new Date(b.start_at), endAt: new Date(b.end_at), kind: b.kind }));

  return {
    timeZone: tz,
    busy,
    days: dayRows.map((d) => {
      const s = new Date(d.start_at).getTime();
      const e = new Date(d.end_at).getTime();
      const overlapping = busy
        .filter((b) => b.startAt.getTime() < e && b.endAt.getTime() > s)
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
      if (!overlapping.length) return { date: d.date, status: "available" as const };
      // Is the whole day covered by the union of busy intervals?
      let cursor = s;
      for (const b of overlapping) {
        if (b.startAt.getTime() > cursor) break;
        cursor = Math.max(cursor, b.endAt.getTime());
      }
      if (cursor < e) return { date: d.date, status: "partial" as const };
      const onlyMaintenance = overlapping.every((b) => b.kind === "maintenance");
      return { date: d.date, status: onlyMaintenance ? ("maintenance" as const) : ("booked" as const) };
    }),
  };
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export type QuoteParams = {
  vehicleId: string;
  pickupBranchId: string;
  returnBranchId: string;
  pickupAt: Date;
  returnAt: Date;
  extras?: ExtraSelection[];
};

/** Server-side price quote, also checking current availability. */
export async function getQuote(params: QuoteParams, now = new Date()): Promise<Result<{ quote: Quote; available: boolean }>> {
  return toResult(async () => {
    if (!isUuid(params.vehicleId)) throw new DomainError("not_found", "Vehicle not found.");
    const { vehicle, quote } = await quoteFor(db, params, now);
    if (vehicle.status === "RETIRED" || vehicle.status === "MAINTENANCE") {
      throw new DomainError("unavailable", "This vehicle is not available for booking.");
    }
    const available = await isVehicleFree(db, params.vehicleId, params.pickupAt, params.returnAt);
    if (!available) throw new DomainError("unavailable", "This vehicle is already booked for the selected dates.");
    return { quote, available };
  }, "getQuote");
}

/** A real calendar date in YYYY-MM-DD form (rejects 2031-13-45). */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
