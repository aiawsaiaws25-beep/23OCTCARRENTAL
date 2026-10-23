import "server-only";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { deposits, paymentWebhookEvents, payments, reservations, type Deposit, type Payment } from "@/db/schema";
import {
  getPaymentProvider,
  PaymentError,
  type DepositHold,
  type Payment as ProviderPayment,
  type PaymentProvider,
  type WebhookEvent,
} from "@/lib/services/payments";
import { audit } from "./audit";
import { DomainError, isUniqueViolation, toResult, type Result } from "./errors";
import { logger } from "./logger";
import { CURRENCY, DAY_MS, DEPOSIT_HOLD_DAYS_AFTER_RETURN } from "./policy";

const log = logger.child({ module: "payments" });

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

const paymentStatusFromProvider = (s: ProviderPayment["status"]): Payment["status"] =>
  (
    ({
      pending: "PENDING",
      succeeded: "SUCCEEDED",
      failed: "FAILED",
      canceled: "CANCELLED",
      refunded: "REFUNDED",
      partially_refunded: "PARTIALLY_REFUNDED",
    }) as const
  )[s];

const depositStatusFromProvider = (s: DepositHold["status"]): Deposit["status"] =>
  (({ held: "AUTHORIZED", released: "RELEASED", captured: "CAPTURED" }) as const)[s];

/** Money rows created by the seed (provider "seed") are local records only: never sent to a provider. */
const isOffline = (row: { provider: string }, provider: PaymentProvider) => row.provider !== provider.name;

// ---------------------------------------------------------------------------
// Pay for a PENDING reservation: charge + deposit authorisation, then confirm.
// ---------------------------------------------------------------------------

export type PayOutcome =
  | { status: "confirmed"; reference: string }
  | { status: "failed"; reason: string; stage: "payment" | "deposit" }
  | { status: "expired" };

export type PayInput = {
  /** Provider payment method. Fake: "pm_fake_success" (default) | "pm_fake_declined". Stripe test: "pm_card_visa"... */
  paymentMethod?: string;
  /** One key per checkout attempt (e.g. crypto.randomUUID() rendered into the form). Re-submitting the same key never charges twice. */
  idempotencyKey: string;
};

/**
 * Charges the rental total and authorises the deposit for a PENDING reservation, then
 * confirms it. Idempotent: an already-confirmed reservation returns "confirmed"; a
 * succeeded charge is never repeated (DB unique index + provider idempotency key);
 * retrying after a decline (with a new idempotencyKey) works while the hold is valid.
 */
export async function payReservation(
  userId: string,
  reservationId: string,
  input: PayInput,
  opts: { now?: Date; provider?: PaymentProvider } = {},
): Promise<Result<PayOutcome>> {
  return toResult(async (): Promise<PayOutcome> => {
    const provider = opts.provider ?? getPaymentProvider();
    const now = opts.now ?? new Date();
    assertKey(input.idempotencyKey);
    const r = await loadOwned(userId, reservationId);

    if (r.status === "CONFIRMED" || r.status === "PICKED_UP" || r.status === "RETURNED") {
      return { status: "confirmed", reference: r.reference };
    }
    if (r.status !== "PENDING") {
      await settleReservationMoney(r.id, { provider });
      return { status: "expired" };
    }
    if (!r.holdExpiresAt || r.holdExpiresAt <= now) {
      await expireReservation(r.id, now);
      await settleReservationMoney(r.id, { provider });
      return { status: "expired" };
    }
    if (!r.driverName || !r.driverLicenceNumber) {
      throw new DomainError("validation", "Please add the driver's details before paying.");
    }

    // 1. Rental charge
    const pay = await ensureRentalPayment(r, input, provider);
    if (pay.status === "FAILED") {
      return { status: "failed", stage: "payment", reason: pay.failureReason ?? "Payment was declined." };
    }
    if (pay.status === "PENDING") {
      return { status: "failed", stage: "payment", reason: "Payment is still processing. Please try again in a moment." };
    }

    // 2. Deposit authorisation
    if (r.depositFils > 0) {
      const dep = await ensureDeposit(r, input, provider);
      if (dep.status !== "AUTHORIZED") {
        return { status: "failed", stage: "deposit", reason: dep.failureReason ?? "The deposit authorisation was declined." };
      }
    }

    // 3. Confirm (or detect that the hold was released meanwhile)
    const status = await confirmIfPaid(r.id, null);
    if (status === "CONFIRMED") return { status: "confirmed", reference: r.reference };
    await settleReservationMoney(r.id, { provider });
    return { status: "expired" };
  }, "payReservation");
}

async function loadOwned(userId: string, reservationId: string) {
  const [r] = await db.select().from(reservations).where(eq(reservations.id, reservationId));
  if (!r || r.userId !== userId) throw new DomainError("not_found", "Reservation not found.");
  return r;
}

function assertKey(key: string) {
  if (typeof key !== "string" || key.length < 8 || key.length > 200) {
    throw new DomainError("validation", "A valid idempotency key is required.");
  }
}

type ResRow = typeof reservations.$inferSelect;

async function ensureRentalPayment(r: ResRow, input: PayInput, provider: PaymentProvider): Promise<Payment> {
  const key = `rental:${r.id}:${input.idempotencyKey}`;
  // Same attempt key again: return whatever happened last time.
  const [sameKey] = await db.select().from(payments).where(eq(payments.idempotencyKey, key));
  if (sameKey && sameKey.status !== "PENDING") return sameKey;

  const [live] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, r.id), eq(payments.kind, "RENTAL"), notInArray(payments.status, ["FAILED", "CANCELLED"])));
  if (live && live.status !== "PENDING") return live; // already charged

  let row = sameKey ?? live;
  if (!row) {
    try {
      [row] = await db
        .insert(payments)
        .values({
          reservationId: r.id,
          userId: r.userId,
          kind: "RENTAL",
          status: "PENDING",
          provider: provider.name,
          idempotencyKey: key,
          currency: r.currency,
          amountFils: r.totalFils,
        })
        .returning();
    } catch (err) {
      // A concurrent request created the live payment first: use it.
      if (!isUniqueViolation(err)) throw err;
      const [existing] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.reservationId, r.id), eq(payments.kind, "RENTAL"), notInArray(payments.status, ["FAILED", "CANCELLED"])));
      if (!existing) throw err;
      row = existing;
    }
  }
  if (row.provider !== provider.name) return row;

  let result: ProviderPayment;
  try {
    result = await provider.createPayment({
      amount: row.amountFils,
      currency: row.currency,
      paymentMethod: input.paymentMethod,
      idempotencyKey: row.idempotencyKey,
      metadata: { kind: "rental", paymentRowId: row.id, reservationId: r.id, reference: r.reference },
    });
  } catch (err) {
    log.error("createPayment failed", { reservationId: r.id, paymentId: row.id, err });
    if (err instanceof PaymentError && err.code !== "provider_error") {
      const [failed] = await db
        .update(payments)
        .set({ status: "FAILED", failureReason: err.message })
        .where(and(eq(payments.id, row.id), eq(payments.status, "PENDING")))
        .returning();
      return failed ?? row;
    }
    throw new DomainError("payment_failed", "The payment provider is unavailable. Please try again.");
  }
  const [updated] = await db
    .update(payments)
    .set({
      providerPaymentId: result.id,
      status: paymentStatusFromProvider(result.status),
      refundedFils: result.refundedAmount,
      failureReason: result.failureReason ?? null,
    })
    .where(eq(payments.id, row.id))
    .returning();
  log.info("rental payment", { reservationId: r.id, paymentId: row.id, status: updated.status });
  return updated;
}

async function ensureDeposit(r: ResRow, input: PayInput, provider: PaymentProvider): Promise<Deposit> {
  const key = `deposit:${r.id}:${input.idempotencyKey}`;
  const [sameKey] = await db.select().from(deposits).where(eq(deposits.idempotencyKey, key));
  if (sameKey && sameKey.status !== "PENDING") return sameKey;
  const [live] = await db
    .select()
    .from(deposits)
    .where(and(eq(deposits.reservationId, r.id), inArray(deposits.status, ["PENDING", "AUTHORIZED"])));
  if (live?.status === "AUTHORIZED") return live;

  const expiresAt = new Date(r.endAt.getTime() + DEPOSIT_HOLD_DAYS_AFTER_RETURN * DAY_MS);
  let row = sameKey ?? live;
  if (!row) {
    try {
      [row] = await db
        .insert(deposits)
        .values({
          reservationId: r.id,
          status: "PENDING",
          provider: provider.name,
          idempotencyKey: key,
          currency: r.currency,
          amountFils: r.depositFils,
          expiresAt,
        })
        .returning();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const [existing] = await db
        .select()
        .from(deposits)
        .where(and(eq(deposits.reservationId, r.id), inArray(deposits.status, ["PENDING", "AUTHORIZED"])));
      if (!existing) throw err;
      row = existing;
    }
  }
  if (row.provider !== provider.name) return row;

  try {
    const hold = await provider.holdDeposit({
      amount: row.amountFils,
      currency: row.currency,
      expiresAt: row.expiresAt,
      paymentMethod: input.paymentMethod,
      idempotencyKey: row.idempotencyKey,
      metadata: { kind: "deposit", depositRowId: row.id, reservationId: r.id, reference: r.reference },
    });
    const [updated] = await db
      .update(deposits)
      .set({ providerHoldId: hold.id, status: depositStatusFromProvider(hold.status), authorizedAt: new Date() })
      .where(eq(deposits.id, row.id))
      .returning();
    return updated;
  } catch (err) {
    log.warn("deposit hold failed", { reservationId: r.id, depositId: row.id, err });
    if (err instanceof PaymentError && err.code !== "provider_error") {
      const [failed] = await db
        .update(deposits)
        .set({ status: "FAILED", failureReason: err.code === "declined" ? "The deposit authorisation was declined." : err.message })
        .where(eq(deposits.id, row.id))
        .returning();
      return failed;
    }
    throw new DomainError("deposit_failed", "The payment provider is unavailable. Please try again.");
  }
}

/**
 * Confirms a PENDING reservation when a SUCCEEDED rental payment covering the total and
 * (if a deposit is required) an AUTHORIZED deposit exist. Locks the reservation row.
 * Returns the resulting status.
 */
export async function confirmIfPaid(reservationId: string, actorUserId: string | null): Promise<ResRow["status"]> {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).for("update");
    if (!r) throw new DomainError("not_found", "Reservation not found.");
    if (r.status !== "PENDING") return r.status;
    const [paid] = await tx
      .select({ total: sql<number>`coalesce(sum(${payments.amountFils}), 0)::int` })
      .from(payments)
      .where(and(eq(payments.reservationId, r.id), eq(payments.kind, "RENTAL"), eq(payments.status, "SUCCEEDED")));
    const [dep] = await tx
      .select({ id: deposits.id })
      .from(deposits)
      .where(and(eq(deposits.reservationId, r.id), eq(deposits.status, "AUTHORIZED")));
    if (Number(paid.total) < r.totalFils || (r.depositFils > 0 && !dep)) return r.status;
    await tx
      .update(reservations)
      .set({ status: "CONFIRMED", confirmedAt: new Date(), holdExpiresAt: null })
      .where(eq(reservations.id, r.id));
    await audit(tx, { actorUserId: actorUserId ?? r.userId, action: "reservation.confirm", entityType: "reservation", entityId: r.id });
    log.info("reservation confirmed", { reservationId: r.id, reference: r.reference });
    return "CONFIRMED";
  });
}

/** Marks a PENDING reservation EXPIRED (frees its period via the occupancy trigger). Idempotent. */
export async function expireReservation(reservationId: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(reservations)
    .set({ status: "EXPIRED", expiredAt: now })
    .where(and(eq(reservations.id, reservationId), eq(reservations.status, "PENDING")))
    .returning({ id: reservations.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Settlement: make provider money match the reservation status. Idempotent.
// ---------------------------------------------------------------------------

export type SettleResult = { refundedFils: number; releasedDeposits: number; errors: string[] };

/**
 * For EXPIRED / CANCELLED / REFUNDED reservations: refunds paid money down to the
 * cancellation fee (if any) and releases deposit authorisations. Safe to call repeatedly
 * and concurrently (refund idempotency keys are derived from the target refund state).
 * No DB locks are held while talking to the provider.
 */
export async function settleReservationMoney(
  reservationId: string,
  opts: { provider?: PaymentProvider } = {},
): Promise<SettleResult> {
  const provider = opts.provider ?? getPaymentProvider();
  const result: SettleResult = { refundedFils: 0, releasedDeposits: 0, errors: [] };
  const [r] = await db.select().from(reservations).where(eq(reservations.id, reservationId));
  if (!r || !["EXPIRED", "CANCELLED", "REFUNDED"].includes(r.status)) return result;

  // Deposits: release every live authorisation.
  const live = await db
    .select()
    .from(deposits)
    .where(and(eq(deposits.reservationId, r.id), inArray(deposits.status, ["PENDING", "AUTHORIZED"])));
  for (const d of live) {
    try {
      await releaseDepositRow(d, provider);
      result.releasedDeposits++;
    } catch (err) {
      result.errors.push(`deposit ${d.id}: ${(err as Error).message}`);
    }
  }

  // Payments: refund down to the fee.
  const paid = await db
    .select()
    .from(payments)
    .where(and(eq(payments.reservationId, r.id), inArray(payments.status, ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"])));
  const totalPaid = paid.reduce((s, p) => s + p.amountFils, 0);
  const fee = r.status === "EXPIRED" ? 0 : (r.cancellationFeeFils ?? 0);
  let toRefund = Math.max(0, totalPaid - fee) - paid.reduce((s, p) => s + p.refundedFils, 0);
  for (const p of paid) {
    if (toRefund <= 0) break;
    const amount = Math.min(toRefund, p.amountFils - p.refundedFils);
    if (amount <= 0) continue;
    try {
      await refundPaymentRow(p, amount, provider);
      toRefund -= amount;
      result.refundedFils += amount;
    } catch (err) {
      result.errors.push(`payment ${p.id}: ${(err as Error).message}`);
    }
  }

  // Record the outcome on the reservation.
  const [{ refunded }] = await db
    .select({ refunded: sql<number>`coalesce(sum(${payments.refundedFils}), 0)::int` })
    .from(payments)
    .where(eq(payments.reservationId, r.id));
  await db
    .update(reservations)
    .set({
      refundedFils: Number(refunded),
      ...(r.status === "CANCELLED" && Number(refunded) > 0 && toRefund <= 0 ? { status: "REFUNDED" as const } : {}),
    })
    .where(eq(reservations.id, r.id));
  if (result.errors.length) log.error("settlement incomplete", { reservationId: r.id, errors: result.errors });
  else if (result.refundedFils || result.releasedDeposits) log.info("settled", { reservationId: r.id, ...result });
  return result;
}

export async function releaseDepositRow(d: Deposit, provider: PaymentProvider = getPaymentProvider()): Promise<void> {
  if (d.status === "PENDING" && !d.providerHoldId) {
    await db.update(deposits).set({ status: "FAILED", failureReason: "Abandoned before authorisation" }).where(eq(deposits.id, d.id));
    return;
  }
  if (!isOffline(d, provider) && d.providerHoldId) {
    try {
      await provider.releaseDeposit(d.providerHoldId);
    } catch (err) {
      // Already released/captured at the provider (e.g. a retry): fall through and record it.
      if (!(err instanceof PaymentError && err.code === "invalid_state")) throw err;
    }
  }
  await db
    .update(deposits)
    .set({ status: "RELEASED", releasedAt: new Date() })
    .where(and(eq(deposits.id, d.id), inArray(deposits.status, ["PENDING", "AUTHORIZED"])));
}

export async function captureDepositRow(
  d: Deposit,
  amountFils: number,
  reason: string,
  provider: PaymentProvider = getPaymentProvider(),
): Promise<void> {
  const amount = Math.min(amountFils, d.amountFils);
  if (amount <= 0) return releaseDepositRow(d, provider);
  if (!isOffline(d, provider) && d.providerHoldId) {
    await provider.captureDeposit(d.providerHoldId, amount, { idempotencyKey: `capture:${d.id}:${amount}` });
  }
  await db
    .update(deposits)
    .set({ status: "CAPTURED", capturedFils: amount, captureReason: reason, capturedAt: new Date() })
    .where(and(eq(deposits.id, d.id), eq(deposits.status, "AUTHORIZED")));
}

export async function refundPaymentRow(p: Payment, amountFils: number, provider: PaymentProvider = getPaymentProvider()) {
  const target = p.refundedFils + amountFils;
  if (target > p.amountFils) throw new DomainError("validation", "Refund exceeds the payment.");
  let refunded = target;
  if (!isOffline(p, provider) && p.providerPaymentId) {
    const res = await provider.refundPayment(p.providerPaymentId, amountFils, { idempotencyKey: `refund:${p.id}:${target}` });
    refunded = res.refundedAmount;
  }
  await db
    .update(payments)
    .set({ refundedFils: refunded, status: refunded >= p.amountFils ? "REFUNDED" : "PARTIALLY_REFUNDED" })
    .where(eq(payments.id, p.id));
}

/** Charges an additional amount (date change top-up). Returns the payment row (check .status). */
export async function chargeAdditional(
  r: ResRow,
  amountFils: number,
  kind: "ADJUSTMENT" | "BALANCE",
  input: PayInput,
  provider: PaymentProvider = getPaymentProvider(),
): Promise<Payment> {
  assertKey(input.idempotencyKey);
  const key = `${kind.toLowerCase()}:${r.id}:${input.idempotencyKey}`;
  const [existing] = await db.select().from(payments).where(eq(payments.idempotencyKey, key));
  if (existing && existing.status !== "PENDING") return existing;
  const row =
    existing ??
    (
      await db
        .insert(payments)
        .values({ reservationId: r.id, userId: r.userId, kind, provider: provider.name, idempotencyKey: key, currency: CURRENCY, amountFils })
        .returning()
    )[0];
  try {
    const res = await provider.createPayment({
      amount: amountFils,
      currency: row.currency,
      paymentMethod: input.paymentMethod,
      idempotencyKey: key,
      metadata: { kind: kind.toLowerCase(), paymentRowId: row.id, reservationId: r.id, reference: r.reference },
    });
    const [updated] = await db
      .update(payments)
      .set({ providerPaymentId: res.id, status: paymentStatusFromProvider(res.status), failureReason: res.failureReason ?? null })
      .where(eq(payments.id, row.id))
      .returning();
    return updated;
  } catch (err) {
    if (err instanceof PaymentError && err.code !== "provider_error") {
      const [failed] = await db.update(payments).set({ status: "FAILED", failureReason: err.message }).where(eq(payments.id, row.id)).returning();
      return failed;
    }
    throw new DomainError("payment_failed", "The payment provider is unavailable. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export type WebhookOutcome = { status: "processed" | "duplicate" | "ignored"; eventId: string; type: string };

/**
 * Verifies, de-duplicates (payment_webhook_events unique (provider, event_id)) and applies
 * a provider webhook. The event row and its effects commit in one transaction, so a crash
 * mid-way lets the provider's retry re-apply it. Updates are monotonic (a late
 * "succeeded" never overrides a refund) and confirmation goes through confirmIfPaid.
 * Throws PaymentError("bad_signature") for an invalid signature (route returns 400).
 */
export async function handlePaymentWebhook(
  rawBody: string,
  signature: string | null,
  provider: PaymentProvider = getPaymentProvider(),
): Promise<WebhookOutcome> {
  const event = provider.verifyWebhook(rawBody, signature);
  const outcome = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(paymentWebhookEvents)
      .values({ provider: provider.name, eventId: event.id, type: event.type, payload: event as unknown as Record<string, unknown> })
      .onConflictDoNothing()
      .returning({ id: paymentWebhookEvents.id });
    if (!inserted.length) return { status: "duplicate" as const, reservationId: null };
    const reservationId = await applyEvent(tx, event, provider);
    await tx.update(paymentWebhookEvents).set({ processedAt: new Date() }).where(eq(paymentWebhookEvents.id, inserted[0].id));
    return { status: event.type === "unsupported" ? ("ignored" as const) : ("processed" as const), reservationId };
  });
  if (outcome.reservationId) {
    // Outside the event transaction: may confirm an async (webhook-driven) payment.
    await confirmIfPaid(outcome.reservationId, null).catch((err) => log.error("confirm from webhook failed", { err }));
  }
  log.info("webhook", { provider: provider.name, eventId: event.id, type: event.type, status: outcome.status });
  return { status: outcome.status, eventId: event.id, type: event.type };
}

type TxLike = Parameters<Parameters<typeof db.transaction>[0]>[0];

const PAYMENT_RANK: Record<Payment["status"], number> = {
  PENDING: 0,
  FAILED: 1,
  SUCCEEDED: 2,
  CANCELLED: 3,
  PARTIALLY_REFUNDED: 3,
  REFUNDED: 4,
};
const DEPOSIT_RANK: Record<Deposit["status"], number> = { PENDING: 0, FAILED: 1, AUTHORIZED: 2, RELEASED: 3, CAPTURED: 3 };

async function applyEvent(tx: TxLike, event: WebhookEvent, provider: PaymentProvider): Promise<string | null> {
  if (event.type === "unsupported") return null;
  if (event.type.startsWith("payment.")) {
    const data = event.data as ProviderPayment;
    const rowId = data.metadata?.paymentRowId;
    const [row] = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.provider, provider.name),
          rowId && isUuidLike(rowId) ? sql`(${payments.providerPaymentId} = ${data.id} or ${payments.id} = ${rowId}::uuid)` : eq(payments.providerPaymentId, data.id),
        ),
      )
      .for("update");
    if (!row) return null;
    const next = paymentStatusFromProvider(data.status);
    const refunded = Math.max(row.refundedFils, Math.min(data.refundedAmount ?? 0, row.amountFils));
    const status = PAYMENT_RANK[next] >= PAYMENT_RANK[row.status] ? next : row.status;
    await tx
      .update(payments)
      .set({ providerPaymentId: row.providerPaymentId ?? data.id, status, refundedFils: refunded, failureReason: data.failureReason ?? row.failureReason })
      .where(eq(payments.id, row.id));
    return status === "SUCCEEDED" ? row.reservationId : null;
  }
  const data = event.data as DepositHold;
  const rowId = data.metadata?.depositRowId;
  const [row] = await tx
    .select()
    .from(deposits)
    .where(
      and(
        eq(deposits.provider, provider.name),
        rowId && isUuidLike(rowId) ? sql`(${deposits.providerHoldId} = ${data.id} or ${deposits.id} = ${rowId}::uuid)` : eq(deposits.providerHoldId, data.id),
      ),
    )
    .for("update");
  if (!row) return null;
  const next = depositStatusFromProvider(data.status);
  if (DEPOSIT_RANK[next] < DEPOSIT_RANK[row.status]) return null;
  const now = new Date();
  await tx
    .update(deposits)
    .set({
      providerHoldId: row.providerHoldId ?? data.id,
      status: next,
      capturedFils: next === "CAPTURED" ? Math.min(data.capturedAmount, row.amountFils) : row.capturedFils,
      authorizedAt: next === "AUTHORIZED" ? (row.authorizedAt ?? now) : row.authorizedAt,
      releasedAt: next === "RELEASED" ? (row.releasedAt ?? now) : row.releasedAt,
      capturedAt: next === "CAPTURED" ? (row.capturedAt ?? now) : row.capturedAt,
    })
    .where(eq(deposits.id, row.id));
  return next === "AUTHORIZED" ? row.reservationId : null;
}

const isUuidLike = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function paymentSummary(reservationId: string) {
  const rows = await db.select().from(payments).where(eq(payments.reservationId, reservationId)).orderBy(payments.createdAt);
  const deps = await db.select().from(deposits).where(eq(deposits.reservationId, reservationId)).orderBy(deposits.createdAt);
  const rental = [...rows].reverse().find((p) => p.kind === "RENTAL");
  const deposit = deps.at(-1);
  return {
    payment: rental
      ? { status: rental.status, amountFils: rental.amountFils, refundedFils: rental.refundedFils, failureReason: rental.failureReason }
      : null,
    deposit: deposit
      ? { status: deposit.status, amountFils: deposit.amountFils, capturedFils: deposit.capturedFils, failureReason: deposit.failureReason }
      : null,
    payments: rows.map((p) => ({
      id: p.id,
      kind: p.kind,
      status: p.status,
      amountFils: p.amountFils,
      refundedFils: p.refundedFils,
      failureReason: p.failureReason,
      createdAt: p.createdAt,
    })),
  };
}
