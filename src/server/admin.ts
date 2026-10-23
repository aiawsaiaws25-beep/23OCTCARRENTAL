import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  auditLogs,
  branches,
  damageReports,
  deposits,
  extras,
  maintenanceBlocks,
  pricingRules,
  rentalAgreements,
  reservations,
  users,
  vehicleCategories,
  vehicleFeatureMap,
  vehicleFeatures,
  vehicles,
} from "@/db/schema";
import { audit } from "./audit";
import { isUuid, listBranches } from "./catalog";
import { DomainError, mapDbError, toResult, VehicleUnavailableError, type Result } from "./errors";
import { logger } from "./logger";
import { captureDepositRow, releaseDepositRow } from "./payments";
import { VAT_RATE_BPS } from "./policy";
import { bp, computeFuelCharge, computeLateCharge } from "./pricing";
import { cancelReservation, loadReservationDetail, type ReservationDetail } from "./reservations";
import type { CurrentUser } from "./session";
import { storeDamageImage, type UploadFile } from "./uploads";

const log = logger.child({ module: "admin" });

/** Every admin service takes the acting user (from requireAdmin()) and re-checks the role. */
export type Actor = Pick<CurrentUser, "id" | "role">;

function guard(actor: Actor | null | undefined): asserts actor is Actor {
  if (!actor) throw new DomainError("unauthenticated", "Please sign in.");
  if (actor.role !== "ADMIN") throw new DomainError("forbidden", "Admins only.");
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new DomainError("validation", r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  return r.data;
}

const uuid = z.uuid();
const fils = z.number().int().min(0).max(100_000_000);
const posFils = z.number().int().min(1).max(100_000_000);

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

const branchSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/),
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(80),
  emirate: z.string().trim().min(2).max(80),
  address: z.string().trim().min(5).max(300),
  phone: z.string().trim().min(6).max(30),
  email: z.email().nullable().optional(),
  timeZone: z
    .string()
    .default("Asia/Dubai")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown IANA time zone"),
  openingHours: z.string().trim().min(2).max(200),
  isAirport: z.boolean().default(false),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  active: z.boolean().default(true),
});
export type BranchInput = z.input<typeof branchSchema>;

export async function adminListBranches(actor: Actor) {
  guard(actor);
  return listBranches({ includeInactive: true });
}

export async function createBranch(actor: Actor, input: BranchInput): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    const data = parse(branchSchema, input);
    const [b] = await uniqueOr("A branch with this code already exists.", () => db.insert(branches).values(data).returning());
    await audit(db, { actorUserId: actor.id, action: "branch.create", entityType: "branch", entityId: b.id, data });
    return { id: b.id };
  }, "createBranch");
}

export async function updateBranch(actor: Actor, id: string, patch: Partial<BranchInput>): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    const data = parse(branchSchema.partial(), patch);
    const rows = await uniqueOr("A branch with this code already exists.", () => db.update(branches).set(data).where(eq(branches.id, id)).returning());
    if (!rows.length) throw new DomainError("not_found", "Branch not found.");
    await audit(db, { actorUserId: actor.id, action: "branch.update", entityType: "branch", entityId: id, data });
    return { id };
  }, "updateBranch");
}

async function uniqueOr<T>(message: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as { cause?: { code?: string }; code?: string }).cause?.code ?? (err as { code?: string }).code;
    if (code === "23505") throw new DomainError("conflict", message);
    throw mapDbError(err);
  }
}

// ---------------------------------------------------------------------------
// Fleet
// ---------------------------------------------------------------------------

const vehicleSchema = z.object({
  branchId: uuid,
  categoryId: uuid,
  slug: z.string().trim().regex(/^[a-z0-9-]{2,60}$/),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  year: z.number().int().min(1990).max(2100),
  plateNumber: z.string().trim().toUpperCase().min(2).max(20),
  vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN must be 17 characters (no I, O or Q)"),
  color: z.string().trim().max(40).nullable().optional(),
  transmission: z.enum(["AUTOMATIC", "MANUAL"]),
  fuelType: z.enum(["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]),
  seats: z.number().int().min(1).max(15),
  doors: z.number().int().min(2).max(6),
  luggage: z.number().int().min(0).max(10),
  dailyRateFils: posFils.nullable().optional(),
  mileageKm: z.number().int().min(0).default(0),
  status: z.enum(["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"]).default("AVAILABLE"),
  images: z.array(z.string().max(500)).max(20).default([]),
  featureIds: z.array(uuid).optional(),
});
export type VehicleInput = z.input<typeof vehicleSchema>;

export type AdminVehicleRow = {
  id: string;
  slug: string;
  make: string;
  model: string;
  year: number;
  plateNumber: string;
  vin: string;
  status: string;
  branchId: string;
  branchCode: string;
  categoryId: string;
  categoryName: string;
  dailyRateFils: number;
  rateOverrideFils: number | null;
  mileageKm: number;
  imageUrl: string | null;
  transmission: string;
  fuelType: string;
  seats: number;
};

export async function adminListVehicles(
  actor: Actor,
  filters: { branchId?: string; categoryId?: string; status?: string; q?: string } = {},
): Promise<AdminVehicleRow[]> {
  guard(actor);
  const where: (SQL | undefined)[] = [
    filters.branchId && isUuid(filters.branchId) ? eq(vehicles.branchId, filters.branchId) : undefined,
    filters.categoryId && isUuid(filters.categoryId) ? eq(vehicles.categoryId, filters.categoryId) : undefined,
    filters.status ? sql`${vehicles.status}::text = ${filters.status}` : undefined,
    filters.q
      ? or(ilike(vehicles.make, `%${filters.q}%`), ilike(vehicles.model, `%${filters.q}%`), ilike(vehicles.plateNumber, `%${filters.q}%`), ilike(vehicles.vin, `%${filters.q}%`))
      : undefined,
  ];
  const rows = await db
    .select({ v: vehicles, branchCode: branches.code, categoryName: vehicleCategories.name, categoryRate: vehicleCategories.dailyRateFils })
    .from(vehicles)
    .innerJoin(branches, eq(branches.id, vehicles.branchId))
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(and(...where))
    .orderBy(asc(branches.code), asc(vehicles.make), asc(vehicles.model));
  return rows.map(({ v, branchCode, categoryName, categoryRate }) => ({
    id: v.id,
    slug: v.slug,
    make: v.make,
    model: v.model,
    year: v.year,
    plateNumber: v.plateNumber,
    vin: v.vin,
    status: v.status,
    branchId: v.branchId,
    branchCode,
    categoryId: v.categoryId,
    categoryName,
    dailyRateFils: v.dailyRateFils ?? categoryRate,
    rateOverrideFils: v.dailyRateFils,
    mileageKm: v.mileageKm,
    imageUrl: v.images[0] ?? null,
    transmission: v.transmission,
    fuelType: v.fuelType,
    seats: v.seats,
  }));
}

export async function adminGetVehicle(actor: Actor, id: string) {
  guard(actor);
  if (!isUuid(id)) return null;
  const [v] = await db.select().from(vehicles).where(eq(vehicles.id, id));
  if (!v) return null;
  const features = await db.select({ featureId: vehicleFeatureMap.featureId }).from(vehicleFeatureMap).where(eq(vehicleFeatureMap.vehicleId, id));
  return { ...v, featureIds: features.map((f) => f.featureId) };
}

export async function createVehicle(actor: Actor, input: VehicleInput): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    const { featureIds, ...data } = parse(vehicleSchema, input);
    const id = await uniqueOr("A vehicle with this plate number or VIN already exists.", () =>
      db.transaction(async (tx) => {
        const [v] = await tx.insert(vehicles).values(data).returning();
        if (featureIds?.length) await tx.insert(vehicleFeatureMap).values(featureIds.map((featureId) => ({ vehicleId: v.id, featureId })));
        await audit(tx, { actorUserId: actor.id, action: "vehicle.create", entityType: "vehicle", entityId: v.id, data });
        return v.id;
      }),
    );
    return { id };
  }, "createVehicle");
}

export async function updateVehicle(actor: Actor, id: string, patch: Partial<VehicleInput>): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    if (!isUuid(id)) throw new DomainError("not_found", "Vehicle not found.");
    const { featureIds, ...data } = parse(vehicleSchema.partial(), patch);
    await uniqueOr("A vehicle with this plate number or VIN already exists.", () =>
      db.transaction(async (tx) => {
        const [before] = await tx.select().from(vehicles).where(eq(vehicles.id, id)).for("update");
        if (!before) throw new DomainError("not_found", "Vehicle not found.");
        if (Object.keys(data).length) await tx.update(vehicles).set(data).where(eq(vehicles.id, id));
        if (featureIds) {
          await tx.delete(vehicleFeatureMap).where(eq(vehicleFeatureMap.vehicleId, id));
          if (featureIds.length) await tx.insert(vehicleFeatureMap).values(featureIds.map((featureId) => ({ vehicleId: id, featureId })));
        }
        await audit(tx, { actorUserId: actor.id, action: "vehicle.update", entityType: "vehicle", entityId: id, data: { ...data, featureIds } });
      }),
    );
    return { id };
  }, "updateVehicle");
}

export async function listFeatures() {
  return db.select().from(vehicleFeatures).orderBy(asc(vehicleFeatures.name));
}

// ---------------------------------------------------------------------------
// Pricing: categories, extras, rules. (VAT is fixed at 5 % by law: policy.ts.)
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(2).max(60),
  description: z.string().max(500).nullable().optional(),
  dailyRateFils: posFils,
  depositFils: fils,
  sortOrder: z.number().int().default(0),
});

export async function createCategory(actor: Actor, input: z.input<typeof categorySchema>): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    const data = parse(categorySchema, input);
    const [c] = await uniqueOr("A category with this slug exists.", () => db.insert(vehicleCategories).values(data).returning());
    await audit(db, { actorUserId: actor.id, action: "category.create", entityType: "vehicle_category", entityId: c.id, data });
    return { id: c.id };
  }, "createCategory");
}

export async function updateCategory(actor: Actor, id: string, patch: Partial<z.input<typeof categorySchema>>): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    const data = parse(categorySchema.partial(), patch);
    const rows = await uniqueOr("A category with this slug exists.", () => db.update(vehicleCategories).set(data).where(eq(vehicleCategories.id, id)).returning());
    if (!rows.length) throw new DomainError("not_found", "Category not found.");
    await audit(db, { actorUserId: actor.id, action: "category.update", entityType: "vehicle_category", entityId: id, data });
    return { id };
  }, "updateCategory");
}

const extraSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/),
  name: z.string().trim().min(2).max(80),
  description: z.string().max(500).nullable().optional(),
  pricing: z.enum(["PER_DAY", "PER_RENTAL"]),
  priceFils: fils,
  maxPriceFils: fils.nullable().optional(),
  maxQuantity: z.number().int().min(1).max(10).default(1),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export async function adminListExtras(actor: Actor) {
  guard(actor);
  return db.select().from(extras).orderBy(asc(extras.sortOrder), asc(extras.name));
}

export async function createExtra(actor: Actor, input: z.input<typeof extraSchema>): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    const data = parse(extraSchema, input);
    const [e] = await uniqueOr("An extra with this code exists.", () => db.insert(extras).values(data).returning());
    await audit(db, { actorUserId: actor.id, action: "extra.create", entityType: "extra", entityId: e.id, data });
    return { id: e.id };
  }, "createExtra");
}

export async function updateExtra(actor: Actor, id: string, patch: Partial<z.input<typeof extraSchema>>): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    const data = parse(extraSchema.partial(), patch);
    const rows = await uniqueOr("An extra with this code exists.", () => db.update(extras).set(data).where(eq(extras.id, id)).returning());
    if (!rows.length) throw new DomainError("not_found", "Extra not found.");
    await audit(db, { actorUserId: actor.id, action: "extra.update", entityType: "extra", entityId: id, data });
    return { id };
  }, "updateExtra");
}

const ruleSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    type: z.enum(["SEASONAL", "DURATION_DISCOUNT", "ONE_WAY_FEE"]),
    categoryId: uuid.nullable().optional(),
    pickupBranchId: uuid.nullable().optional(),
    returnBranchId: uuid.nullable().optional(),
    validFrom: z.coerce.date().nullable().optional(),
    validTo: z.coerce.date().nullable().optional(),
    minDays: z.number().int().min(1).max(90).nullable().optional(),
    adjustmentBp: z.number().int().min(-9000).max(30000).nullable().optional(),
    feeFils: fils.nullable().optional(),
    active: z.boolean().default(true),
  })
  .refine((r) => !(r.validFrom && r.validTo) || r.validTo > r.validFrom, "validTo must be after validFrom");
export type PricingRuleInput = z.input<typeof ruleSchema>;

export type PricingRuleRow = {
  id: string;
  name: string;
  type: "SEASONAL" | "DURATION_DISCOUNT" | "ONE_WAY_FEE";
  categoryId: string | null;
  pickupBranchId: string | null;
  returnBranchId: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  minDays: number | null;
  adjustmentBp: number | null;
  feeFils: number | null;
  active: boolean;
};

export async function listPricingRules(actor: Actor): Promise<PricingRuleRow[]> {
  guard(actor);
  const rows = await db
    .select({
      id: pricingRules.id,
      name: pricingRules.name,
      type: pricingRules.type,
      categoryId: pricingRules.categoryId,
      pickupBranchId: pricingRules.pickupBranchId,
      returnBranchId: pricingRules.returnBranchId,
      validFrom: sql<string | null>`lower(${pricingRules.validDuring})`,
      validTo: sql<string | null>`upper(${pricingRules.validDuring})`,
      minDays: pricingRules.minDays,
      adjustmentBp: pricingRules.adjustmentBp,
      feeFils: pricingRules.feeFils,
      active: pricingRules.active,
    })
    .from(pricingRules)
    .orderBy(asc(pricingRules.type), asc(pricingRules.name));
  return rows.map((r) => ({ ...r, validFrom: r.validFrom ? new Date(r.validFrom) : null, validTo: r.validTo ? new Date(r.validTo) : null }));
}

function ruleValues(d: Partial<z.output<typeof ruleSchema>>) {
  const { validFrom, validTo, ...rest } = d;
  return {
    ...rest,
    ...(validFrom !== undefined || validTo !== undefined
      ? { validDuring: validFrom && validTo ? `[${validFrom.toISOString()},${validTo.toISOString()})` : null }
      : {}),
  };
}

export async function createPricingRule(actor: Actor, input: PricingRuleInput): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    const data = parse(ruleSchema, input);
    const [r] = await db.insert(pricingRules).values(ruleValues(data) as typeof pricingRules.$inferInsert).returning();
    await audit(db, { actorUserId: actor.id, action: "pricing_rule.create", entityType: "pricing_rule", entityId: r.id, data });
    return { id: r.id };
  }, "createPricingRule");
}

export async function updatePricingRule(actor: Actor, id: string, patch: Partial<PricingRuleInput>): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    const clean = parse(
      z.object({
        name: z.string().trim().min(2).max(120).optional(),
        validFrom: z.coerce.date().nullable().optional(),
        validTo: z.coerce.date().nullable().optional(),
        minDays: z.number().int().min(1).max(90).nullable().optional(),
        adjustmentBp: z.number().int().min(-9000).max(30000).nullable().optional(),
        feeFils: fils.nullable().optional(),
        active: z.boolean().optional(),
        categoryId: uuid.nullable().optional(),
        pickupBranchId: uuid.nullable().optional(),
        returnBranchId: uuid.nullable().optional(),
      }),
      patch,
    );
    const rows = await db.update(pricingRules).set(ruleValues(clean)).where(eq(pricingRules.id, id)).returning();
    if (!rows.length) throw new DomainError("not_found", "Pricing rule not found.");
    await audit(db, { actorUserId: actor.id, action: "pricing_rule.update", entityType: "pricing_rule", entityId: id, data: clean });
    return { id };
  }, "updatePricingRule");
}

export async function deletePricingRule(actor: Actor, id: string): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    const rows = await db.delete(pricingRules).where(eq(pricingRules.id, id)).returning();
    if (!rows.length) throw new DomainError("not_found", "Pricing rule not found.");
    await audit(db, { actorUserId: actor.id, action: "pricing_rule.delete", entityType: "pricing_rule", entityId: id, data: rows[0] });
    return { id };
  }, "deletePricingRule");
}

export const VAT_RATE = { bps: VAT_RATE_BPS, editable: false as const };

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export type AdminReservationRow = {
  id: string;
  reference: string;
  status: string;
  pickupAt: Date;
  returnAt: Date;
  pickupBranchCode: string;
  returnBranchCode: string;
  vehicleName: string;
  plateNumber: string;
  customerName: string;
  customerEmail: string;
  totalFils: number;
  createdAt: Date;
};

export async function adminListReservations(
  actor: Actor,
  filters: { status?: string; branchId?: string; from?: Date; to?: Date; q?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: AdminReservationRow[]; total: number }> {
  guard(actor);
  const where = and(
    filters.status ? sql`${reservations.status}::text = ${filters.status}` : undefined,
    filters.branchId && isUuid(filters.branchId)
      ? or(eq(reservations.pickupBranchId, filters.branchId), eq(reservations.returnBranchId, filters.branchId))
      : undefined,
    filters.from ? gte(reservations.endAt, filters.from) : undefined,
    filters.to ? lte(reservations.startAt, filters.to) : undefined,
    filters.q
      ? or(
          ilike(reservations.reference, `%${filters.q}%`),
          ilike(users.email, `%${filters.q}%`),
          ilike(users.name, `%${filters.q}%`),
          ilike(vehicles.plateNumber, `%${filters.q}%`),
        )
      : undefined,
  );
  const base = db
    .select({
      r: reservations,
      vehicleName: sql<string>`${vehicles.make} || ' ' || ${vehicles.model}`,
      plateNumber: vehicles.plateNumber,
      customerName: users.name,
      customerEmail: users.email,
      pickupBranchCode: sql<string>`(select code from branches where id = ${reservations.pickupBranchId})`,
      returnBranchCode: sql<string>`(select code from branches where id = ${reservations.returnBranchId})`,
    })
    .from(reservations)
    .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
    .innerJoin(users, eq(users.id, reservations.userId))
    .where(where);
  const [rows, [{ total }]] = await Promise.all([
    base.orderBy(desc(reservations.startAt)).limit(Math.min(filters.limit ?? 50, 200)).offset(filters.offset ?? 0),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(reservations)
      .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
      .innerJoin(users, eq(users.id, reservations.userId))
      .where(where),
  ]);
  return {
    total: Number(total),
    rows: rows.map((x) => ({
      id: x.r.id,
      reference: x.r.reference,
      status: x.r.status,
      pickupAt: x.r.startAt,
      returnAt: x.r.endAt,
      pickupBranchCode: x.pickupBranchCode,
      returnBranchCode: x.returnBranchCode,
      vehicleName: x.vehicleName,
      plateNumber: x.plateNumber,
      customerName: x.customerName,
      customerEmail: x.customerEmail,
      totalFils: x.r.totalFils,
      createdAt: x.r.createdAt,
    })),
  };
}

export type AdminReservationDetail = ReservationDetail & {
  customer: { id: string; name: string; email: string; phone: string | null };
  licenceFileUrl: string | null;
  damageReports: { id: string; severity: string; status: string; description: string; chargedFils: number; imageUrls: string[] }[];
};

export async function adminGetReservation(actor: Actor, id: string): Promise<AdminReservationDetail | null> {
  guard(actor);
  const r = await loadReservationDetail(id);
  if (!r) return null;
  const [u] = await db.select().from(users).where(eq(users.id, r.userId));
  const [profile] = await db.execute(sql`select licence_file_key as key from driver_profiles where user_id = ${r.userId}::uuid`).then((x) => x.rows as { key: string | null }[]);
  const reports = await db.select().from(damageReports).where(eq(damageReports.reservationId, r.id)).orderBy(asc(damageReports.createdAt));
  return {
    ...r,
    vehicle: { ...r.vehicle, plateNumber: r.vehicle.plateNumber ?? (await plateOf(r.vehicle.id)) },
    customer: { id: u.id, name: u.name, email: u.email, phone: u.phone },
    licenceFileUrl: profile?.key ? `/api/files/${profile.key}` : null,
    damageReports: reports.map((d) => ({
      id: d.id,
      severity: d.severity,
      status: d.status,
      description: d.description,
      chargedFils: d.chargedFils,
      imageUrls: d.imageKeys.map((k) => `/api/files/${k}`),
    })),
  };
}

async function plateOf(vehicleId: string) {
  const [v] = await db.select({ p: vehicles.plateNumber }).from(vehicles).where(eq(vehicles.id, vehicleId));
  return v?.p ?? null;
}

/** Admin cancellation; `feeFils` overrides the policy fee (0 = full refund). */
export async function adminCancelReservation(actor: Actor, id: string, opts: { feeFils?: number; reason?: string } = {}) {
  guard(actor);
  const [r] = await db.select({ userId: reservations.userId }).from(reservations).where(eq(reservations.id, id));
  if (!r) return { ok: false as const, code: "not_found" as const, message: "Reservation not found." };
  return cancelReservation(r.userId, id, {
    actorUserId: actor.id,
    reason: opts.reason ?? "Cancelled by DriveEasy",
    overrideFeeFils: opts.feeFils ?? undefined,
  });
}

// ---------------------------------------------------------------------------
// Check-out (pick-up) and check-in (return)
// ---------------------------------------------------------------------------

const checkOutSchema = z.object({
  mileageKm: z.number().int().min(0).max(2_000_000),
  fuelEighths: z.number().int().min(0).max(8),
  notes: z.string().max(2000).optional(),
});
export type CheckOutInput = z.input<typeof checkOutSchema>;

/** Earliest check-out before the booked pick-up time. */
export const EARLY_CHECKOUT_HOURS = 2;

/**
 * Hands the car over: CONFIRMED -> PICKED_UP, creates the rental agreement with pick-up
 * mileage and fuel, vehicle -> ON_RENT. Requires an authorised deposit (if any).
 */
export async function checkOut(actor: Actor, reservationId: string, input: CheckOutInput, opts: { now?: Date } = {}): Promise<Result<{ agreementNumber: string }>> {
  return toResult(async () => {
    guard(actor);
    const d = parse(checkOutSchema, input);
    const now = opts.now ?? new Date();
    return db.transaction(async (tx) => {
      const [r] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).for("update");
      if (!r) throw new DomainError("not_found", "Reservation not found.");
      if (r.status !== "CONFIRMED") throw new DomainError("invalid_state", `Cannot check out a ${r.status} reservation.`);
      if (now.getTime() < r.startAt.getTime() - EARLY_CHECKOUT_HOURS * 3_600_000) {
        throw new DomainError("invalid_state", `Check-out opens ${EARLY_CHECKOUT_HOURS} hours before the pick-up time.`);
      }
      if (r.depositFils > 0) {
        const [dep] = await tx.select({ id: deposits.id }).from(deposits).where(and(eq(deposits.reservationId, r.id), eq(deposits.status, "AUTHORIZED")));
        if (!dep) throw new DomainError("invalid_state", "No authorised deposit for this reservation.");
      }
      const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, r.vehicleId)).for("update");
      if (v.status === "ON_RENT") throw new DomainError("invalid_state", "This vehicle is still on another rental.");
      if (d.mileageKm < v.mileageKm) throw new DomainError("validation", `Mileage cannot be lower than the recorded ${v.mileageKm} km.`);
      const agreementNumber = `RA-${r.reference.slice(3)}`;
      await tx.insert(rentalAgreements).values({
        reservationId: r.id,
        agreementNumber,
        checkedOutBy: actor.id,
        pickupAt: now,
        pickupMileageKm: d.mileageKm,
        pickupFuelEighths: d.fuelEighths,
        pickupNotes: d.notes ?? null,
      });
      await tx.update(reservations).set({ status: "PICKED_UP", pickedUpAt: now }).where(eq(reservations.id, r.id));
      await tx.update(vehicles).set({ status: "ON_RENT", mileageKm: d.mileageKm }).where(eq(vehicles.id, v.id));
      await audit(tx, { actorUserId: actor.id, action: "reservation.check_out", entityType: "reservation", entityId: r.id, data: d });
      log.info("checked out", { reservationId: r.id, agreementNumber });
      return { agreementNumber };
    });
  }, "checkOut");
}

const checkInSchema = z.object({
  mileageKm: z.number().int().min(0).max(2_000_000),
  fuelEighths: z.number().int().min(0).max(8),
  returnedAt: z.coerce.date().optional(),
  returnBranchId: uuid.optional(),
  notes: z.string().max(2000).optional(),
});
export type CheckInInput = z.input<typeof checkInSchema>;

export type CheckInResult = {
  lateMinutes: number;
  lateFeeFils: number;
  fuelChargeFils: number;
  damageChargeFils: number;
  vatFils: number;
  totalChargesFils: number;
  depositCapturedFils: number;
  outstandingFils: number;
  settlementError?: string;
};

/**
 * Takes the car back: PICKED_UP -> RETURNED. Records return mileage/fuel, computes the
 * late-return fee, refuelling charge and damage charges (sum of chargedFils on this
 * reservation's damage reports), adds VAT, then captures that amount from the deposit
 * (releasing the rest) or releases the deposit when nothing is owed. Anything above the
 * deposit is recorded as outstanding. Vehicle -> AVAILABLE at the return branch.
 */
export async function checkIn(actor: Actor, reservationId: string, input: CheckInInput, opts: { now?: Date } = {}): Promise<Result<CheckInResult>> {
  return toResult(async () => {
    guard(actor);
    const d = parse(checkInSchema, input);
    const returnedAt = d.returnedAt ?? opts.now ?? new Date();
    const computed = await db.transaction(async (tx) => {
      const [r] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).for("update");
      if (!r) throw new DomainError("not_found", "Reservation not found.");
      if (r.status !== "PICKED_UP") throw new DomainError("invalid_state", `Cannot check in a ${r.status} reservation.`);
      const [a] = await tx.select().from(rentalAgreements).where(eq(rentalAgreements.reservationId, r.id)).for("update");
      if (returnedAt <= a.pickupAt) throw new DomainError("validation", "Return time must be after the pick-up time.");
      if (d.mileageKm < a.pickupMileageKm) throw new DomainError("validation", `Mileage cannot be lower than at pick-up (${a.pickupMileageKm} km).`);
      const returnBranchId = d.returnBranchId ?? r.returnBranchId;
      const late = computeLateCharge(r.endAt, returnedAt, r.dailyRateFils);
      const fuelChargeFils = computeFuelCharge(a.pickupFuelEighths, d.fuelEighths);
      const [{ damage }] = await tx
        .select({ damage: sql<number>`coalesce(sum(${damageReports.chargedFils}), 0)::int` })
        .from(damageReports)
        .where(eq(damageReports.reservationId, r.id));
      const damageChargeFils = Number(damage);
      const net = late.feeFils + fuelChargeFils + damageChargeFils;
      const vatFils = bp(net, r.vatRateBps);
      await tx
        .update(rentalAgreements)
        .set({
          checkedInBy: actor.id,
          returnAt: returnedAt,
          returnBranchId,
          returnMileageKm: d.mileageKm,
          returnFuelEighths: d.fuelEighths,
          returnNotes: d.notes ?? null,
          lateMinutes: late.lateMinutes,
          lateFeeFils: late.feeFils,
          fuelChargeFils,
          damageChargeFils,
          extraChargesVatFils: vatFils,
        })
        .where(eq(rentalAgreements.id, a.id));
      await tx.update(reservations).set({ status: "RETURNED", returnedAt }).where(eq(reservations.id, r.id));
      await tx.update(vehicles).set({ status: "AVAILABLE", mileageKm: d.mileageKm, branchId: returnBranchId }).where(eq(vehicles.id, r.vehicleId));
      await audit(tx, {
        actorUserId: actor.id,
        action: "reservation.check_in",
        entityType: "reservation",
        entityId: r.id,
        data: { ...d, lateMinutes: late.lateMinutes, lateFeeFils: late.feeFils, fuelChargeFils, damageChargeFils, vatFils },
      });
      return { agreementId: a.id, lateMinutes: late.lateMinutes, lateFeeFils: late.feeFils, fuelChargeFils, damageChargeFils, vatFils, total: net + vatFils };
    });

    // Deposit settlement (outside the transaction: provider call).
    const [dep] = await db.select().from(deposits).where(and(eq(deposits.reservationId, reservationId), eq(deposits.status, "AUTHORIZED")));
    let captured = 0;
    let settlementError: string | undefined;
    try {
      if (dep && computed.total > 0) {
        captured = Math.min(computed.total, dep.amountFils);
        await captureDepositRow(dep, captured, "Return charges");
      } else if (dep) {
        await releaseDepositRow(dep);
      }
    } catch (err) {
      captured = 0;
      settlementError = (err as Error).message;
      log.error("deposit settlement on check-in failed", { reservationId, err });
    }
    const outstanding = computed.total - captured;
    await db.update(rentalAgreements).set({ depositCapturedFils: captured, outstandingFils: outstanding }).where(eq(rentalAgreements.id, computed.agreementId));
    return {
      lateMinutes: computed.lateMinutes,
      lateFeeFils: computed.lateFeeFils,
      fuelChargeFils: computed.fuelChargeFils,
      damageChargeFils: computed.damageChargeFils,
      vatFils: computed.vatFils,
      totalChargesFils: computed.total,
      depositCapturedFils: captured,
      outstandingFils: outstanding,
      ...(settlementError ? { settlementError } : {}),
    };
  }, "checkIn");
}

// ---------------------------------------------------------------------------
// Damage reports
// ---------------------------------------------------------------------------

const damageSchema = z.object({
  vehicleId: uuid,
  reservationId: uuid.nullable().optional(),
  stage: z.enum(["PICKUP", "RETURN", "OTHER"]).default("OTHER"),
  severity: z.enum(["MINOR", "MODERATE", "MAJOR"]),
  description: z.string().trim().min(3).max(4000),
  estimatedCostFils: fils.nullable().optional(),
  /** Amount to charge the customer (net of VAT); counted at check-in. */
  chargedFils: fils.default(0),
});
export type DamageReportInput = z.input<typeof damageSchema> & { photos?: UploadFile[] };

export type DamageReportRow = {
  id: string;
  vehicleId: string;
  vehicleName: string;
  plateNumber: string;
  reservationId: string | null;
  reservationReference: string | null;
  stage: string;
  severity: string;
  status: string;
  description: string;
  estimatedCostFils: number | null;
  chargedFils: number;
  imageUrls: string[];
  createdAt: Date;
};

export async function listDamageReports(actor: Actor, filters: { vehicleId?: string; reservationId?: string; status?: string } = {}): Promise<DamageReportRow[]> {
  guard(actor);
  const rows = await db
    .select({ d: damageReports, vehicleName: sql<string>`${vehicles.make} || ' ' || ${vehicles.model}`, plateNumber: vehicles.plateNumber, reference: reservations.reference })
    .from(damageReports)
    .innerJoin(vehicles, eq(vehicles.id, damageReports.vehicleId))
    .leftJoin(reservations, eq(reservations.id, damageReports.reservationId))
    .where(
      and(
        filters.vehicleId && isUuid(filters.vehicleId) ? eq(damageReports.vehicleId, filters.vehicleId) : undefined,
        filters.reservationId && isUuid(filters.reservationId) ? eq(damageReports.reservationId, filters.reservationId) : undefined,
        filters.status ? sql`${damageReports.status}::text = ${filters.status}` : undefined,
      ),
    )
    .orderBy(desc(damageReports.createdAt));
  return rows.map(({ d, vehicleName, plateNumber, reference }) => ({
    id: d.id,
    vehicleId: d.vehicleId,
    vehicleName,
    plateNumber,
    reservationId: d.reservationId,
    reservationReference: reference,
    stage: d.stage,
    severity: d.severity,
    status: d.status,
    description: d.description,
    estimatedCostFils: d.estimatedCostFils,
    chargedFils: d.chargedFils,
    imageUrls: d.imageKeys.map((k) => `/api/files/${k}`),
    createdAt: d.createdAt,
  }));
}

/** Creates a damage report with private photos (max 10; JPEG/PNG/WebP, 5 MB each). */
export async function createDamageReport(actor: Actor, input: DamageReportInput): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    const { photos = [], ...rest } = input;
    const data = parse(damageSchema, rest);
    if (photos.length > 10) throw new DomainError("validation", "At most 10 photos per report.");
    if (data.reservationId) {
      const [r] = await db.select({ vehicleId: reservations.vehicleId }).from(reservations).where(eq(reservations.id, data.reservationId));
      if (!r || r.vehicleId !== data.vehicleId) throw new DomainError("validation", "The reservation does not belong to this vehicle.");
    }
    const [report] = await db
      .insert(damageReports)
      .values({ ...data, reportedBy: actor.id, status: data.chargedFils > 0 ? "CHARGED" : "OPEN" })
      .returning();
    const keys: string[] = [];
    try {
      for (const p of photos) keys.push(await storeDamageImage(report.id, p));
    } catch (err) {
      await db.delete(damageReports).where(eq(damageReports.id, report.id));
      throw err;
    }
    if (keys.length) await db.update(damageReports).set({ imageKeys: keys }).where(eq(damageReports.id, report.id));
    await audit(db, { actorUserId: actor.id, action: "damage_report.create", entityType: "damage_report", entityId: report.id, data: { ...data, photos: keys.length } });
    return { id: report.id };
  }, "createDamageReport");
}

export async function updateDamageReport(
  actor: Actor,
  id: string,
  patch: { status?: "OPEN" | "CHARGED" | "RESOLVED"; chargedFils?: number; estimatedCostFils?: number | null; description?: string; photos?: UploadFile[] },
): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    const data = parse(
      z.object({
        status: z.enum(["OPEN", "CHARGED", "RESOLVED"]).optional(),
        chargedFils: fils.optional(),
        estimatedCostFils: fils.nullable().optional(),
        description: z.string().trim().min(3).max(4000).optional(),
      }),
      { ...patch, photos: undefined },
    );
    const [cur] = await db.select().from(damageReports).where(eq(damageReports.id, id));
    if (!cur) throw new DomainError("not_found", "Damage report not found.");
    const newKeys: string[] = [];
    for (const p of patch.photos ?? []) newKeys.push(await storeDamageImage(id, p));
    await db
      .update(damageReports)
      .set({
        ...data,
        ...(newKeys.length ? { imageKeys: [...cur.imageKeys, ...newKeys] } : {}),
        ...(data.status === "RESOLVED" ? { resolvedAt: new Date() } : {}),
      })
      .where(eq(damageReports.id, id));
    await audit(db, { actorUserId: actor.id, action: "damage_report.update", entityType: "damage_report", entityId: id, data: { ...data, photosAdded: newKeys.length } });
    return { id };
  }, "updateDamageReport");
}

// ---------------------------------------------------------------------------
// Maintenance blocks
// ---------------------------------------------------------------------------

export async function listMaintenanceBlocks(actor: Actor, filters: { vehicleId?: string; includeCancelled?: boolean } = {}) {
  guard(actor);
  return db
    .select({
      id: maintenanceBlocks.id,
      vehicleId: maintenanceBlocks.vehicleId,
      vehicleName: sql<string>`${vehicles.make} || ' ' || ${vehicles.model}`,
      plateNumber: vehicles.plateNumber,
      startAt: maintenanceBlocks.startAt,
      endAt: maintenanceBlocks.endAt,
      reason: maintenanceBlocks.reason,
      cancelledAt: maintenanceBlocks.cancelledAt,
    })
    .from(maintenanceBlocks)
    .innerJoin(vehicles, eq(vehicles.id, maintenanceBlocks.vehicleId))
    .where(
      and(
        filters.vehicleId && isUuid(filters.vehicleId) ? eq(maintenanceBlocks.vehicleId, filters.vehicleId) : undefined,
        filters.includeCancelled ? undefined : sql`${maintenanceBlocks.cancelledAt} is null`,
      ),
    )
    .orderBy(asc(maintenanceBlocks.startAt));
}

/** Blocks a vehicle for maintenance. Fails with "unavailable" if it overlaps an active reservation or block. */
export async function createMaintenanceBlock(actor: Actor, input: { vehicleId: string; startAt: Date; endAt: Date; reason: string }): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    const d = parse(
      z.object({ vehicleId: uuid, startAt: z.coerce.date(), endAt: z.coerce.date(), reason: z.string().trim().min(3).max(500) }).refine((x) => x.endAt > x.startAt, "End must be after start"),
      input,
    );
    try {
      return await db.transaction(async (tx) => {
        await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, d.vehicleId)).for("update");
        // Expire stale holds in the way (same rule as bookings).
        await tx.execute(sql`update reservations set status = 'EXPIRED', expired_at = now()
          where vehicle_id = ${d.vehicleId}::uuid and status = 'PENDING' and hold_expires_at <= now()
            and period && tstzrange(${d.startAt.toISOString()}::timestamptz, ${d.endAt.toISOString()}::timestamptz, '[)')`);
        const [b] = await tx.insert(maintenanceBlocks).values({ ...d, createdBy: actor.id }).returning();
        await audit(tx, { actorUserId: actor.id, action: "maintenance.create", entityType: "maintenance_block", entityId: b.id, data: d });
        return { id: b.id };
      });
    } catch (err) {
      const mapped = mapDbError(err);
      if (mapped instanceof VehicleUnavailableError) throw new VehicleUnavailableError("The period overlaps an existing reservation or maintenance block.");
      throw mapped;
    }
  }, "createMaintenanceBlock");
}

export async function cancelMaintenanceBlock(actor: Actor, id: string): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    guard(actor);
    const rows = await db.update(maintenanceBlocks).set({ cancelledAt: new Date() }).where(and(eq(maintenanceBlocks.id, id), sql`${maintenanceBlocks.cancelledAt} is null`)).returning();
    if (!rows.length) throw new DomainError("not_found", "Maintenance block not found.");
    await audit(db, { actorUserId: actor.id, action: "maintenance.cancel", entityType: "maintenance_block", entityId: id });
    return { id };
  }, "cancelMaintenanceBlock");
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function listAuditLogs(actor: Actor, filters: { entityType?: string; entityId?: string; actions?: string[]; limit?: number } = {}) {
  guard(actor);
  return db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      data: auditLogs.data,
      createdAt: auditLogs.createdAt,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(
      and(
        filters.entityType ? eq(auditLogs.entityType, filters.entityType) : undefined,
        filters.entityId ? eq(auditLogs.entityId, filters.entityId) : undefined,
        filters.actions?.length ? inArray(auditLogs.action, filters.actions) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(filters.limit ?? 100, 500));
}
