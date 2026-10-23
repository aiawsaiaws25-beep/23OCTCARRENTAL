// Q3: search, branches, date ranges, filters, availability calendar (service level, real Postgres).
// Seeded pricing rules: festive +20% (Dec/Jan of the seed year), weekly/monthly discounts (7+/28+ days),
// generic one-way fee. Tests use 2031 dates and <7-day rentals so only their own rules apply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getQuote, getVehicleCalendar, searchVehicles } from "@/server/catalog";
import { hasMigrations } from "../helpers/db";
import {
  at,
  closeQaPool,
  createBranch,
  createCategory,
  createOneWayRule,
  createUser,
  createVehicle,
  insertMaintenance,
  insertReservation,
  qaPool,
} from "../helpers/factory";

const D = 86_400_000;

describe.runIf(hasMigrations())("catalog", () => {
  let userId: string;
  beforeAll(async () => {
    userId = (await createUser()).id;
  });
  afterAll(closeQaPool);

  async function ids(params: Parameters<typeof searchVehicles>[0]) {
    const r = await searchVehicles(params);
    if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
    return r.vehicles.map((v) => v.id);
  }

  describe("search + availability", () => {
    it("returns only bookable vehicles at the pick-up branch free for the whole period", async () => {
      const branch = await createBranch();
      const other = await createBranch();
      const cat = await createCategory();
      const free = await createVehicle({ branchId: branch.id, categoryId: cat.id });
      const booked = await createVehicle({ branchId: branch.id, categoryId: cat.id });
      const backToBack = await createVehicle({ branchId: branch.id, categoryId: cat.id });
      const maint = await createVehicle({ branchId: branch.id, categoryId: cat.id });
      const retired = await createVehicle({ branchId: branch.id, categoryId: cat.id, status: "RETIRED" });
      const outOfService = await createVehicle({ branchId: branch.id, categoryId: cat.id, status: "MAINTENANCE" });
      const elsewhere = await createVehicle({ branchId: other.id, categoryId: cat.id });

      await insertReservation({ userId, vehicleId: booked.id, branchId: branch.id, startAt: at(2), endAt: at(4), status: "CONFIRMED" });
      await insertReservation({ userId, vehicleId: backToBack.id, branchId: branch.id, startAt: at(0), endAt: at(1), status: "CONFIRMED" });
      await insertReservation({ userId, vehicleId: backToBack.id, branchId: branch.id, startAt: at(3), endAt: at(5), status: "CONFIRMED" });
      await insertMaintenance(maint.id, at(2, 0), at(2, 12));

      const found = await ids({ pickupBranchId: branch.id, pickupAt: at(1), returnAt: at(3) });
      expect(found).toContain(free.id);
      expect(found).toContain(backToBack.id); // [1,3) touches [0,1) and [3,5) only at the edges
      expect(found).not.toContain(booked.id);
      expect(found).not.toContain(maint.id);
      expect(found).not.toContain(retired.id);
      expect(found).not.toContain(outOfService.id);
      expect(found).not.toContain(elsewhere.id);
    });

    it("cancelled reservations and expired-but-unreleased holds do not block search", async () => {
      const branch = await createBranch();
      const a = await createVehicle({ branchId: branch.id });
      const b = await createVehicle({ branchId: branch.id });
      await insertReservation({ userId, vehicleId: a.id, branchId: branch.id, startAt: at(10), endAt: at(12), status: "CANCELLED" });
      // PENDING hold whose expiry has passed but the cron has not run yet.
      await insertReservation({
        userId,
        vehicleId: b.id,
        branchId: branch.id,
        startAt: at(10),
        endAt: at(12),
        status: "PENDING",
        holdExpiresAt: new Date(Date.now() - 60_000),
      });
      const found = await ids({ pickupBranchId: branch.id, pickupAt: at(10), returnAt: at(12) });
      expect(found).toEqual(expect.arrayContaining([a.id, b.id]));
    });

    it("an active PENDING hold blocks search", async () => {
      const branch = await createBranch();
      const v = await createVehicle({ branchId: branch.id });
      await insertReservation({ userId, vehicleId: v.id, branchId: branch.id, startAt: at(20), endAt: at(22), status: "PENDING" });
      expect(await ids({ pickupBranchId: branch.id, pickupAt: at(21), returnAt: at(23) })).not.toContain(v.id);
    });

    it("filters: category, transmission, fuel, seats, price range; sorts by price", async () => {
      const branch = await createBranch();
      const suv = await createCategory({ dailyRateFils: 40_000 });
      const eco = await createCategory({ dailyRateFils: 10_000 });
      const cheap = await createVehicle({ branchId: branch.id, categoryId: eco.id, transmission: "MANUAL", fuelType: "PETROL", seats: 4 });
      const mid = await createVehicle({ branchId: branch.id, categoryId: eco.id, dailyRateFils: 20_000, fuelType: "HYBRID", seats: 5 });
      const big = await createVehicle({ branchId: branch.id, categoryId: suv.id, fuelType: "DIESEL", seats: 7 });
      const base = { pickupBranchId: branch.id, pickupAt: at(30), returnAt: at(32) };

      expect(await ids({ ...base, categoryId: suv.id })).toEqual([big.id]);
      expect(await ids({ ...base, transmission: "MANUAL" })).toEqual([cheap.id]);
      expect(await ids({ ...base, fuelType: "HYBRID" })).toEqual([mid.id]);
      expect((await ids({ ...base, minSeats: 5 })).sort()).toEqual([mid.id, big.id].sort());
      expect(await ids({ ...base, maxDailyRateFils: 15_000 })).toEqual([cheap.id]);
      expect(await ids({ ...base, minDailyRateFils: 15_000, maxDailyRateFils: 30_000 })).toEqual([mid.id]);
      expect(await ids({ ...base })).toEqual([cheap.id, mid.id, big.id]);
      expect(await ids({ ...base, sort: "price_desc" })).toEqual([big.id, mid.id, cheap.id]);
    });

    it("search totals include one-way fee + VAT and match getQuote", async () => {
      const pick = await createBranch();
      const ret = await createBranch();
      const cat = await createCategory({ dailyRateFils: 12_345 });
      const v = await createVehicle({ branchId: pick.id, categoryId: cat.id });
      await createOneWayRule(pick.id, ret.id, 20_000);
      const r = await searchVehicles({ pickupBranchId: pick.id, returnBranchId: ret.id, pickupAt: at(40), returnAt: at(43) });
      if (!r.ok) throw new Error(r.message);
      const hit = r.vehicles.find((x) => x.id === v.id)!;
      expect(hit.days).toBe(3);
      expect(hit.oneWayFeeFils).toBe(20_000);
      const subtotal = 3 * 12_345 + 20_000;
      expect(hit.estimatedTotalFils).toBe(subtotal + Math.round((subtotal * 5) / 100));
      const q = await getQuote({ vehicleId: v.id, pickupBranchId: pick.id, returnBranchId: ret.id, pickupAt: at(40), returnAt: at(43) });
      expect(q.ok && q.quote.totalFils).toBe(hit.estimatedTotalFils);
    });

    it("rejects bad date ranges, unknown and inactive branches", async () => {
      const branch = await createBranch();
      expect(await searchVehicles({ pickupBranchId: branch.id, pickupAt: at(5), returnAt: at(5) })).toMatchObject({ ok: false, code: "invalid_range" });
      expect(await searchVehicles({ pickupBranchId: branch.id, pickupAt: new Date(Date.now() - D), returnAt: at(5) })).toMatchObject({
        ok: false,
        code: "invalid_range",
      });
      expect(await searchVehicles({ pickupBranchId: branch.id, pickupAt: at(0), returnAt: at(91) })).toMatchObject({ ok: false, code: "invalid_range" });
      expect(
        await searchVehicles({ pickupBranchId: "00000000-0000-4000-8000-000000000000", pickupAt: at(1), returnAt: at(2) }),
      ).toMatchObject({ ok: false, code: "not_found" });
      const closed = await createBranch();
      await qaPool().query(`update branches set active = false where id = $1`, [closed.id]);
      expect(await searchVehicles({ pickupBranchId: branch.id, returnBranchId: closed.id, pickupAt: at(1), returnAt: at(2) })).toMatchObject({
        ok: false,
        code: "branch_closed",
      });
    });

    it("non-uuid branch ids are a clean not_found, not a 500", async () => {
      await expect(searchVehicles({ pickupBranchId: "DXB'; drop table x;--", pickupAt: at(1), returnAt: at(2) })).resolves.toMatchObject({
        ok: false,
      });
    });

    it("getQuote: unavailable when booked, ok back-to-back, not_found for junk ids, validation for another branch", async () => {
      const branch = await createBranch();
      const other = await createBranch();
      const v = await createVehicle({ branchId: branch.id });
      await insertReservation({ userId, vehicleId: v.id, branchId: branch.id, startAt: at(50), endAt: at(52), status: "CONFIRMED" });
      const p = { vehicleId: v.id, pickupBranchId: branch.id, returnBranchId: branch.id };
      expect(await getQuote({ ...p, pickupAt: at(51), returnAt: at(53) })).toMatchObject({ ok: false, code: "unavailable" });
      expect(await getQuote({ ...p, pickupAt: at(52), returnAt: at(53) })).toMatchObject({ ok: true });
      expect(await getQuote({ ...p, vehicleId: "not-a-uuid", pickupAt: at(60), returnAt: at(61) })).toMatchObject({ ok: false, code: "not_found" });
      expect(await getQuote({ ...p, pickupBranchId: other.id, pickupAt: at(60), returnAt: at(61) })).toMatchObject({ ok: false, code: "validation" });
    });
  });

  describe("availability calendar (Asia/Dubai)", () => {
    // Dubai is UTC+4 all year.
    const dubai = (local: string) => new Date(`${local}+04:00`);

    it("marks available / partial / booked / maintenance days in branch local time", async () => {
      const v = await createVehicle();
      const r = (startAt: Date, endAt: Date, status: "CONFIRMED" | "PENDING" = "CONFIRMED") =>
        insertReservation({ userId, vehicleId: v.id, branchId: v.branchId, startAt, endAt, status });
      // 10 May 10:00 -> 12 May 10:00 Dubai: 10 partial, 11 booked, 12 partial.
      await r(dubai("2031-05-10T10:00:00"), dubai("2031-05-12T10:00:00"));
      await insertMaintenance(v.id, dubai("2031-05-14T00:00:00"), dubai("2031-05-15T00:00:00"));
      // Two back-to-back bookings covering all of 16 May.
      await r(dubai("2031-05-16T00:00:00"), dubai("2031-05-16T12:00:00"));
      await r(dubai("2031-05-16T12:00:00"), dubai("2031-05-17T00:00:00"), "PENDING");

      const cal = await getVehicleCalendar(v.id, "2031-05-09", 9);
      expect(cal?.timeZone).toBe("Asia/Dubai");
      expect(Object.fromEntries(cal!.days.map((d) => [d.date, d.status]))).toEqual({
        "2031-05-09": "available",
        "2031-05-10": "partial",
        "2031-05-11": "booked",
        "2031-05-12": "partial",
        "2031-05-13": "available",
        "2031-05-14": "maintenance",
        "2031-05-15": "available",
        "2031-05-16": "booked",
        "2031-05-17": "available",
      });
      // No customer data in the calendar.
      expect(JSON.stringify(cal)).not.toMatch(/user|email|name|reference|driver/i);
    });

    it("ignores cancelled reservations and expired holds", async () => {
      const v = await createVehicle();
      await insertReservation({ userId, vehicleId: v.id, branchId: v.branchId, startAt: dubai("2031-06-01T00:00:00"), endAt: dubai("2031-06-02T00:00:00"), status: "CANCELLED" });
      await insertReservation({
        userId,
        vehicleId: v.id,
        branchId: v.branchId,
        startAt: dubai("2031-06-03T00:00:00"),
        endAt: dubai("2031-06-04T00:00:00"),
        status: "PENDING",
        holdExpiresAt: new Date(Date.now() - 1000),
      });
      const cal = await getVehicleCalendar(v.id, "2031-06-01", 4);
      expect(cal!.days.map((d) => d.status)).toEqual(["available", "available", "available", "available"]);
    });

    it("returns null for junk input and caps the window at 120 days", async () => {
      const v = await createVehicle();
      expect(await getVehicleCalendar("nope", "2031-01-01", 7)).toBeNull();
      expect(await getVehicleCalendar("00000000-0000-4000-8000-000000000000", "2031-01-01", 7)).toBeNull();
      expect(await getVehicleCalendar(v.id, "01/01/2031", 7)).toBeNull();
      expect((await getVehicleCalendar(v.id, "2031-01-01", 1000))!.days).toHaveLength(120);
    });

    it("does not throw on an impossible calendar date (2031-13-45)", async () => {
      const v = await createVehicle();
      await expect(getVehicleCalendar(v.id, "2031-13-45", 7)).resolves.toBeNull();
    });
  });
});
