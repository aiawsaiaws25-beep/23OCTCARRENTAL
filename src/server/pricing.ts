// Server-side pricing. The browser never sends prices; every amount is computed here
// from the database. Pure functions (computeQuote, computeLateCharge, ...) are exported
// for unit tests; loaders read the rules from the DB.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { branches, extras, pricingRules, vehicleCategories, vehicles, type PriceBreakdown } from "@/db/schema";
import { DomainError } from "./errors";
import {
  DAY_MS,
  FUEL_FILS_PER_EIGHTH,
  LATE_GRACE_MINUTES,
  LATE_HOURLY_BP,
  MAX_RENTAL_DAYS,
  MIN_LEAD_MINUTES,
  VAT_RATE_BPS,
} from "./policy";

export type Quote = PriceBreakdown;
export type ExtraSelection = { extraId: string; quantity: number };

export type RuleInput = {
  type: "SEASONAL" | "DURATION_DISCOUNT" | "ONE_WAY_FEE";
  categoryId: string | null;
  pickupBranchId: string | null;
  returnBranchId: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  minDays: number | null;
  adjustmentBp: number | null;
  feeFils: number | null;
};

export type ExtraInput = {
  id: string;
  code: string;
  name: string;
  pricing: "PER_DAY" | "PER_RENTAL";
  priceFils: number;
  maxPriceFils: number | null;
  maxQuantity: number;
  active: boolean;
};

export type QuoteInput = {
  startAt: Date;
  endAt: Date;
  dailyRateFils: number;
  depositFils: number;
  categoryId: string;
  pickupBranchId: string;
  returnBranchId: string;
  rules: RuleInput[];
  extras: ExtraInput[]; // catalogue rows for the selected extras
  selection: ExtraSelection[];
  vatRateBps?: number;
};

/** Basis-point percentage of an integer amount, rounded half up. */
export const bp = (amount: number, basisPoints: number) => Math.round((amount * basisPoints) / 10000) + 0; // +0 normalises -0

/** Chargeable days: each started 24 h block, minimum 1. */
export function rentalDays(startAt: Date, endAt: Date): number {
  return Math.max(1, Math.ceil((endAt.getTime() - startAt.getTime()) / DAY_MS));
}

/** Throws invalid_range for impossible or out-of-policy periods. */
export function validateRange(startAt: Date, endAt: Date, now = new Date()): void {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new DomainError("invalid_range", "Please choose valid pick-up and return times.");
  }
  if (endAt <= startAt) throw new DomainError("invalid_range", "Return must be after pick-up.");
  if (startAt.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000 - 60_000) {
    throw new DomainError("invalid_range", `Pick-up must be at least ${MIN_LEAD_MINUTES} minutes from now.`);
  }
  if (endAt.getTime() - startAt.getTime() > MAX_RENTAL_DAYS * DAY_MS) {
    throw new DomainError("invalid_range", `Rentals can be at most ${MAX_RENTAL_DAYS} days.`);
  }
}

const appliesToCategory = (r: RuleInput, categoryId: string) => r.categoryId === null || r.categoryId === categoryId;

export function oneWayFee(rules: RuleInput[], categoryId: string, pickupBranchId: string, returnBranchId: string): number {
  if (pickupBranchId === returnBranchId) return 0;
  const candidates = rules
    .filter((r) => r.type === "ONE_WAY_FEE" && appliesToCategory(r, categoryId))
    .filter(
      (r) =>
        (r.pickupBranchId === null || r.pickupBranchId === pickupBranchId) &&
        (r.returnBranchId === null || r.returnBranchId === returnBranchId),
    )
    .map((r) => ({
      fee: r.feeFils ?? 0,
      specificity: (r.pickupBranchId ? 2 : 0) + (r.returnBranchId ? 2 : 0) + (r.categoryId ? 1 : 0),
    }))
    .sort((a, b) => b.specificity - a.specificity || a.fee - b.fee);
  return candidates[0]?.fee ?? 0;
}

export function computeQuote(input: QuoteInput): Quote {
  const vatRateBps = input.vatRateBps ?? VAT_RATE_BPS;
  const days = rentalDays(input.startAt, input.endAt);
  const rate = input.dailyRateFils;

  // Per-day seasonal adjustments, keyed on the start instant of each rental day.
  const seasonal = input.rules.filter((r) => r.type === "SEASONAL" && appliesToCategory(r, input.categoryId));
  let baseFils = 0;
  for (let i = 0; i < days; i++) {
    const dayStart = input.startAt.getTime() + i * DAY_MS;
    const adj = seasonal
      .filter((r) => r.validFrom && r.validTo && dayStart >= r.validFrom.getTime() && dayStart < r.validTo.getTime())
      .reduce((sum, r) => sum + (r.adjustmentBp ?? 0), 0);
    baseFils += Math.max(0, rate + bp(rate, adj));
  }
  const seasonalAdjustmentFils = baseFils - rate * days;

  // Best single duration discount.
  const discountBp = input.rules
    .filter((r) => r.type === "DURATION_DISCOUNT" && appliesToCategory(r, input.categoryId) && days >= (r.minDays ?? Infinity))
    .reduce((best, r) => Math.min(best, r.adjustmentBp ?? 0), 0);
  const durationDiscountFils = bp(baseFils, Math.abs(discountBp));

  const byId = new Map(input.extras.map((e) => [e.id, e]));
  const extrasLines = input.selection
    .filter((s) => s.quantity > 0)
    .map((s) => {
      const extra = byId.get(s.extraId);
      if (!extra || !extra.active) throw new DomainError("validation", "One of the selected extras is not available.");
      if (!Number.isInteger(s.quantity) || s.quantity > extra.maxQuantity) {
        throw new DomainError("validation", `${extra.name}: at most ${extra.maxQuantity}.`);
      }
      const perUnit =
        extra.pricing === "PER_DAY"
          ? Math.min(extra.priceFils * days, extra.maxPriceFils ?? Number.MAX_SAFE_INTEGER)
          : extra.priceFils;
      return {
        extraId: extra.id,
        code: extra.code,
        name: extra.name,
        pricing: extra.pricing,
        quantity: s.quantity,
        unitPriceFils: extra.priceFils,
        totalFils: perUnit * s.quantity,
      };
    });
  const extrasFils = extrasLines.reduce((sum, l) => sum + l.totalFils, 0);
  const oneWayFeeFils = oneWayFee(input.rules, input.categoryId, input.pickupBranchId, input.returnBranchId);

  const subtotalFils = baseFils - durationDiscountFils + extrasFils + oneWayFeeFils;
  const vatFils = bp(subtotalFils, vatRateBps);
  return {
    days,
    dailyRateFils: rate,
    baseFils,
    seasonalAdjustmentFils,
    durationDiscountFils,
    extras: extrasLines,
    extrasFils,
    oneWayFeeFils,
    subtotalFils,
    vatRateBps,
    vatFils,
    totalFils: subtotalFils + vatFils,
    depositFils: input.depositFils,
  };
}

export type LateCharge = { lateMinutes: number; chargeableHours: number; feeFils: number };

/** Late-return fee (net of VAT). See policy.ts for the rule. */
export function computeLateCharge(plannedEnd: Date, actualReturn: Date, dailyRateFils: number): LateCharge {
  const lateMinutes = Math.max(0, Math.floor((actualReturn.getTime() - plannedEnd.getTime()) / 60_000));
  if (lateMinutes <= LATE_GRACE_MINUTES) return { lateMinutes, chargeableHours: 0, feeFils: 0 };
  const fullDays = Math.floor(lateMinutes / 1440);
  const remainderHours = Math.ceil((lateMinutes - fullDays * 1440) / 60);
  const hourly = bp(dailyRateFils, LATE_HOURLY_BP);
  const feeFils = fullDays * dailyRateFils + Math.min(remainderHours * hourly, dailyRateFils);
  return { lateMinutes, chargeableHours: fullDays * 24 + remainderHours, feeFils };
}

/** Refuelling charge (net of VAT). */
export function computeFuelCharge(pickupEighths: number, returnEighths: number): number {
  return Math.max(0, pickupEighths - returnEighths) * FUEL_FILS_PER_EIGHTH;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

export async function loadPricingRules(db: DbOrTx): Promise<RuleInput[]> {
  const rows = await db
    .select({
      type: pricingRules.type,
      categoryId: pricingRules.categoryId,
      pickupBranchId: pricingRules.pickupBranchId,
      returnBranchId: pricingRules.returnBranchId,
      validFrom: sql<string | null>`lower(${pricingRules.validDuring})`,
      validTo: sql<string | null>`upper(${pricingRules.validDuring})`,
      minDays: pricingRules.minDays,
      adjustmentBp: pricingRules.adjustmentBp,
      feeFils: pricingRules.feeFils,
    })
    .from(pricingRules)
    .where(eq(pricingRules.active, true));
  return rows.map((r) => ({
    ...r,
    validFrom: r.validFrom ? new Date(r.validFrom) : null,
    validTo: r.validTo ? new Date(r.validTo) : null,
  }));
}

export async function loadExtras(db: DbOrTx, ids: string[]): Promise<ExtraInput[]> {
  if (!ids.length) return [];
  return db
    .select({
      id: extras.id,
      code: extras.code,
      name: extras.name,
      pricing: extras.pricing,
      priceFils: extras.priceFils,
      maxPriceFils: extras.maxPriceFils,
      maxQuantity: extras.maxQuantity,
      active: extras.active,
    })
    .from(extras)
    .where(inArray(extras.id, ids));
}

export type QuoteRequest = {
  vehicleId: string;
  pickupBranchId: string;
  returnBranchId: string;
  pickupAt: Date;
  returnAt: Date;
  extras?: ExtraSelection[];
};

/** Loads vehicle, branches, rules and extras, validates, and returns the quote. Throws DomainError. */
export async function quoteFor(db: DbOrTx, req: QuoteRequest, now = new Date()) {
  validateRange(req.pickupAt, req.returnAt, now);
  const [vehicle] = await db
    .select({
      id: vehicles.id,
      branchId: vehicles.branchId,
      categoryId: vehicles.categoryId,
      status: vehicles.status,
      dailyRateFils: sql<number>`coalesce(${vehicles.dailyRateFils}, ${vehicleCategories.dailyRateFils})`,
      depositFils: vehicleCategories.depositFils,
    })
    .from(vehicles)
    .innerJoin(vehicleCategories, eq(vehicleCategories.id, vehicles.categoryId))
    .where(eq(vehicles.id, req.vehicleId));
  if (!vehicle) throw new DomainError("not_found", "Vehicle not found.");
  await assertBranchesOpen(db, req.pickupBranchId, req.returnBranchId);
  if (vehicle.branchId !== req.pickupBranchId) {
    throw new DomainError("validation", "This vehicle is not available at the selected pick-up branch.");
  }
  const selection = mergeSelection(req.extras ?? []);
  const [rules, extraRows] = await Promise.all([
    loadPricingRules(db),
    loadExtras(
      db,
      selection.map((s) => s.extraId),
    ),
  ]);
  const quote = computeQuote({
    startAt: req.pickupAt,
    endAt: req.returnAt,
    dailyRateFils: Number(vehicle.dailyRateFils),
    depositFils: vehicle.depositFils,
    categoryId: vehicle.categoryId,
    pickupBranchId: req.pickupBranchId,
    returnBranchId: req.returnBranchId,
    rules,
    extras: extraRows,
    selection,
  });
  return { vehicle, quote };
}

export async function assertBranchesOpen(db: DbOrTx, ...ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = await db
    .select({ id: branches.id, active: branches.active })
    .from(branches)
    .where(and(inArray(branches.id, unique)));
  if (rows.length !== unique.length) throw new DomainError("not_found", "Branch not found.");
  if (rows.some((r) => !r.active)) throw new DomainError("branch_closed", "The selected branch is currently closed.");
}

function mergeSelection(selection: ExtraSelection[]): ExtraSelection[] {
  const map = new Map<string, number>();
  for (const s of selection) {
    if (!Number.isInteger(s.quantity) || s.quantity < 0) throw new DomainError("validation", "Invalid extra quantity.");
    map.set(s.extraId, (map.get(s.extraId) ?? 0) + s.quantity);
  }
  return [...map].filter(([, q]) => q > 0).map(([extraId, quantity]) => ({ extraId, quantity }));
}
