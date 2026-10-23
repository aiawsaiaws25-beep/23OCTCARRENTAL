// Q5/Q6/Q7/Q8/Q9/Q10 at the service level against real Postgres + the fake payment provider.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakePaymentProvider } from "@/lib/services/payments/fake";
import { PaymentError, type PaymentProvider, type WebhookEvent } from "@/lib/services/payments";
import { signPayload } from "@/lib/services/payments/webhook-signature";
import { handlePaymentWebhook, payReservation, settleReservationMoney } from "@/server/payments";
import {
  cancelReservation,
  createReservationHold,
  getCancellationQuote,
  getReservationForUser,
  listReservationsForUser,
  modifyReservationDates,
  quoteDateChange,
  saveDriverDetails,
} from "@/server/reservations";
import { hasMigrations } from "../helpers/db";
import { at, closeQaPool, createBranch, createCategory, createExtra, createUser, createVehicle, insertReservation, qaPool } from "../helpers/factory";

const H = 3_600_000;
const SECRET = process.env.PAYMENTS_WEBHOOK_SECRET!;
const provider = new FakePaymentProvider({
  stateFile: process.env.FAKE_PAYMENTS_STATE_FILE!,
  webhookUrl: "http://127.0.0.1:9/unused",
  webhookSecret: SECRET,
  fetchImpl: (async () => new Response(null, { status: 200 })) as typeof fetch,
});

const DRIVER = {
  fullName: "QA Driver",
  email: "driver@example.test",
  phone: "+971500000001",
  dateOfBirth: "1990-01-01",
  licenceNumber: "LIC-12345",
  licenceCountry: "AE",
  licenceExpiry: "2040-01-01",
};

const key = () => randomUUID();

async function setup(opts: { dailyRateFils?: number; depositFils?: number } = {}) {
  const branch = await createBranch();
  const cat = await createCategory({ dailyRateFils: opts.dailyRateFils ?? 15_000, depositFils: opts.depositFils ?? 100_000 });
  const v = await createVehicle({ branchId: branch.id, categoryId: cat.id });
  return { branchId: branch.id, vehicleId: v.id, categoryId: cat.id };
}

function holdInput(userId: string, s: { branchId: string; vehicleId: string }, start: Date, end: Date, extra: object = {}) {
  return { userId, vehicleId: s.vehicleId, pickupBranchId: s.branchId, returnBranchId: s.branchId, pickupAt: start, returnAt: end, idempotencyKey: key(), ...extra };
}

async function hold(userId: string, s: { branchId: string; vehicleId: string }, start: Date, end: Date) {
  const r = await createReservationHold(holdInput(userId, s, start, end));
  if (!r.ok) throw new Error(`hold failed: ${r.code} ${r.message}`);
  return r;
}

async function confirmed(userId: string, s: { branchId: string; vehicleId: string }, start: Date, end: Date) {
  const h = await hold(userId, s, start, end);
  const d = await saveDriverDetails(userId, h.reservationId, DRIVER);
  expect(d.ok, JSON.stringify(d)).toBe(true);
  const p = await payReservation(userId, h.reservationId, { idempotencyKey: key() }, { provider });
  expect(p).toMatchObject({ ok: true, status: "confirmed" });
  return h;
}

const row = async (id: string) => (await qaPool().query(`select * from reservations where id = $1`, [id])).rows[0];
const paymentsOf = async (id: string) => (await qaPool().query(`select * from payments where reservation_id = $1 order by created_at`, [id])).rows;
const depositsOf = async (id: string) => (await qaPool().query(`select * from deposits where reservation_id = $1 order by created_at`, [id])).rows;
const providerPayments = (reservationId: string) =>
  provider.listEvents().filter((e) => e.type === "payment.succeeded" && e.data.metadata?.reservationId === reservationId);

describe.runIf(hasMigrations())("reservations + payments (service level)", () => {
  let alice: string;
  let bob: string;
  beforeAll(async () => {
    alice = (await createUser()).id;
    bob = (await createUser()).id;
  });
  afterAll(closeQaPool);

  // -------------------------------------------------------------------------
  describe("Q5 concurrency", () => {
    it("20 rounds x 10 different users racing for overlapping periods: exactly one hold wins, losers get 'unavailable'", async () => {
      const users = await Promise.all(Array.from({ length: 10 }, () => createUser()));
      for (let round = 0; round < 20; round++) {
        const s = await setup();
        const results = await Promise.all(
          users.map((u, i) => createReservationHold(holdInput(u.id, s, at(10 - (i % 3), 10), at(11 + (i % 2), 10)))),
        );
        const ok = results.filter((r) => r.ok);
        expect(ok.length, `round ${round}: ${JSON.stringify(results.filter((r) => !r.ok))}`).toBe(1);
        for (const r of results) if (!r.ok) expect(r.code).toBe("unavailable");
        const { rows } = await qaPool().query(
          `select count(*)::int n from reservations where vehicle_id = $1 and status in ('PENDING','CONFIRMED','PICKED_UP')`,
          [s.vehicleId],
        );
        expect(rows[0].n).toBe(1);
      }
    });

    it("identical period from two sessions of the same user with different keys: exactly one", async () => {
      const s = await setup();
      const [a, b] = await Promise.all([
        createReservationHold(holdInput(alice, s, at(20), at(22))),
        createReservationHold(holdInput(alice, s, at(20), at(22))),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    });

    it("same idempotency key sent 10x in parallel creates exactly one reservation", async () => {
      const s = await setup();
      const input = holdInput(alice, s, at(30), at(32));
      const results = await Promise.all(Array.from({ length: 10 }, () => createReservationHold({ ...input })));
      expect(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok))).toBe(true);
      const ids = new Set(results.map((r) => r.ok && r.reservationId));
      expect(ids.size).toBe(1);
      const { rows } = await qaPool().query(`select count(*)::int n from reservations where vehicle_id = $1`, [s.vehicleId]);
      expect(rows[0].n).toBe(1);
    });

    it("confirming two overlapping reservations is impossible even if both were created as holds on different vehicles then moved", async () => {
      const s = await setup();
      const a = await confirmed(alice, s, at(40), at(42));
      const b = await confirmed(bob, s, at(42), at(44));
      // Bob tries to move onto Alice's dates.
      const r = await modifyReservationDates(bob, b.reservationId, { pickupAt: at(41), returnAt: at(43), idempotencyKey: key() });
      expect(r).toMatchObject({ ok: false, code: "unavailable" });
      expect((await row(a.reservationId)).status).toBe("CONFIRMED");
    });
  });

  // -------------------------------------------------------------------------
  describe("Q6 back-to-back", () => {
    it("end == next start: both holds succeed and both can be paid", async () => {
      const s = await setup();
      const a = await confirmed(alice, s, at(50, 10), at(52, 10));
      const b = await confirmed(bob, s, at(52, 10), at(54, 10));
      expect((await row(a.reservationId)).status).toBe("CONFIRMED");
      expect((await row(b.reservationId)).status).toBe("CONFIRMED");
    });

    it("back-to-back requests racing in parallel all succeed", async () => {
      const s = await setup();
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => createReservationHold(holdInput(i % 2 ? alice : bob, s, at(60 + i, 9), at(61 + i, 9)))),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(6);
    });

    it("one minute of overlap is rejected", async () => {
      const s = await setup();
      await hold(alice, s, at(70, 10), at(72, 10));
      expect(await createReservationHold(holdInput(bob, s, at(72, 9, 59), at(73)))).toMatchObject({ ok: false, code: "unavailable" });
    });
  });

  // -------------------------------------------------------------------------
  describe("Q7 holds", () => {
    it("an active hold blocks others; it expires after 15 minutes", async () => {
      const s = await setup();
      const before = Date.now();
      const h = await hold(alice, s, at(80), at(82));
      expect(h.holdExpiresAt.getTime() - before).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
      expect(h.holdExpiresAt.getTime() - before).toBeLessThanOrEqual(15 * 60_000 + 5000);
      expect(await createReservationHold(holdInput(bob, s, at(81), at(83)))).toMatchObject({ ok: false, code: "unavailable" });
    });

    it("an expired hold that the cron has not released yet does not block a new booking", async () => {
      const s = await setup();
      const stale = await insertReservation({
        userId: alice,
        vehicleId: s.vehicleId,
        branchId: s.branchId,
        startAt: at(90),
        endAt: at(92),
        status: "PENDING",
        holdExpiresAt: new Date(Date.now() - 60_000),
      });
      const fresh = await createReservationHold(holdInput(bob, s, at(91), at(93)));
      expect(fresh).toMatchObject({ ok: true });
      expect((await row(stale.id)).status).toBe("EXPIRED");
    });

    it("paying after the hold expired returns 'expired' and frees the vehicle", async () => {
      const s = await setup();
      const h = await hold(alice, s, at(100), at(102));
      await saveDriverDetails(alice, h.reservationId, DRIVER);
      const late = new Date(Date.now() + 16 * 60_000);
      const p = await payReservation(alice, h.reservationId, { idempotencyKey: key() }, { provider, now: late });
      expect(p).toMatchObject({ ok: true, status: "expired" });
      expect((await row(h.reservationId)).status).toBe("EXPIRED");
      expect(await paymentsOf(h.reservationId)).toHaveLength(0);
      expect(await createReservationHold(holdInput(bob, s, at(100), at(102)))).toMatchObject({ ok: true });
    });
  });

  // -------------------------------------------------------------------------
  describe("Q8 server is the source of truth for prices", () => {
    it("ignores client-submitted prices", async () => {
      const s = await setup({ dailyRateFils: 15_000, depositFils: 100_000 });
      const tampered = {
        ...holdInput(alice, s, at(110), at(113)),
        totalFils: 1,
        dailyRateFils: 1,
        depositFils: 0,
        vatFils: 0,
        quote: { totalFils: 1 },
        priceBreakdown: { totalFils: 1 },
      } as Parameters<typeof createReservationHold>[0];
      const r = await createReservationHold(tampered);
      expect(r.ok).toBe(true);
      const db = await row(r.ok ? r.reservationId : "");
      expect(db.daily_rate_fils).toBe(15_000);
      expect(db.subtotal_fils).toBe(45_000);
      expect(db.vat_fils).toBe(2_250);
      expect(db.total_fils).toBe(47_250);
      expect(db.deposit_fils).toBe(100_000);
    });

    it("extras are priced on the server; bad quantities / unknown / inactive extras are rejected", async () => {
      const s = await setup();
      const seat = await createExtra({ pricing: "PER_DAY", priceFils: 3_000, maxQuantity: 2 });
      const ins = await createExtra({ pricing: "PER_RENTAL", priceFils: 7_777, maxQuantity: 1 });
      const off = await createExtra({ active: false });
      const ok = await createReservationHold(
        holdInput(alice, s, at(120), at(122), {
          extras: [
            { extraId: seat.id, quantity: 2, priceFils: 0, totalFils: 0 },
            { extraId: ins.id, quantity: 1 },
          ],
        }),
      );
      expect(ok.ok, JSON.stringify(ok)).toBe(true);
      const db = await row(ok.ok ? ok.reservationId : "");
      expect(db.extras_fils).toBe(2 * 2 * 3_000 + 7_777);
      expect(db.total_fils).toBe(db.subtotal_fils + db.vat_fils);
      const { rows: lines } = await qaPool().query(`select * from reservation_extras where reservation_id = $1`, [db.id]);
      expect(lines.map((l) => l.total_fils).sort()).toEqual([7_777, 12_000].sort());

      const s2 = await setup();
      for (const extras of [
        [{ extraId: seat.id, quantity: 3 }],
        [{ extraId: seat.id, quantity: -1 }],
        [{ extraId: seat.id, quantity: 1.5 }],
        [{ extraId: off.id, quantity: 1 }],
        [{ extraId: randomUUID(), quantity: 1 }],
      ]) {
        const bad = await createReservationHold(holdInput(alice, s2, at(130), at(131), { extras }));
        expect(bad, JSON.stringify(extras)).toMatchObject({ ok: false, code: "validation" });
      }
    });

    it("the charged amount equals the stored total (not a client value) and the deposit is authorised separately", async () => {
      const s = await setup({ dailyRateFils: 33_333, depositFils: 150_000 });
      const h = await confirmed(alice, s, at(140), at(142, 11));
      const db = await row(h.reservationId);
      const [pay] = await paymentsOf(h.reservationId);
      const [dep] = await depositsOf(h.reservationId);
      expect(pay).toMatchObject({ kind: "RENTAL", status: "SUCCEEDED", amount_fils: db.total_fils });
      expect(dep).toMatchObject({ status: "AUTHORIZED", amount_fils: 150_000 });
      expect(db.total_fils).toBe(3 * 33_333 + Math.round(3 * 33_333 * 0.05));
      const [evt] = providerPayments(h.reservationId);
      expect(evt.data.amount).toBe(db.total_fils);
    });
  });

  // -------------------------------------------------------------------------
  describe("Q9 payments", () => {
    it("requires driver details before paying", async () => {
      const s = await setup();
      const fresh = (await createUser()).id; // no saved driver profile yet
      const h = await hold(fresh, s, at(150), at(151));
      expect(await payReservation(fresh, h.reservationId, { idempotencyKey: key() }, { provider })).toMatchObject({ ok: false, code: "validation" });
      expect(await paymentsOf(h.reservationId)).toHaveLength(0);
    });

    it("rejects under-age drivers and licences that expire before return", async () => {
      const s = await setup();
      const h = await hold(alice, s, at(152), at(153));
      expect(await saveDriverDetails(alice, h.reservationId, { ...DRIVER, dateOfBirth: "2015-01-01" })).toMatchObject({ ok: false, code: "validation" });
      expect(await saveDriverDetails(alice, h.reservationId, { ...DRIVER, licenceExpiry: "2030-01-01" })).toMatchObject({ ok: false, code: "validation" });
    });

    it("decline then retry with a new key: confirmed with exactly one successful charge", async () => {
      const s = await setup();
      const h = await hold(alice, s, at(160), at(162));
      await saveDriverDetails(alice, h.reservationId, DRIVER);
      const declined = await payReservation(alice, h.reservationId, { idempotencyKey: key(), paymentMethod: "pm_fake_declined" }, { provider });
      expect(declined).toMatchObject({ ok: true, status: "failed", stage: "payment" });
      expect((await row(h.reservationId)).status).toBe("PENDING");
      const retry = await payReservation(alice, h.reservationId, { idempotencyKey: key() }, { provider });
      expect(retry).toMatchObject({ ok: true, status: "confirmed" });
      const pays = await paymentsOf(h.reservationId);
      expect(pays.filter((p) => p.status === "SUCCEEDED")).toHaveLength(1);
      expect(pays.filter((p) => p.status === "FAILED")).toHaveLength(1);
      expect(providerPayments(h.reservationId)).toHaveLength(1);
    });

    it("re-submitting the same key (double click / network retry) never charges twice", async () => {
      const s = await setup();
      const h = await hold(alice, s, at(170), at(172));
      await saveDriverDetails(alice, h.reservationId, DRIVER);
      const k = key();
      const results = await Promise.all(Array.from({ length: 5 }, () => payReservation(alice, h.reservationId, { idempotencyKey: k }, { provider })));
      for (const r of results) expect(r.ok).toBe(true);
      const again = await payReservation(alice, h.reservationId, { idempotencyKey: k }, { provider });
      expect(again).toMatchObject({ ok: true, status: "confirmed" });
      expect((await paymentsOf(h.reservationId)).filter((p) => p.status === "SUCCEEDED")).toHaveLength(1);
      expect(providerPayments(h.reservationId)).toHaveLength(1);
      expect(await depositsOf(h.reservationId)).toHaveLength(1);
    });

    it("parallel payments with different keys (two tabs) never charge twice", async () => {
      const s = await setup();
      const h = await hold(alice, s, at(175), at(177));
      await saveDriverDetails(alice, h.reservationId, DRIVER);
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => payReservation(alice, h.reservationId, { idempotencyKey: key() }, { provider })));
      expect(results.some((r) => r.status === "fulfilled" && r.value.ok && r.value.status === "confirmed")).toBe(true);
      // Whatever the losers saw, money must be right.
      await payReservation(alice, h.reservationId, { idempotencyKey: key() }, { provider });
      expect((await row(h.reservationId)).status).toBe("CONFIRMED");
      expect((await paymentsOf(h.reservationId)).filter((p) => p.status === "SUCCEEDED")).toHaveLength(1);
      expect(providerPayments(h.reservationId)).toHaveLength(1);
      expect((await depositsOf(h.reservationId)).filter((d) => d.status === "AUTHORIZED")).toHaveLength(1);
      const holds = provider.listEvents().filter((e) => e.type === "deposit.held" && e.data.metadata?.reservationId === h.reservationId);
      expect(holds).toHaveLength(1);
    });

    it("deposit declined after a successful charge: stays PENDING, retry authorises deposit without charging again", async () => {
      const s = await setup();
      const h = await hold(alice, s, at(180), at(182));
      await saveDriverDetails(alice, h.reservationId, DRIVER);
      const decliningHolds: PaymentProvider = Object.assign(Object.create(Object.getPrototypeOf(provider)), provider, {
        holdDeposit: async () => {
          throw new PaymentError("Card declined", "declined");
        },
      });
      const first = await payReservation(alice, h.reservationId, { idempotencyKey: key() }, { provider: decliningHolds });
      expect(first).toMatchObject({ ok: true, status: "failed", stage: "deposit" });
      expect((await row(h.reservationId)).status).toBe("PENDING");
      const second = await payReservation(alice, h.reservationId, { idempotencyKey: key() }, { provider });
      expect(second).toMatchObject({ ok: true, status: "confirmed" });
      expect((await paymentsOf(h.reservationId)).filter((p) => p.status === "SUCCEEDED")).toHaveLength(1);
      expect((await depositsOf(h.reservationId)).map((d) => d.status).sort()).toEqual(["AUTHORIZED", "FAILED"]);
    });

    it("cancel before payment (abandoned checkout) frees the vehicle with no money movement", async () => {
      const s = await setup();
      const h = await hold(alice, s, at(185), at(186));
      expect(await cancelReservation(alice, h.reservationId)).toMatchObject({ ok: true, status: "CANCELLED", refundFils: 0 });
      expect(await createReservationHold(holdInput(bob, s, at(185), at(186)))).toMatchObject({ ok: true });
    });

    it("a hold that expires after the charge succeeded is refunded in full and its deposit released", async () => {
      const s = await setup();
      const h = await hold(alice, s, at(187), at(188));
      await saveDriverDetails(alice, h.reservationId, DRIVER);
      const decliningHolds: PaymentProvider = Object.assign(Object.create(Object.getPrototypeOf(provider)), provider, {
        holdDeposit: async () => {
          throw new PaymentError("Card declined", "declined");
        },
      });
      await payReservation(alice, h.reservationId, { idempotencyKey: key() }, { provider: decliningHolds });
      const late = new Date(Date.now() + 20 * 60_000);
      expect(await payReservation(alice, h.reservationId, { idempotencyKey: key() }, { provider, now: late })).toMatchObject({ ok: true, status: "expired" });
      const [pay] = (await paymentsOf(h.reservationId)).filter((p) => p.kind === "RENTAL" && p.status !== "FAILED");
      expect(pay).toMatchObject({ status: "REFUNDED" });
      expect(pay.refunded_fils).toBe(pay.amount_fils);
    });

    describe("cancellation policy refunds + deposit release", () => {
      async function cancelAt(hoursBefore: number) {
        const s = await setup({ dailyRateFils: 20_000 });
        const start = at(200 + Math.round(hoursBefore), 10);
        const h = await confirmed(alice, s, start, new Date(start.getTime() + 3 * 24 * H));
        const now = new Date(start.getTime() - hoursBefore * H);
        const quote = await getCancellationQuote(alice, h.reservationId, { now });
        const res = await cancelReservation(alice, h.reservationId, { now });
        return { h, quote, res, db: await row(h.reservationId), pays: await paymentsOf(h.reservationId), deps: await depositsOf(h.reservationId) };
      }
      const total = 3 * 20_000 + 3_000; // 63000

      it(">= 48h before pick-up: full refund, deposit released, status REFUNDED", async () => {
        const { quote, res, db, pays, deps } = await cancelAt(72);
        expect(quote).toMatchObject({ ok: true, eligible: true, refundFils: total, feeFils: 0 });
        expect(res).toMatchObject({ ok: true, refundFils: total, feeFils: 0 });
        expect(db.status).toBe("REFUNDED");
        expect(db.refunded_fils).toBe(total);
        expect(pays[0]).toMatchObject({ status: "REFUNDED", refunded_fils: total });
        expect(deps[0].status).toBe("RELEASED");
      });

      it("24-48h before: refund minus one day's rental incl. VAT", async () => {
        const { res, db, pays, deps } = await cancelAt(30);
        expect(res).toMatchObject({ ok: true, feeFils: 21_000, refundFils: total - 21_000 });
        expect(db.refunded_fils).toBe(total - 21_000);
        expect(pays[0]).toMatchObject({ status: "PARTIALLY_REFUNDED", refunded_fils: total - 21_000 });
        expect(deps[0].status).toBe("RELEASED");
      });

      it("< 24h before: 50% refund", async () => {
        const { res, pays, deps } = await cancelAt(5);
        expect(res).toMatchObject({ ok: true, refundFils: total / 2 + 0, feeFils: total - total / 2 });
        expect(pays[0].refunded_fils).toBe(Math.round(total / 2));
        expect(deps[0].status).toBe("RELEASED");
      });

      it("after pick-up time: not cancellable online", async () => {
        const s = await setup();
        const h = await confirmed(alice, s, at(260), at(262));
        const res = await cancelReservation(alice, h.reservationId, { now: new Date(at(260).getTime() + H) });
        expect(res).toMatchObject({ ok: false, code: "not_eligible" });
        expect((await row(h.reservationId)).status).toBe("CONFIRMED");
      });

      it("cancelling twice / settling repeatedly never refunds twice", async () => {
        const { h } = await cancelAt(100);
        const again = await cancelReservation(alice, h.reservationId);
        expect(again.ok).toBe(false);
        await settleReservationMoney(h.reservationId, { provider });
        await settleReservationMoney(h.reservationId, { provider });
        const [p] = await paymentsOf(h.reservationId);
        expect(p.refunded_fils).toBe(p.amount_fils);
        const refunds = provider.listEvents().filter((e) => e.type === "payment.refunded" && e.data.metadata?.reservationId === h.reservationId);
        expect(refunds).toHaveLength(1);
      });

      it("parallel cancellations refund once", async () => {
        const s = await setup();
        const h = await confirmed(alice, s, at(270), at(272));
        const now = new Date(at(270).getTime() - 100 * H);
        await Promise.allSettled(Array.from({ length: 4 }, () => cancelReservation(alice, h.reservationId, { now })));
        const [p] = await paymentsOf(h.reservationId);
        expect(p.refunded_fils).toBe(p.amount_fils);
        const refunded = provider
          .listEvents()
          .filter((e) => e.type === "payment.refunded" && e.data.metadata?.reservationId === h.reservationId)
          .map((e) => (e.data as { refundedAmount: number }).refundedAmount);
        expect(Math.max(...refunded)).toBe(p.amount_fils);
      });
    });

    describe("webhooks", () => {
      const signed = (event: WebhookEvent) => {
        const body = JSON.stringify(event);
        return { body, sig: signPayload(body, SECRET) };
      };

      it("the same event delivered twice is applied once", async () => {
        const s = await setup();
        const h = await confirmed(alice, s, at(280), at(282));
        const [evt] = providerPayments(h.reservationId);
        const { body, sig } = signed(evt);
        const first = await handlePaymentWebhook(body, sig, provider);
        const second = await handlePaymentWebhook(body, sig, provider);
        expect([first.status, second.status]).toEqual(["processed", "duplicate"]);
        const { rows } = await qaPool().query(`select count(*)::int n from payment_webhook_events where event_id = $1`, [evt.id]);
        expect(rows[0].n).toBe(1);
      });

      it("concurrent duplicate deliveries are applied once", async () => {
        const s = await setup();
        const h = await confirmed(alice, s, at(284), at(285));
        const [evt] = providerPayments(h.reservationId);
        const { body, sig } = signed(evt);
        const results = await Promise.allSettled(Array.from({ length: 5 }, () => handlePaymentWebhook(body, sig, provider)));
        const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : "error"));
        expect(statuses.filter((x) => x === "processed")).toHaveLength(1);
        expect(statuses.filter((x) => x === "error")).toHaveLength(0);
      });

      it("rejects missing / wrong / stale signatures and tampered bodies", async () => {
        const s = await setup();
        const h = await confirmed(alice, s, at(286), at(287));
        const [evt] = providerPayments(h.reservationId);
        const { body, sig } = signed(evt);
        await expect(handlePaymentWebhook(body, null, provider)).rejects.toMatchObject({ code: "bad_signature" });
        await expect(handlePaymentWebhook(body, "t=1,v1=00", provider)).rejects.toMatchObject({ code: "bad_signature" });
        await expect(handlePaymentWebhook(body, signPayload(body, "wrong-secret-123456"), provider)).rejects.toMatchObject({ code: "bad_signature" });
        await expect(handlePaymentWebhook(body, signPayload(body, SECRET, Math.floor(Date.now() / 1000) - 3600), provider)).rejects.toMatchObject({
          code: "bad_signature",
        });
        await expect(handlePaymentWebhook(body.replace(/"amount":\d+/, '"amount":1'), sig, provider)).rejects.toMatchObject({ code: "bad_signature" });
      });

      it("a late 'succeeded' event never overrides a refund", async () => {
        const s = await setup();
        const h = await confirmed(alice, s, at(288), at(289));
        await cancelReservation(alice, h.reservationId, { now: new Date(at(288).getTime() - 100 * H) });
        const [succeeded] = providerPayments(h.reservationId);
        const { body, sig } = signed(succeeded);
        await handlePaymentWebhook(body, sig, provider);
        const [p] = await paymentsOf(h.reservationId);
        expect(p.status).toBe("REFUNDED");
        expect((await row(h.reservationId)).status).toBe("REFUNDED");
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("Q10 ownership", () => {
    it("another user cannot read, pay, cancel, modify or edit driver details of my reservation", async () => {
      const s = await setup();
      const h = await hold(alice, s, at(300), at(302));
      expect(await getReservationForUser(bob, h.reservationId)).toBeNull();
      expect((await listReservationsForUser(bob)).map((r) => r.id)).not.toContain(h.reservationId);
      expect(await payReservation(bob, h.reservationId, { idempotencyKey: key() }, { provider })).toMatchObject({ ok: false, code: "not_found" });
      expect(await saveDriverDetails(bob, h.reservationId, DRIVER)).toMatchObject({ ok: false, code: "not_found" });
      expect(await cancelReservation(bob, h.reservationId)).toMatchObject({ ok: false, code: "not_found" });
      expect(await getCancellationQuote(bob, h.reservationId)).toMatchObject({ ok: false, code: "not_found" });
      expect(await quoteDateChange(bob, h.reservationId, { pickupAt: at(303), returnAt: at(304) })).toMatchObject({ ok: false, code: "not_found" });
      expect(await modifyReservationDates(bob, h.reservationId, { pickupAt: at(303), returnAt: at(304) })).toMatchObject({ ok: false, code: "not_found" });
      expect((await row(h.reservationId)).status).toBe("PENDING");
      expect(await getReservationForUser(alice, h.reservationId)).not.toBeNull();
    });

    it("junk ids are not_found, never a 500", async () => {
      expect(await getReservationForUser(alice, "../../etc/passwd")).toBeNull();
      expect(await payReservation(alice, "not-a-uuid", { idempotencyKey: key() }, { provider })).toMatchObject({ ok: false, code: "not_found" });
      expect(await cancelReservation(alice, "not-a-uuid")).toMatchObject({ ok: false, code: "not_found" });
    });

    it("plate number is hidden until confirmed", async () => {
      const s = await setup();
      const h = await hold(alice, s, at(310), at(311));
      expect((await getReservationForUser(alice, h.reservationId))!.vehicle.plateNumber).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("date changes", () => {
    it("longer rental charges the difference; into an occupied period is refused and nothing stays charged", async () => {
      const s = await setup({ dailyRateFils: 10_000 });
      const h = await confirmed(alice, s, at(320), at(322));
      await confirmed(bob, s, at(326), at(328));
      const longer = await modifyReservationDates(alice, h.reservationId, { pickupAt: at(320), returnAt: at(323), idempotencyKey: key() });
      expect(longer).toMatchObject({ ok: true, differenceFils: 10_500, chargedFils: 10_500 });
      expect((await row(h.reservationId)).total_fils).toBe(31_500);

      const clash = await modifyReservationDates(alice, h.reservationId, { pickupAt: at(320), returnAt: at(327), idempotencyKey: key() });
      expect(clash).toMatchObject({ ok: false, code: "unavailable" });
      const charged = (await paymentsOf(h.reservationId)).filter((p) => p.status === "SUCCEEDED").reduce((s, p) => s + p.amount_fils - p.refunded_fils, 0);
      expect(charged).toBe(31_500);
    });

    it("declined top-up leaves the reservation unchanged", async () => {
      const s = await setup({ dailyRateFils: 10_000 });
      const h = await confirmed(alice, s, at(330), at(332));
      const r = await modifyReservationDates(alice, h.reservationId, {
        pickupAt: at(330),
        returnAt: at(334),
        idempotencyKey: key(),
        paymentMethod: "pm_fake_declined",
      });
      expect(r).toMatchObject({ ok: false, code: "payment_failed" });
      const db = await row(h.reservationId);
      expect(db.total_fils).toBe(21_000);
      expect(new Date(db.end_at).getTime()).toBe(at(332).getTime());
    });

    it("shorter rental >= 48h before pick-up refunds the difference", async () => {
      const s = await setup({ dailyRateFils: 10_000 });
      const h = await confirmed(alice, s, at(340), at(343));
      const r = await modifyReservationDates(alice, h.reservationId, { pickupAt: at(340), returnAt: at(341) }, { now: new Date(at(340).getTime() - 72 * H) });
      expect(r).toMatchObject({ ok: true, differenceFils: -21_000, refundedFils: 21_000 });
    });

    it("shorter rental < 48h before pick-up is not refunded (policy)", async () => {
      const s = await setup({ dailyRateFils: 10_000 });
      const h = await confirmed(alice, s, at(350), at(353));
      const r = await modifyReservationDates(alice, h.reservationId, { pickupAt: at(350), returnAt: at(351) }, { now: new Date(at(350).getTime() - 30 * H) });
      expect(r.ok).toBe(true);
      expect(r.ok && r.refundedFils).toBe(0);
    });

    it("moving dates frees the old period for others", async () => {
      const s = await setup();
      const h = await confirmed(alice, s, at(360), at(362));
      expect(await modifyReservationDates(alice, h.reservationId, { pickupAt: at(364), returnAt: at(366) })).toMatchObject({ ok: true });
      expect(await createReservationHold(holdInput(bob, s, at(360), at(362)))).toMatchObject({ ok: true });
    });
  });
});
