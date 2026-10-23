// Q4 (service level): complete rental search → hold → pay → voucher → check-out → damage → check-in,
// Q7 hold release job, Q8 late-return/fuel/damage charges vs deposit, Q10 admin permissions + private files.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakePaymentProvider } from "@/lib/services/payments/fake";
import { findReservationIdByCode, getVoucher, verifyVoucherCode, voucherCode } from "@/server/account";
import * as admin from "@/server/admin";
import { searchVehicles } from "@/server/catalog";
import { releaseExpiredHolds } from "@/server/holds";
import { payReservation } from "@/server/payments";
import { createReservationHold, saveDriverDetails } from "@/server/reservations";
import { getAuthorizedFile, uploadLicence, validateUpload } from "@/server/uploads";
import { hasMigrations } from "../helpers/db";
import { at, closeQaPool, createBranch, createCategory, createUser, createVehicle, insertReservation, qaPool } from "../helpers/factory";

const H = 3_600_000;
const provider = new FakePaymentProvider({
  stateFile: process.env.FAKE_PAYMENTS_STATE_FILE!,
  webhookUrl: "http://127.0.0.1:9/unused",
  webhookSecret: process.env.PAYMENTS_WEBHOOK_SECRET!,
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
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const PDF = Buffer.from("%PDF-1.7\n%qa\n");

const row = async (table: string, id: string, col = "id") => (await qaPool().query(`select * from ${table} where ${col} = $1`, [id])).rows[0];

type U = { id: string; role: "CUSTOMER" | "ADMIN" };

describe.runIf(hasMigrations())("operations (service level)", () => {
  let customer: U;
  let other: U;
  let staff: U;
  beforeAll(async () => {
    customer = (await createUser()) as U;
    other = (await createUser()) as U;
    staff = (await createUser({ role: "ADMIN" })) as U;
  });
  afterAll(closeQaPool);

  async function confirmedBooking(opts: { dailyRateFils?: number; depositFils?: number; start?: Date; end?: Date; oneWay?: boolean } = {}) {
    const branch = await createBranch();
    const ret = opts.oneWay ? await createBranch() : branch;
    const cat = await createCategory({ dailyRateFils: opts.dailyRateFils ?? 20_000, depositFils: opts.depositFils ?? 50_000 });
    const v = await createVehicle({ branchId: branch.id, categoryId: cat.id });
    const start = opts.start ?? at(500);
    const end = opts.end ?? new Date(start.getTime() + 2 * 24 * H);
    const search = await searchVehicles({ pickupBranchId: branch.id, returnBranchId: ret.id, pickupAt: start, returnAt: end });
    expect(search.ok && search.vehicles.map((x) => x.id)).toContain(v.id);
    const h = await createReservationHold({
      userId: customer.id,
      vehicleId: v.id,
      pickupBranchId: branch.id,
      returnBranchId: ret.id,
      pickupAt: start,
      returnAt: end,
      idempotencyKey: randomUUID(),
    });
    if (!h.ok) throw new Error(h.message);
    expect((await saveDriverDetails(customer.id, h.reservationId, DRIVER)).ok).toBe(true);
    const p = await payReservation(customer.id, h.reservationId, { idempotencyKey: randomUUID() }, { provider });
    expect(p).toMatchObject({ ok: true, status: "confirmed" });
    return { ...h, vehicleId: v.id, branchId: branch.id, returnBranchId: ret.id, start, end };
  }

  // -------------------------------------------------------------------------
  describe("Q4 full rental", () => {
    it("search → pay → voucher → check-out → late return with fuel + damage → deposit captured, remainder outstanding", async () => {
      const b = await confirmedBooking({ dailyRateFils: 20_000, depositFils: 50_000, oneWay: true });

      // Voucher
      const voucher = await getVoucher(customer.id, b.reservationId);
      expect(voucher?.reference).toBe(b.reference);
      expect(voucher!.vehicle.plateNumber).toBeTruthy();
      expect(verifyVoucherCode(voucher!.qrPayload)).toBe(b.reference);
      expect(verifyVoucherCode(voucher!.qrPayload.replace(/.$/, (c) => (c === "0" ? "1" : "0")))).toBeNull();
      expect(verifyVoucherCode(`DRIVEEASY:${b.reference}:${"0".repeat(20)}`)).toBeNull();
      expect(await findReservationIdByCode(voucher!.qrPayload)).toBe(b.reservationId);
      expect(await findReservationIdByCode(b.reference.toLowerCase())).toBe(b.reservationId);
      expect(await getVoucher(other.id, b.reservationId)).toBeNull();

      // Check-out: too early, then on time
      const tooEarly = await admin.checkOut(staff, b.reservationId, { mileageKm: 10_000, fuelEighths: 8 }, { now: new Date(b.start.getTime() - 3 * H) });
      expect(tooEarly).toMatchObject({ ok: false, code: "invalid_state" });
      const out = await admin.checkOut(staff, b.reservationId, { mileageKm: 10_000, fuelEighths: 8 }, { now: b.start });
      expect(out).toMatchObject({ ok: true });
      expect((await row("reservations", b.reservationId)).status).toBe("PICKED_UP");
      expect((await row("vehicles", b.vehicleId)).status).toBe("ON_RENT");
      expect(await admin.checkOut(staff, b.reservationId, { mileageKm: 10_000, fuelEighths: 8 }, { now: b.start })).toMatchObject({ ok: false });
      // Voucher still visible while on rent
      expect(await getVoucher(customer.id, b.reservationId)).not.toBeNull();

      // Damage report with a private photo, charged 400 AED
      const dmg = await admin.createDamageReport(staff, {
        vehicleId: b.vehicleId,
        reservationId: b.reservationId,
        stage: "RETURN",
        severity: "MINOR",
        description: "Scratch on rear bumper",
        chargedFils: 40_000,
        photos: [{ data: JPEG, contentType: "image/jpeg" }],
      });
      expect(dmg.ok, JSON.stringify(dmg)).toBe(true);

      // Check-in 3h10m late, 2/8 less fuel, mileage lower than pick-up refused first
      expect(await admin.checkIn(staff, b.reservationId, { mileageKm: 9_000, fuelEighths: 6, returnedAt: new Date(b.end.getTime() + 190 * 60_000) })).toMatchObject({
        ok: false,
        code: "validation",
      });
      const res = await admin.checkIn(staff, b.reservationId, {
        mileageKm: 10_420,
        fuelEighths: 6,
        returnedAt: new Date(b.end.getTime() + 190 * 60_000),
        returnBranchId: b.returnBranchId,
      });
      expect(res.ok, JSON.stringify(res)).toBe(true);
      if (!res.ok) return;
      const late = 20_000; // 4 started hours x 25% capped at one daily rate
      const fuel = 2 * 6_000;
      const damage = 40_000;
      const vat = Math.round(((late + fuel + damage) * 5) / 100);
      expect(res).toMatchObject({
        lateMinutes: 190,
        lateFeeFils: late,
        fuelChargeFils: fuel,
        damageChargeFils: damage,
        vatFils: vat,
        totalChargesFils: late + fuel + damage + vat,
        depositCapturedFils: 50_000,
        outstandingFils: late + fuel + damage + vat - 50_000,
      });
      expect(res.settlementError).toBeUndefined();
      const r = await row("reservations", b.reservationId);
      expect(r.status).toBe("RETURNED");
      const v = await row("vehicles", b.vehicleId);
      expect(v).toMatchObject({ status: "AVAILABLE", mileage_km: 10_420, branch_id: b.returnBranchId });
      const dep = await row("deposits", b.reservationId, "reservation_id");
      expect(dep).toMatchObject({ status: "CAPTURED", captured_fils: 50_000 });
      const agreement = await row("rental_agreements", b.reservationId, "reservation_id");
      expect(agreement).toMatchObject({ late_fee_fils: late, outstanding_fils: res.outstandingFils, deposit_captured_fils: 50_000 });
      // Voucher no longer valid after return; second check-in refused
      expect(await getVoucher(customer.id, b.reservationId)).toBeNull();
      expect(await admin.checkIn(staff, b.reservationId, { mileageKm: 10_500, fuelEighths: 8 })).toMatchObject({ ok: false, code: "invalid_state" });
      const actions = (await qaPool().query(`select action from audit_logs where entity_id = $1`, [b.reservationId])).rows.map((x) => x.action);
      expect(actions).toEqual(expect.arrayContaining(["reservation.hold", "reservation.confirm", "reservation.check_out", "reservation.check_in"]));
    });

    it("on-time return with full tank: no charges, deposit released in full", async () => {
      const b = await confirmedBooking({ start: at(510) });
      expect(await admin.checkOut(staff, b.reservationId, { mileageKm: 500, fuelEighths: 8 }, { now: b.start })).toMatchObject({ ok: true });
      const res = await admin.checkIn(staff, b.reservationId, { mileageKm: 700, fuelEighths: 8, returnedAt: new Date(b.end.getTime() + 59 * 60_000) });
      expect(res).toMatchObject({ ok: true, totalChargesFils: 0, depositCapturedFils: 0, outstandingFils: 0, lateFeeFils: 0 });
      expect((await row("deposits", b.reservationId, "reservation_id")).status).toBe("RELEASED");
      const released = provider.listEvents().filter((e) => e.type === "deposit.released" && e.data.metadata?.reservationId === b.reservationId);
      expect(released).toHaveLength(1);
    });

    it("small charges are captured from the deposit and nothing is outstanding", async () => {
      const b = await confirmedBooking({ start: at(520), depositFils: 100_000 });
      await admin.checkOut(staff, b.reservationId, { mileageKm: 0, fuelEighths: 8 }, { now: b.start });
      const res = await admin.checkIn(staff, b.reservationId, { mileageKm: 10, fuelEighths: 7, returnedAt: b.end });
      expect(res).toMatchObject({ ok: true, fuelChargeFils: 6_000, vatFils: 300, totalChargesFils: 6_300, depositCapturedFils: 6_300, outstandingFils: 0 });
    });

    it("back-to-back: the next renter cannot be checked out while the car is still on rent", async () => {
      const a = await confirmedBooking({ start: at(530) });
      const nextHold = await createReservationHold({
        userId: other.id,
        vehicleId: a.vehicleId,
        pickupBranchId: a.branchId,
        returnBranchId: a.branchId,
        pickupAt: a.end,
        returnAt: new Date(a.end.getTime() + 24 * H),
        idempotencyKey: randomUUID(),
      });
      expect(nextHold.ok).toBe(true);
      if (!nextHold.ok) return;
      await saveDriverDetails(other.id, nextHold.reservationId, DRIVER);
      expect(await payReservation(other.id, nextHold.reservationId, { idempotencyKey: randomUUID() }, { provider })).toMatchObject({ status: "confirmed" });
      await admin.checkOut(staff, a.reservationId, { mileageKm: 0, fuelEighths: 8 }, { now: a.start });
      expect(await admin.checkOut(staff, nextHold.reservationId, { mileageKm: 0, fuelEighths: 8 }, { now: a.end })).toMatchObject({
        ok: false,
        code: "invalid_state",
      });
      await admin.checkIn(staff, a.reservationId, { mileageKm: 100, fuelEighths: 8, returnedAt: a.end });
      expect(await admin.checkOut(staff, nextHold.reservationId, { mileageKm: 100, fuelEighths: 8 }, { now: a.end })).toMatchObject({ ok: true });
    });

    it("cannot check out an unpaid (PENDING) reservation", async () => {
      const branch = await createBranch();
      const v = await createVehicle({ branchId: branch.id });
      const r = await insertReservation({ userId: customer.id, vehicleId: v.id, branchId: branch.id, startAt: at(540), endAt: at(541) });
      expect(await admin.checkOut(staff, r.id, { mileageKm: 0, fuelEighths: 8 }, { now: at(540) })).toMatchObject({ ok: false, code: "invalid_state" });
    });
  });

  // -------------------------------------------------------------------------
  describe("Q7 releaseExpiredHolds", () => {
    it("expires only past-due PENDING holds, frees the period, and is idempotent", async () => {
      const branch = await createBranch();
      const v1 = await createVehicle({ branchId: branch.id });
      const v2 = await createVehicle({ branchId: branch.id });
      const expired = await insertReservation({
        userId: customer.id,
        vehicleId: v1.id,
        branchId: branch.id,
        startAt: at(600),
        endAt: at(602),
        holdExpiresAt: new Date(Date.now() - 1000),
      });
      const live = await insertReservation({ userId: customer.id, vehicleId: v2.id, branchId: branch.id, startAt: at(600), endAt: at(602) });
      const first = await releaseExpiredHolds({ provider });
      expect(first.expired).toContain(expired.id);
      expect(first.expired).not.toContain(live.id);
      expect((await row("reservations", expired.id)).status).toBe("EXPIRED");
      expect((await row("reservations", live.id)).status).toBe("PENDING");
      const second = await releaseExpiredHolds({ provider });
      expect(second.expired).not.toContain(expired.id);
      // Period is bookable again
      const again = await createReservationHold({
        userId: other.id,
        vehicleId: v1.id,
        pickupBranchId: branch.id,
        returnBranchId: branch.id,
        pickupAt: at(600),
        returnAt: at(602),
        idempotencyKey: randomUUID(),
      });
      expect(again.ok).toBe(true);
    });

    it("concurrent runs expire each hold exactly once", async () => {
      const branch = await createBranch();
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) {
        const v = await createVehicle({ branchId: branch.id });
        ids.push(
          (await insertReservation({ userId: customer.id, vehicleId: v.id, branchId: branch.id, startAt: at(610), endAt: at(611), holdExpiresAt: new Date(Date.now() - 1000) })).id,
        );
      }
      const runs = await Promise.all(Array.from({ length: 4 }, () => releaseExpiredHolds({ provider })));
      const all = runs.flatMap((r) => r.expired).filter((id) => ids.includes(id));
      expect(all.sort()).toEqual([...ids].sort());
    });

    it("refunds a charge and releases a deposit left on an expired hold", async () => {
      const b = await confirmedBooking({ start: at(620) });
      // Simulate: payment went through but the reservation ended up EXPIRED (e.g. race with the sweep).
      await qaPool().query(`update reservations set status = 'EXPIRED' where id = $1`, [b.reservationId]);
      await releaseExpiredHolds({ provider });
      const pay = await row("payments", b.reservationId, "reservation_id");
      expect(pay.refunded_fils).toBe(pay.amount_fils);
      expect((await row("deposits", b.reservationId, "reservation_id")).status).toBe("RELEASED");
      const second = await releaseExpiredHolds({ provider });
      expect(second.settled).not.toContain(b.reservationId);
    });
  });

  // -------------------------------------------------------------------------
  describe("Q10 admin permissions (customer and anonymous denied server-side)", () => {
    const vid = "00000000-0000-4000-8000-000000000001";
    const calls: [string, (a: U | null) => Promise<unknown>][] = [
      ["adminListBranches", (a) => admin.adminListBranches(a as never)],
      ["createBranch", (a) => admin.createBranch(a as never, { code: "QAX1", name: "x", city: "Dubai", emirate: "Dubai", address: "Street 1", phone: "+97140000000", openingHours: "24h" })],
      ["updateBranch", (a) => admin.updateBranch(a as never, vid, { name: "pwned" })],
      ["adminListVehicles", (a) => admin.adminListVehicles(a as never)],
      ["adminGetVehicle", (a) => admin.adminGetVehicle(a as never, vid)],
      ["createVehicle", (a) => admin.createVehicle(a as never, {} as never)],
      ["updateVehicle", (a) => admin.updateVehicle(a as never, vid, { dailyRateFils: 1 } as never)],
      ["createCategory", (a) => admin.createCategory(a as never, {} as never)],
      ["updateCategory", (a) => admin.updateCategory(a as never, vid, { dailyRateFils: 1 } as never)],
      ["adminListExtras", (a) => admin.adminListExtras(a as never)],
      ["createExtra", (a) => admin.createExtra(a as never, {} as never)],
      ["updateExtra", (a) => admin.updateExtra(a as never, vid, { priceFils: 0 } as never)],
      ["listPricingRules", (a) => admin.listPricingRules(a as never)],
      ["createPricingRule", (a) => admin.createPricingRule(a as never, {} as never)],
      ["updatePricingRule", (a) => admin.updatePricingRule(a as never, vid, {} as never)],
      ["deletePricingRule", (a) => admin.deletePricingRule(a as never, vid)],
      ["adminListReservations", (a) => admin.adminListReservations(a as never)],
      ["adminGetReservation", (a) => admin.adminGetReservation(a as never, vid)],
      ["adminCancelReservation", (a) => admin.adminCancelReservation(a as never, vid)],
      ["checkOut", (a) => admin.checkOut(a as never, vid, { mileageKm: 1, fuelEighths: 8 })],
      ["checkIn", (a) => admin.checkIn(a as never, vid, { mileageKm: 1, fuelEighths: 8 })],
      ["listDamageReports", (a) => admin.listDamageReports(a as never)],
      ["createDamageReport", (a) => admin.createDamageReport(a as never, { vehicleId: vid, severity: "MINOR", description: "xxx" })],
      ["updateDamageReport", (a) => admin.updateDamageReport(a as never, vid, { status: "RESOLVED" })],
      ["listMaintenanceBlocks", (a) => admin.listMaintenanceBlocks(a as never)],
      ["createMaintenanceBlock", (a) => admin.createMaintenanceBlock(a as never, { vehicleId: vid, startAt: at(700), endAt: at(701), reason: "x" })],
      ["cancelMaintenanceBlock", (a) => admin.cancelMaintenanceBlock(a as never, vid)],
      ["listAuditLogs", (a) => admin.listAuditLogs(a as never)],
    ];

    async function outcome(fn: () => Promise<unknown>) {
      try {
        const r = (await fn()) as { ok?: boolean; code?: string } | unknown[];
        if (r && !Array.isArray(r) && r.ok === false) return r.code;
        return "allowed";
      } catch (e) {
        return (e as { code?: string }).code ?? "threw";
      }
    }

    it.each(calls)("%s: customer → forbidden, anonymous → unauthenticated", async (_name, call) => {
      expect(await outcome(() => call(customer))).toBe("forbidden");
      expect(await outcome(() => call(null))).toBe("unauthenticated");
      // A forged role on a non-admin user id still only works because the service trusts `actor.role`;
      // the role must come from requireAdmin() (session), which e2e covers.
    });

    it("admin can create, update and list fleet and pricing", async () => {
      const code = `QA${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const br = await admin.createBranch(staff, { code, name: "QA Branch", city: "Dubai", emirate: "Dubai", address: "Street 1 QA", phone: "+97140000000", openingHours: "24h" });
      expect(br.ok, JSON.stringify(br)).toBe(true);
      expect(await admin.createBranch(staff, { code, name: "Dup", city: "Dubai", emirate: "Dubai", address: "Street 1 QA", phone: "+97140000000", openingHours: "24h" })).toMatchObject({
        ok: false,
      });
      const list = await admin.adminListBranches(staff);
      expect(JSON.stringify(list)).toContain(code);
      const audit = await qaPool().query(`select 1 from audit_logs where actor_user_id = $1`, [staff.id]);
      expect(audit.rowCount).toBeGreaterThan(0);
    });

    it("customer cannot create a damage report or check in even with a valid reservation id", async () => {
      const b = await confirmedBooking({ start: at(710) });
      expect(await outcome(() => admin.checkOut(customer, b.reservationId, { mileageKm: 0, fuelEighths: 8 }, { now: b.start }))).toBe("forbidden");
      expect((await row("reservations", b.reservationId)).status).toBe("CONFIRMED");
      expect(
        await outcome(() => admin.createDamageReport(customer, { vehicleId: b.vehicleId, reservationId: b.reservationId, severity: "MAJOR", description: "fake", chargedFils: 999_999 })),
      ).toBe("forbidden");
    });
  });

  // -------------------------------------------------------------------------
  describe("Q10 private licence files", () => {
    it("validateUpload checks type, size and magic bytes", () => {
      const types = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
      expect(() => validateUpload({ data: JPEG, contentType: "image/jpeg" }, types)).not.toThrow();
      expect(() => validateUpload({ data: PNG, contentType: "image/png" }, types)).not.toThrow();
      expect(() => validateUpload({ data: PDF, contentType: "application/pdf" }, types)).not.toThrow();
      expect(() => validateUpload({ data: Buffer.from("MZ\x90\x00 evil"), contentType: "image/jpeg" }, types)).toThrow(/does not match/);
      expect(() => validateUpload({ data: JPEG, contentType: "text/html" }, types)).toThrow(/Unsupported/);
      expect(() => validateUpload({ data: Buffer.alloc(0), contentType: "image/jpeg" }, types)).toThrow(/empty/);
      expect(() => validateUpload({ data: Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]), contentType: "image/jpeg" }, types)).toThrow(/too large/);
      expect(() => validateUpload({ data: Buffer.from("<svg onload=alert(1)>"), contentType: "image/svg+xml" }, types)).toThrow();
    });

    it("owner and admins can read a licence; other users, anonymous and path tricks cannot", async () => {
      const owner = (await createUser()) as U;
      const branch = await createBranch();
      const v = await createVehicle({ branchId: branch.id });
      const h = await createReservationHold({
        userId: owner.id,
        vehicleId: v.id,
        pickupBranchId: branch.id,
        returnBranchId: branch.id,
        pickupAt: at(800),
        returnAt: at(801),
        idempotencyKey: randomUUID(),
      });
      if (!h.ok) throw new Error(h.message);
      // Upload requires driver details first
      expect(await uploadLicence(owner.id, { data: JPEG, contentType: "image/jpeg" })).toMatchObject({ ok: false, code: "validation" });
      await saveDriverDetails(owner.id, h.reservationId, DRIVER);
      const up = await uploadLicence(owner.id, { data: JPEG, contentType: "image/jpeg" });
      expect(up.ok).toBe(true);
      if (!up.ok) return;
      expect(up.key.startsWith(`licences/${owner.id}/`)).toBe(true);

      expect((await getAuthorizedFile(owner, up.key))?.data.equals(JPEG)).toBe(true);
      expect(await getAuthorizedFile(staff, up.key)).not.toBeNull();
      expect(await getAuthorizedFile(other, up.key)).toBeNull();
      expect(await getAuthorizedFile(null, up.key)).toBeNull();
      // Forge: other user puts their own id in the path / traversal / backslashes
      expect(await getAuthorizedFile(other, up.key.replace(owner.id, other.id))).toBeNull();
      expect(await getAuthorizedFile(other, `licences/${other.id}/../${owner.id}/${up.key.split("/").pop()}`)).toBeNull();
      expect(await getAuthorizedFile(other, up.key.replaceAll("/", "\\"))).toBeNull();
      expect(await getAuthorizedFile(owner, "../../.env.local")).toBeNull();
      expect(await getAuthorizedFile(staff, "../.env.local")).toBeNull();

      // Replacing the licence: old key is no longer served
      const up2 = await uploadLicence(owner.id, { data: PDF, contentType: "application/pdf" });
      expect(up2.ok).toBe(true);
      expect(await getAuthorizedFile(owner, up.key)).toBeNull();
      expect((await getAuthorizedFile(owner, (up2 as { key: string }).key))?.contentType).toBe("application/pdf");
    });

    it("damage photos: admins and the renter only", async () => {
      const b = await confirmedBooking({ start: at(820) });
      const d = await admin.createDamageReport(staff, {
        vehicleId: b.vehicleId,
        reservationId: b.reservationId,
        severity: "MINOR",
        description: "Dent",
        photos: [{ data: PNG, contentType: "image/png" }],
      });
      expect(d.ok).toBe(true);
      const [report] = (await qaPool().query(`select image_keys from damage_reports where id = $1`, [(d as { id: string }).id])).rows;
      const k = report.image_keys[0] as string;
      expect(await getAuthorizedFile(staff, k)).not.toBeNull();
      expect(await getAuthorizedFile(customer, k)).not.toBeNull();
      expect(await getAuthorizedFile(other, k)).toBeNull();
      expect(await getAuthorizedFile(null, k)).toBeNull();
    });
  });

  it("voucher codes are bound to the reference", () => {
    const code = voucherCode("DE-ABCDEF");
    expect(verifyVoucherCode(code)).toBe("DE-ABCDEF");
    expect(verifyVoucherCode(code.replace("DE-ABCDEF", "DE-ABCDEG"))).toBeNull();
  });
});
