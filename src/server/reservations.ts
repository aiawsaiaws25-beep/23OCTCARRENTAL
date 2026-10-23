import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import type { Tx } from "@/db/client";
import {
  branches,
  driverProfiles,
  payments,
  rentalAgreements,
  reservationExtras,
  reservations,
  vehicleCategories,
  vehicles,
  type Reservation,
} from "@/db/schema";
import { audit } from "./audit";
import { isUuid, isVehicleFree } from "./catalog";
import { DomainError, isUniqueViolation, mapDbError, pgCode, pgConstraint, toResult, VehicleUnavailableError, type Result } from "./errors";
import { logger } from "./logger";
import {
  chargeAdditional,
  paymentSummary,
  refundPaymentRow,
  settleReservationMoney,
  type PayInput,
} from "./payments";
import { CANCELLATION_POLICY, HOLD_MINUTES, MIN_DRIVER_AGE } from "./policy";
import { quoteFor, type ExtraSelection, type Quote } from "./pricing";

const log = logger.child({ module: "reservations" });

// ---------------------------------------------------------------------------
// Create (temporary hold)
// ---------------------------------------------------------------------------

export type CreateHoldInput = {
  userId: string;
  vehicleId: string;
  pickupBranchId: string;
  returnBranchId: string;
  pickupAt: Date;
  returnAt: Date;
  extras?: ExtraSelection[];
  /** Client-generated per booking attempt (e.g. crypto.randomUUID()). Same key => same reservation. */
  idempotencyKey: string;
};

export type HoldCreated = {
  reservationId: string;
  reference: string;
  holdExpiresAt: Date;
  quote: Quote;
  /** true when this call returned an existing reservation for the same idempotency key */
  existing: boolean;
};

/**
 * The reservation transaction:
 *   BEGIN
 *   SELECT ... FROM vehicles WHERE id = $1 FOR UPDATE      -- serialises bookings per vehicle
 *   expire stale PENDING holds on this vehicle that overlap -- lazy hold release
 *   check no overlapping active reservation / maintenance  -- friendly "unavailable" error
 *   price on the server (rate, seasonal, duration discount, extras, one-way fee, VAT, deposit)
 *   INSERT reservation (PENDING, hold_expires_at = now + HOLD_MINUTES) + extras
 *   COMMIT
 * The occupancy exclusion constraint is the last line of defence: a 23P01 maps to the
 * same VehicleUnavailableError. Deadlocks/serialisation failures are retried.
 */
export async function createReservationHold(input: CreateHoldInput, opts: { now?: Date } = {}): Promise<Result<HoldCreated>> {
  return toResult(async () => {
    const now = opts.now ?? new Date();
    if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200) {
      throw new DomainError("validation", "A valid idempotency key is required.");
    }
    if (!isUuid(input.vehicleId) || !isUuid(input.pickupBranchId) || !isUuid(input.returnBranchId)) {
      throw new DomainError("not_found", "Vehicle or branch not found.");
    }
    const prior = await findByIdempotencyKey(input.userId, input.idempotencyKey);
    if (prior) return prior;

    for (let attempt = 1; ; attempt++) {
      try {
        return await db.transaction((tx) => createInTx(tx, input, now));
      } catch (err) {
        const code = pgCode(err);
        if (isUniqueViolation(err) && pgConstraint(err) === "reservations_user_idem_uq") {
          const again = await findByIdempotencyKey(input.userId, input.idempotencyKey);
          if (again) return again;
        }
        const retryable = code === "40P01" || code === "40001" || (isUniqueViolation(err) && pgConstraint(err) === "reservations_reference_unique");
        if (retryable && attempt < 4) {
          log.warn("retrying reservation transaction", { attempt, code });
          continue;
        }
        if (code === "40P01" || code === "40001") throw new VehicleUnavailableError();
        throw mapDbError(err);
      }
    }
  }, "createReservationHold");
}

async function createInTx(tx: Tx, input: CreateHoldInput, now: Date): Promise<HoldCreated> {
  const [vehicle] = await tx
    .select({ id: vehicles.id, status: vehicles.status })
    .from(vehicles)
    .where(eq(vehicles.id, input.vehicleId))
    .for("update");
  if (!vehicle) throw new DomainError("not_found", "Vehicle not found.");
  if (vehicle.status === "RETIRED" || vehicle.status === "MAINTENANCE") throw new VehicleUnavailableError("This vehicle is not available for booking.");

  // A concurrent request with the same idempotency key may have committed while we waited for the lock.
  const sibling = await findByIdempotencyKey(input.userId, input.idempotencyKey, tx);
  if (sibling) return sibling;

  const { quote } = await quoteFor(tx, { ...input, extras: input.extras ?? [] }, now);

  // Lazily expire stale holds on this (locked) vehicle that overlap the requested period.
  const stale = await tx
    .update(reservations)
    .set({ status: "EXPIRED", expiredAt: now })
    .where(
      and(
        eq(reservations.vehicleId, input.vehicleId),
        eq(reservations.status, "PENDING"),
        lte(reservations.holdExpiresAt, now),
        sql`${reservations.period} && tstzrange(${input.pickupAt.toISOString()}::timestamptz, ${input.returnAt.toISOString()}::timestamptz, '[)')`,
      ),
    )
    .returning({ id: reservations.id });
  if (stale.length) log.info("expired stale holds", { vehicleId: input.vehicleId, ids: stale.map((s) => s.id) });

  if (!(await isVehicleFree(tx, input.vehicleId, input.pickupAt, input.returnAt))) throw new VehicleUnavailableError();

  const [profile] = await tx.select().from(driverProfiles).where(eq(driverProfiles.userId, input.userId));
  const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);
  const [r] = await tx
    .insert(reservations)
    .values({
      reference: newReference(),
      userId: input.userId,
      vehicleId: input.vehicleId,
      pickupBranchId: input.pickupBranchId,
      returnBranchId: input.returnBranchId,
      startAt: input.pickupAt,
      endAt: input.returnAt,
      status: "PENDING",
      holdExpiresAt,
      idempotencyKey: input.idempotencyKey,
      ...priceColumns(quote),
      ...(profile ? driverSnapshot(profile) : {}),
    })
    .returning();
  await replaceExtras(tx, r.id, quote);
  await audit(tx, { actorUserId: input.userId, action: "reservation.hold", entityType: "reservation", entityId: r.id, data: { totalFils: quote.totalFils } });
  log.info("hold created", { reservationId: r.id, vehicleId: input.vehicleId, holdExpiresAt });
  return { reservationId: r.id, reference: r.reference, holdExpiresAt, quote, existing: false };
}

async function findByIdempotencyKey(userId: string, key: string, conn: Tx | typeof db = db): Promise<HoldCreated | null> {
  const [r] = await conn
    .select()
    .from(reservations)
    .where(and(eq(reservations.userId, userId), eq(reservations.idempotencyKey, key)));
  if (!r) return null;
  return { reservationId: r.id, reference: r.reference, holdExpiresAt: r.holdExpiresAt ?? r.createdAt, quote: r.priceBreakdown, existing: true };
}

function priceColumns(q: Quote) {
  return {
    days: q.days,
    dailyRateFils: q.dailyRateFils,
    baseFils: q.baseFils,
    extrasFils: q.extrasFils,
    oneWayFeeFils: q.oneWayFeeFils,
    discountFils: q.durationDiscountFils,
    subtotalFils: q.subtotalFils,
    vatRateBps: q.vatRateBps,
    vatFils: q.vatFils,
    totalFils: q.totalFils,
    depositFils: q.depositFils,
    priceBreakdown: q,
  };
}

async function replaceExtras(tx: Tx, reservationId: string, q: Quote) {
  await tx.delete(reservationExtras).where(eq(reservationExtras.reservationId, reservationId));
  if (!q.extras.length) return;
  await tx.insert(reservationExtras).values(
    q.extras.map((l) => ({
      reservationId,
      extraId: l.extraId,
      quantity: l.quantity,
      unitPriceFils: l.unitPriceFils,
      pricing: l.pricing,
      totalFils: l.totalFils,
    })),
  );
}

function driverSnapshot(p: typeof driverProfiles.$inferSelect) {
  return {
    driverName: p.fullName,
    driverEmail: p.email,
    driverPhone: p.phone,
    driverDateOfBirth: p.dateOfBirth,
    driverLicenceNumber: p.licenceNumber,
    driverLicenceCountry: p.licenceCountry,
    driverLicenceExpiresOn: p.licenceExpiresOn,
  };
}

function newReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return "DE-" + Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join("");
}

// ---------------------------------------------------------------------------
// Driver details
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const driverDetailsSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.email().max(200),
  phone: z.string().trim().min(6).max(30),
  dateOfBirth: isoDate,
  licenceNumber: z.string().trim().min(3).max(40),
  licenceCountry: z.string().trim().min(2).max(60),
  licenceExpiry: isoDate,
  nationality: z.string().trim().max(60).optional(),
  licenceIssuedOn: isoDate.optional(),
});
export type DriverDetailsInput = z.input<typeof driverDetailsSchema>;

/**
 * Saves the driver's details to the user's profile and snapshots them on the reservation
 * (PENDING or CONFIRMED, before pick-up). Driver must be MIN_DRIVER_AGE at pick-up and the
 * licence must be valid until the return date.
 */
export async function saveDriverDetails(userId: string, reservationId: string, input: DriverDetailsInput): Promise<Result<{ saved: true }>> {
  return toResult(async () => {
    const parsed = driverDetailsSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError("validation", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    const d = parsed.data;
    const r = await loadOwned(userId, reservationId);
    if (!["PENDING", "CONFIRMED"].includes(r.status)) throw new DomainError("invalid_state", "This reservation can no longer be changed.");
    const ageAtPickup = yearsBetween(new Date(`${d.dateOfBirth}T00:00:00Z`), r.startAt);
    if (ageAtPickup < MIN_DRIVER_AGE) throw new DomainError("validation", `The driver must be at least ${MIN_DRIVER_AGE} years old at pick-up.`);
    if (new Date(`${d.licenceExpiry}T23:59:59Z`) < r.endAt) throw new DomainError("validation", "The driving licence must be valid until the return date.");
    await db.transaction(async (tx) => {
      const values = {
        fullName: d.fullName,
        email: d.email,
        phone: d.phone,
        dateOfBirth: d.dateOfBirth,
        nationality: d.nationality ?? null,
        licenceNumber: d.licenceNumber,
        licenceCountry: d.licenceCountry,
        licenceIssuedOn: d.licenceIssuedOn ?? null,
        licenceExpiresOn: d.licenceExpiry,
      };
      const [p] = await tx
        .insert(driverProfiles)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: driverProfiles.userId, set: values })
        .returning();
      await tx.update(reservations).set(driverSnapshot(p)).where(eq(reservations.id, r.id));
    });
    return { saved: true as const };
  }, "saveDriverDetails");
}

function yearsBetween(from: Date, to: Date) {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const m = to.getUTCMonth() - from.getUTCMonth();
  if (m < 0 || (m === 0 && to.getUTCDate() < from.getUTCDate())) years--;
  return years;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type ReservationDetail = {
  id: string;
  reference: string;
  userId: string;
  status: Reservation["status"];
  holdExpiresAt: Date | null;
  pickupAt: Date;
  returnAt: Date;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  pickupBranch: { id: string; code: string; name: string; address: string; phone: string; timeZone: string; openingHours: string };
  returnBranch: { id: string; code: string; name: string; address: string; phone: string; timeZone: string; openingHours: string };
  vehicle: {
    id: string;
    slug: string;
    make: string;
    model: string;
    year: number;
    categoryName: string;
    transmission: string;
    fuelType: string;
    seats: number;
    imageUrl: string | null;
    /** Only revealed once confirmed. */
    plateNumber: string | null;
  };
  quote: Quote;
  extras: { extraId: string; name: string; quantity: number; totalFils: number }[];
  driver: {
    fullName: string;
    email: string | null;
    phone: string | null;
    dateOfBirth: string | null;
    licenceNumber: string;
    licenceCountry: string | null;
    licenceExpiry: string | null;
  } | null;
  hasLicence: boolean;
  payment: { status: string; amountFils: number; refundedFils: number; failureReason: string | null } | null;
  deposit: { status: string; amountFils: number; capturedFils: number; failureReason: string | null } | null;
  refundedFils: number;
  cancellationFeeFils: number | null;
  agreement: {
    agreementNumber: string;
    pickupAt: Date;
    pickupMileageKm: number;
    pickupFuelEighths: number;
    returnAt: Date | null;
    returnMileageKm: number | null;
    returnFuelEighths: number | null;
    lateMinutes: number;
    lateFeeFils: number;
    fuelChargeFils: number;
    damageChargeFils: number;
    extraChargesVatFils: number;
    depositCapturedFils: number;
    outstandingFils: number;
  } | null;
};

export async function loadReservationDetail(id: string): Promise<ReservationDetail | null> {
  if (!isUuid(id)) return null;
  const [r] = await db.select().from(reservations).where(eq(reservations.id, id));
  if (!r) return null;
  const branchRows = await db
    .select({
      id: branches.id,
      code: branches.code,
      name: branches.name,
      address: branches.address,
      phone: branches.phone,
      timeZone: branches.timeZone,
      openingHours: branches.openingHours,
    })
    .from(branches)
    .where(inArray(branches.id, [r.pickupBranchId, r.returnBranchId]));
  const [v] = await db
    .select({ v: vehicles, categoryName: vehicleCategories.name })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(eq(vehicles.id, r.vehicleId));
  const [profile] = await db
    .select({ key: driverProfiles.licenceFileKey })
    .from(driverProfiles)
    .where(eq(driverProfiles.userId, r.userId));
  const [agreement] = await db.select().from(rentalAgreements).where(eq(rentalAgreements.reservationId, r.id));
  const money = await paymentSummary(r.id);
  const revealed = ["CONFIRMED", "PICKED_UP", "RETURNED"].includes(r.status);
  return {
    id: r.id,
    reference: r.reference,
    userId: r.userId,
    status: r.status,
    holdExpiresAt: r.status === "PENDING" ? r.holdExpiresAt : null,
    pickupAt: r.startAt,
    returnAt: r.endAt,
    createdAt: r.createdAt,
    confirmedAt: r.confirmedAt,
    cancelledAt: r.cancelledAt,
    pickupBranch: branchRows.find((b) => b.id === r.pickupBranchId)!,
    returnBranch: branchRows.find((b) => b.id === r.returnBranchId)!,
    vehicle: {
      id: v.v.id,
      slug: v.v.slug,
      make: v.v.make,
      model: v.v.model,
      year: v.v.year,
      categoryName: v.categoryName,
      transmission: v.v.transmission,
      fuelType: v.v.fuelType,
      seats: v.v.seats,
      imageUrl: v.v.images[0] ?? null,
      plateNumber: revealed ? v.v.plateNumber : null,
    },
    quote: r.priceBreakdown,
    extras: r.priceBreakdown.extras.map((e) => ({ extraId: e.extraId, name: e.name, quantity: e.quantity, totalFils: e.totalFils })),
    driver: r.driverName
      ? {
          fullName: r.driverName,
          email: r.driverEmail,
          phone: r.driverPhone,
          dateOfBirth: r.driverDateOfBirth,
          licenceNumber: r.driverLicenceNumber ?? "",
          licenceCountry: r.driverLicenceCountry,
          licenceExpiry: r.driverLicenceExpiresOn,
        }
      : null,
    hasLicence: Boolean(profile?.key),
    payment: money.payment,
    deposit: money.deposit,
    refundedFils: r.refundedFils,
    cancellationFeeFils: r.cancellationFeeFils,
    agreement: agreement
      ? {
          agreementNumber: agreement.agreementNumber,
          pickupAt: agreement.pickupAt,
          pickupMileageKm: agreement.pickupMileageKm,
          pickupFuelEighths: agreement.pickupFuelEighths,
          returnAt: agreement.returnAt,
          returnMileageKm: agreement.returnMileageKm,
          returnFuelEighths: agreement.returnFuelEighths,
          lateMinutes: agreement.lateMinutes,
          lateFeeFils: agreement.lateFeeFils,
          fuelChargeFils: agreement.fuelChargeFils,
          damageChargeFils: agreement.damageChargeFils,
          extraChargesVatFils: agreement.extraChargesVatFils,
          depositCapturedFils: agreement.depositCapturedFils,
          outstandingFils: agreement.outstandingFils,
        }
      : null,
  };
}

/** The reservation if it belongs to `userId`, else null (never reveals other users' bookings). */
export async function getReservationForUser(userId: string, id: string): Promise<ReservationDetail | null> {
  const r = await loadReservationDetail(id);
  return r && r.userId === userId ? r : null;
}

export async function getReservationByReferenceForUser(userId: string, reference: string): Promise<ReservationDetail | null> {
  const [r] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.reference, reference.toUpperCase()), eq(reservations.userId, userId)));
  return r ? loadReservationDetail(r.id) : null;
}

export type ReservationSummary = {
  id: string;
  reference: string;
  status: Reservation["status"];
  pickupAt: Date;
  returnAt: Date;
  pickupBranchName: string;
  returnBranchName: string;
  vehicleName: string;
  imageUrl: string | null;
  totalFils: number;
  holdExpiresAt: Date | null;
};

export async function listReservationsForUser(userId: string): Promise<ReservationSummary[]> {
  const rows = await db
    .select({
      r: reservations,
      vehicleName: sql<string>`${vehicles.make} || ' ' || ${vehicles.model}`,
      images: vehicles.images,
      pickupBranchName: sql<string>`(select name from branches where id = ${reservations.pickupBranchId})`,
      returnBranchName: sql<string>`(select name from branches where id = ${reservations.returnBranchId})`,
    })
    .from(reservations)
    .innerJoin(vehicles, eq(vehicles.id, reservations.vehicleId))
    .where(eq(reservations.userId, userId))
    .orderBy(desc(reservations.startAt));
  return rows.map(({ r, vehicleName, images, pickupBranchName, returnBranchName }) => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    pickupAt: r.startAt,
    returnAt: r.endAt,
    pickupBranchName,
    returnBranchName,
    vehicleName,
    imageUrl: images[0] ?? null,
    totalFils: r.totalFils,
    holdExpiresAt: r.status === "PENDING" ? r.holdExpiresAt : null,
  }));
}

async function loadOwned(userId: string, id: string): Promise<Reservation> {
  if (!isUuid(id)) throw new DomainError("not_found", "Reservation not found.");
  const [r] = await db.select().from(reservations).where(eq(reservations.id, id));
  if (!r || r.userId !== userId) throw new DomainError("not_found", "Reservation not found.");
  return r;
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export type CancellationQuote = {
  eligible: boolean;
  /** Amount that will be refunded (fils). */
  refundFils: number;
  feeFils: number;
  paidFils: number;
  reason?: string;
  policySummary: string;
};

/** Pure policy: what a cancellation of `r` at `now` would cost. See policy.ts. */
export function cancellationTerms(
  r: Pick<Reservation, "status" | "startAt" | "totalFils" | "dailyRateFils" | "vatRateBps">,
  paidFils: number,
  now = new Date(),
): CancellationQuote {
  const base = { policySummary: CANCELLATION_POLICY.summary, paidFils };
  if (r.status === "PENDING") return { ...base, eligible: true, refundFils: paidFils, feeFils: 0 };
  if (r.status !== "CONFIRMED") {
    return { ...base, eligible: false, refundFils: 0, feeFils: 0, reason: `A ${r.status.toLowerCase().replace("_", " ")} reservation cannot be cancelled.` };
  }
  const hoursBefore = (r.startAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursBefore <= 0) {
    return { ...base, eligible: false, refundFils: 0, feeFils: 0, reason: "The pick-up time has passed. Please contact the branch." };
  }
  let fee = 0;
  if (hoursBefore < CANCELLATION_POLICY.oneDayFeeHours) {
    fee = paidFils - Math.round((paidFils * CANCELLATION_POLICY.lateCancelRefundBp) / 10000);
  } else if (hoursBefore < CANCELLATION_POLICY.freeHours) {
    fee = Math.min(paidFils, r.dailyRateFils + Math.round((r.dailyRateFils * r.vatRateBps) / 10000));
  }
  fee = Math.max(0, Math.min(fee, paidFils));
  return { ...base, eligible: true, refundFils: paidFils - fee, feeFils: fee };
}

async function paidFor(reservationId: string): Promise<number> {
  const [row] = await db
    .select({ paid: sql<number>`coalesce(sum(${payments.amountFils} - ${payments.refundedFils}), 0)::int` })
    .from(payments)
    .where(and(eq(payments.reservationId, reservationId), inArray(payments.status, ["SUCCEEDED", "PARTIALLY_REFUNDED"])));
  return Number(row.paid);
}

export async function getCancellationQuote(userId: string, id: string, opts: { now?: Date } = {}): Promise<Result<CancellationQuote>> {
  return toResult(async () => {
    const r = await loadOwned(userId, id);
    return cancellationTerms(r, await paidFor(r.id), opts.now);
  }, "getCancellationQuote");
}

export type CancelResult = { status: Reservation["status"]; refundFils: number; feeFils: number };

/**
 * Customer cancellation per policy. The status change commits first (freeing the
 * vehicle), then refunds/deposit releases are settled (idempotent; the cron sweep
 * retries anything that failed).
 */
export async function cancelReservation(
  userId: string,
  id: string,
  opts: { now?: Date; reason?: string; actorUserId?: string; overrideFeeFils?: number } = {},
): Promise<Result<CancelResult>> {
  return toResult(async () => {
    const now = opts.now ?? new Date();
    const owned = await loadOwned(userId, id);
    const paid = await paidFor(owned.id);
    const terms = await db.transaction(async (tx) => {
      const [r] = await tx.select().from(reservations).where(eq(reservations.id, owned.id)).for("update");
      const t = cancellationTerms(r, paid, now);
      const allowAdmin = opts.overrideFeeFils !== undefined && ["PENDING", "CONFIRMED"].includes(r.status);
      if (!t.eligible && !allowAdmin) throw new DomainError("not_eligible", t.reason ?? "This reservation cannot be cancelled.");
      const fee = opts.overrideFeeFils !== undefined ? Math.max(0, Math.min(opts.overrideFeeFils, paid)) : t.feeFils;
      await tx
        .update(reservations)
        .set({
          status: "CANCELLED",
          cancelledAt: now,
          cancellationReason: opts.reason ?? (r.status === "PENDING" ? "Cancelled before payment" : "Cancelled by customer"),
          cancellationFeeFils: fee,
          holdExpiresAt: r.status === "PENDING" ? r.holdExpiresAt : null,
        })
        .where(eq(reservations.id, r.id));
      await audit(tx, {
        actorUserId: opts.actorUserId ?? userId,
        action: "reservation.cancel",
        entityType: "reservation",
        entityId: r.id,
        data: { feeFils: fee, paidFils: paid, previousStatus: r.status },
      });
      return { ...t, feeFils: fee, refundFils: paid - fee };
    });
    const settled = await settleReservationMoney(owned.id);
    const [after] = await db.select({ status: reservations.status }).from(reservations).where(eq(reservations.id, owned.id));
    log.info("reservation cancelled", { reservationId: owned.id, ...terms, settled });
    return { status: after.status, refundFils: terms.refundFils, feeFils: terms.feeFils };
  }, "cancelReservation");
}

/** The customer leaves checkout: release the hold now (no charge was taken, or it is refunded). */
export async function abandonCheckout(userId: string, id: string): Promise<Result<{ released: boolean }>> {
  return toResult(async () => {
    const r = await loadOwned(userId, id);
    if (r.status !== "PENDING") return { released: false };
    const res = await cancelReservation(userId, id, { reason: "Checkout abandoned" });
    if (!res.ok) throw new DomainError(res.code, res.message);
    return { released: true };
  }, "abandonCheckout");
}

// ---------------------------------------------------------------------------
// Date changes
// ---------------------------------------------------------------------------

export type DateChangeQuote = {
  available: boolean;
  newQuote: Quote;
  /** newTotal - currentTotal: > 0 will be charged, < 0 will be refunded. */
  differenceFils: number;
  message?: string;
};

export type DateChangeInput = { pickupAt: Date; returnAt: Date };

async function prepareDateChange(r: Reservation, input: DateChangeInput, now: Date) {
  if (!["PENDING", "CONFIRMED"].includes(r.status)) throw new DomainError("not_eligible", "Only upcoming reservations can be changed.");
  if (r.startAt <= now) throw new DomainError("not_eligible", "The pick-up time has passed; dates can no longer be changed online.");
  if (r.status === "PENDING" && (!r.holdExpiresAt || r.holdExpiresAt <= now)) throw new DomainError("hold_expired", "Your hold has expired. Please search again.");
  const { quote } = await quoteFor(
    db,
    {
      vehicleId: r.vehicleId,
      pickupBranchId: r.pickupBranchId,
      returnBranchId: r.returnBranchId,
      pickupAt: input.pickupAt,
      returnAt: input.returnAt,
      extras: r.priceBreakdown.extras.map((e) => ({ extraId: e.extraId, quantity: e.quantity })),
    },
    now,
  );
  return quote;
}

export async function quoteDateChange(userId: string, id: string, input: DateChangeInput, opts: { now?: Date } = {}): Promise<Result<DateChangeQuote>> {
  return toResult(async () => {
    const now = opts.now ?? new Date();
    const r = await loadOwned(userId, id);
    const newQuote = await prepareDateChange(r, input, now);
    const available = await isVehicleFree(db, r.vehicleId, input.pickupAt, input.returnAt, r.id);
    return {
      available,
      newQuote,
      differenceFils: newQuote.totalFils - r.totalFils,
      message: available ? undefined : "The vehicle is not available for the new dates.",
    };
  }, "quoteDateChange");
}

export type DateChangeResult = { reservationId: string; differenceFils: number; chargedFils: number; refundedFils: number; quote: Quote };

/**
 * Changes the dates of a PENDING or CONFIRMED reservation (same vehicle, branches, extras).
 * Re-checks availability with the vehicle row locked and re-prices on the server.
 * CONFIRMED + higher price: the difference is charged first (needs paymentMethod +
 * idempotencyKey); if the dates turn out to be unavailable it is refunded.
 * CONFIRMED + lower price: the difference is refunded after the change commits.
 */
export async function modifyReservationDates(
  userId: string,
  id: string,
  input: DateChangeInput & Partial<PayInput>,
  opts: { now?: Date } = {},
): Promise<Result<DateChangeResult>> {
  return toResult(async () => {
    const now = opts.now ?? new Date();
    const r = await loadOwned(userId, id);
    const quote = await prepareDateChange(r, input, now);
    const diff = quote.totalFils - r.totalFils;
    if (!(await isVehicleFree(db, r.vehicleId, input.pickupAt, input.returnAt, r.id))) throw new VehicleUnavailableError();

    let topUp: typeof payments.$inferSelect | null = null;
    if (r.status === "CONFIRMED" && diff > 0) {
      if (!input.idempotencyKey) throw new DomainError("validation", "Payment details are required for the price difference.");
      topUp = await chargeAdditional(r, diff, "ADJUSTMENT", { idempotencyKey: input.idempotencyKey, paymentMethod: input.paymentMethod });
      if (topUp.status !== "SUCCEEDED") throw new DomainError("payment_failed", topUp.failureReason ?? "The payment for the price difference failed.");
    }

    try {
      await db.transaction(async (tx) => {
        await tx.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, r.vehicleId)).for("update");
        const [cur] = await tx.select().from(reservations).where(eq(reservations.id, r.id)).for("update");
        if (cur.status !== r.status || cur.totalFils !== r.totalFils || cur.startAt.getTime() !== r.startAt.getTime()) {
          throw new DomainError("conflict", "The reservation changed meanwhile. Please review and try again.");
        }
        if (!(await isVehicleFree(tx, r.vehicleId, input.pickupAt, input.returnAt, r.id))) throw new VehicleUnavailableError();
        await tx
          .update(reservations)
          .set({ startAt: input.pickupAt, endAt: input.returnAt, ...priceColumns(quote) })
          .where(eq(reservations.id, r.id));
        await replaceExtras(tx, r.id, quote);
        await audit(tx, {
          actorUserId: userId,
          action: "reservation.modify_dates",
          entityType: "reservation",
          entityId: r.id,
          data: { from: { startAt: r.startAt, endAt: r.endAt }, to: input, differenceFils: diff },
        });
      });
    } catch (err) {
      if (topUp) await refundPaymentRow(topUp, topUp.amountFils).catch((e) => log.error("top-up refund failed", { err: e, paymentId: topUp!.id }));
      throw mapDbError(err);
    }

    // Decreases are refunded only when the change is made >= 48 h before the original pick-up (policy.ts).
    let refunded = 0;
    const refundable = r.startAt.getTime() - now.getTime() >= CANCELLATION_POLICY.freeHours * 3_600_000;
    if (r.status === "CONFIRMED" && diff < 0 && refundable) {
      let remaining = -diff;
      const paid = await db
        .select()
        .from(payments)
        .where(and(eq(payments.reservationId, r.id), inArray(payments.status, ["SUCCEEDED", "PARTIALLY_REFUNDED"])));
      for (const p of paid) {
        const amount = Math.min(remaining, p.amountFils - p.refundedFils);
        if (amount <= 0) continue;
        try {
          await refundPaymentRow(p, amount);
          remaining -= amount;
          refunded += amount;
        } catch (err) {
          log.error("date-change refund failed", { reservationId: r.id, paymentId: p.id, err });
        }
        if (remaining <= 0) break;
      }
      await db.update(reservations).set({ refundedFils: sql`${reservations.refundedFils} + ${refunded}` }).where(eq(reservations.id, r.id));
    }
    return { reservationId: r.id, differenceFils: diff, chargedFils: topUp?.amountFils ?? 0, refundedFils: refunded, quote };
  }, "modifyReservationDates");
}
