// Q8: pricing maths (pure functions). Integer fils only, VAT 5 %, no float drift.
import { describe, expect, it } from "vitest";
import { VAT_RATE_BPS } from "@/server/policy";
import {
  bp,
  computeFuelCharge,
  computeLateCharge,
  computeQuote,
  oneWayFee,
  rentalDays,
  validateRange,
  type ExtraInput,
  type QuoteInput,
  type RuleInput,
} from "@/server/pricing";

const H = 3_600_000;
const D = 24 * H;
const T0 = new Date("2031-03-01T08:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

const CAT = "cat-1";
const DXB = "br-dxb";
const AUH = "br-auh";
const SHJ = "br-shj";

const rule = (r: Partial<RuleInput> & Pick<RuleInput, "type">): RuleInput => ({
  categoryId: null,
  pickupBranchId: null,
  returnBranchId: null,
  validFrom: null,
  validTo: null,
  minDays: null,
  adjustmentBp: null,
  feeFils: null,
  ...r,
});

const GPS: ExtraInput = { id: "gps", code: "GPS", name: "GPS", pricing: "PER_DAY", priceFils: 2_500, maxPriceFils: 15_000, maxQuantity: 1, active: true };
const SEAT: ExtraInput = { id: "seat", code: "CHILD_SEAT", name: "Child seat", pricing: "PER_DAY", priceFils: 3_000, maxPriceFils: null, maxQuantity: 3, active: true };
const INS: ExtraInput = { id: "ins", code: "FULL_INSURANCE", name: "Full insurance", pricing: "PER_RENTAL", priceFils: 9_999, maxPriceFils: null, maxQuantity: 1, active: true };
const OFF: ExtraInput = { ...GPS, id: "off", code: "OFF", active: false };

const base = (over: Partial<QuoteInput> = {}): QuoteInput => ({
  startAt: T0,
  endAt: at(3 * D),
  dailyRateFils: 15_000,
  depositFils: 100_000,
  categoryId: CAT,
  pickupBranchId: DXB,
  returnBranchId: DXB,
  rules: [],
  extras: [GPS, SEAT, INS, OFF],
  selection: [],
  ...over,
});

describe("rentalDays", () => {
  it("counts each started 24h block, minimum 1", () => {
    expect(rentalDays(T0, at(1))).toBe(1);
    expect(rentalDays(T0, at(D))).toBe(1);
    expect(rentalDays(T0, at(D + 1))).toBe(2);
    expect(rentalDays(T0, at(3 * D))).toBe(3);
    expect(rentalDays(T0, at(3 * D + 60_000))).toBe(4);
  });
});

describe("validateRange", () => {
  const now = new Date("2031-02-01T00:00:00Z");
  it("rejects end <= start, too-soon pick-up, > 90 days, invalid dates", () => {
    expect(() => validateRange(at(D), at(D), now)).toThrow(/after pick-up/);
    expect(() => validateRange(at(D), at(0), now)).toThrow(/after pick-up/);
    expect(() => validateRange(new Date(now.getTime() + 10 * 60_000), new Date(now.getTime() + D), now)).toThrow(/minutes/);
    expect(() => validateRange(T0, at(90 * D + 1), now)).toThrow(/90/);
    expect(() => validateRange(new Date("nope"), T0, now)).toThrow();
  });
  it("accepts exactly 90 days and a pick-up 60 minutes ahead", () => {
    expect(() => validateRange(T0, at(90 * D), now)).not.toThrow();
    expect(() => validateRange(new Date(now.getTime() + 60 * 60_000), new Date(now.getTime() + D), now)).not.toThrow();
  });
});

describe("computeQuote", () => {
  it("3 days at AED 150 → base 45000, VAT 5% = 2250, total 47250, deposit separate", () => {
    const q = computeQuote(base());
    expect(q).toMatchObject({
      days: 3,
      dailyRateFils: 15_000,
      baseFils: 45_000,
      seasonalAdjustmentFils: 0,
      durationDiscountFils: 0,
      extrasFils: 0,
      oneWayFeeFils: 0,
      subtotalFils: 45_000,
      vatRateBps: VAT_RATE_BPS,
      vatFils: 2_250,
      totalFils: 47_250,
      depositFils: 100_000,
    });
    expect(VAT_RATE_BPS).toBe(500);
  });

  it("partial day rounds up to a full day", () => {
    expect(computeQuote(base({ endAt: at(2 * D + H) })).baseFils).toBe(45_000);
  });

  it("extras: PER_DAY x days with cap, PER_DAY x quantity, PER_RENTAL once", () => {
    const q = computeQuote(
      base({
        endAt: at(7 * D),
        selection: [
          { extraId: "gps", quantity: 1 }, // 7 x 2500 = 17500 capped at 15000
          { extraId: "seat", quantity: 2 }, // 2 x 7 x 3000 = 42000
          { extraId: "ins", quantity: 1 }, // 9999
        ],
      }),
    );
    const byCode = Object.fromEntries(q.extras.map((e) => [e.code, e.totalFils]));
    expect(byCode).toEqual({ GPS: 15_000, CHILD_SEAT: 42_000, FULL_INSURANCE: 9_999 });
    expect(q.extrasFils).toBe(66_999);
    expect(q.subtotalFils).toBe(7 * 15_000 + 66_999);
    expect(q.vatFils).toBe(Math.round(((7 * 15_000 + 66_999) * 5) / 100));
    expect(q.totalFils).toBe(q.subtotalFils + q.vatFils);
  });

  it("rejects inactive / unknown extras and quantities above the max", () => {
    expect(() => computeQuote(base({ selection: [{ extraId: "off", quantity: 1 }] }))).toThrow();
    expect(() => computeQuote(base({ selection: [{ extraId: "nope", quantity: 1 }] }))).toThrow();
    expect(() => computeQuote(base({ selection: [{ extraId: "seat", quantity: 4 }] }))).toThrow(/at most 3/);
    expect(() => computeQuote(base({ selection: [{ extraId: "seat", quantity: 1.5 }] }))).toThrow();
  });

  it("quantity 0 extras are ignored", () => {
    expect(computeQuote(base({ selection: [{ extraId: "seat", quantity: 0 }] })).extras).toEqual([]);
  });

  it("one-way fee applies only when branches differ, and is taxed", () => {
    const rules = [rule({ type: "ONE_WAY_FEE", feeFils: 25_000 })];
    expect(computeQuote(base({ rules })).oneWayFeeFils).toBe(0);
    const q = computeQuote(base({ rules, returnBranchId: AUH }));
    expect(q.oneWayFeeFils).toBe(25_000);
    expect(q.subtotalFils).toBe(70_000);
    expect(q.vatFils).toBe(3_500);
    expect(q.totalFils).toBe(73_500);
  });

  it("most specific one-way rule wins", () => {
    const rules = [
      rule({ type: "ONE_WAY_FEE", feeFils: 10_000 }),
      rule({ type: "ONE_WAY_FEE", feeFils: 20_000, returnBranchId: AUH }),
      rule({ type: "ONE_WAY_FEE", feeFils: 30_000, pickupBranchId: DXB, returnBranchId: AUH }),
      rule({ type: "ONE_WAY_FEE", feeFils: 99_000, pickupBranchId: SHJ, returnBranchId: AUH }),
    ];
    expect(oneWayFee(rules, CAT, DXB, AUH)).toBe(30_000);
    expect(oneWayFee(rules, CAT, SHJ, AUH)).toBe(99_000);
    expect(oneWayFee(rules, CAT, AUH, DXB)).toBe(10_000);
    expect(oneWayFee(rules, CAT, AUH, SHJ)).toBe(10_000);
    expect(oneWayFee([rule({ type: "ONE_WAY_FEE", feeFils: 5_000, categoryId: "other" })], CAT, DXB, AUH)).toBe(0);
  });

  it("seasonal adjustment applies per day whose start lies in the window", () => {
    // +20% for days starting in [T0+1d, T0+2d)
    const rules = [rule({ type: "SEASONAL", validFrom: at(D), validTo: at(2 * D), adjustmentBp: 2_000 })];
    const q = computeQuote(base({ rules }));
    expect(q.baseFils).toBe(15_000 + 18_000 + 15_000);
    expect(q.seasonalAdjustmentFils).toBe(3_000);
  });

  it("seasonal rule for another category does not apply", () => {
    const rules = [rule({ type: "SEASONAL", categoryId: "other", validFrom: at(0), validTo: at(10 * D), adjustmentBp: 5_000 })];
    expect(computeQuote(base({ rules })).baseFils).toBe(45_000);
  });

  it("only the best duration discount applies, from minDays", () => {
    const rules = [
      rule({ type: "DURATION_DISCOUNT", minDays: 3, adjustmentBp: -500 }),
      rule({ type: "DURATION_DISCOUNT", minDays: 7, adjustmentBp: -1_500 }),
    ];
    expect(computeQuote(base({ rules, endAt: at(2 * D) })).durationDiscountFils).toBe(0);
    expect(computeQuote(base({ rules })).durationDiscountFils).toBe(2_250);
    const week = computeQuote(base({ rules, endAt: at(7 * D) }));
    expect(week.durationDiscountFils).toBe(15_750);
    expect(week.subtotalFils).toBe(105_000 - 15_750);
  });

  it("odd amounts: VAT rounds half up to whole fils", () => {
    // 1 day at 1 fils -> VAT 0.05 -> 0; 10 fils -> 0.5 -> 1; 30 fils -> 1.5 -> 2
    expect(computeQuote(base({ dailyRateFils: 1, endAt: at(D) })).vatFils).toBe(0);
    expect(computeQuote(base({ dailyRateFils: 10, endAt: at(D) })).vatFils).toBe(1);
    expect(computeQuote(base({ dailyRateFils: 30, endAt: at(D) })).vatFils).toBe(2);
  });

  it("property: every amount is a non-negative integer and totals add up (2000 random quotes)", () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 2000; i++) {
      const rules: RuleInput[] = [
        rule({ type: "SEASONAL", validFrom: at(rnd(5) * D), validTo: at((5 + rnd(20)) * D), adjustmentBp: rnd(6000) - 3000 }),
        rule({ type: "DURATION_DISCOUNT", minDays: 1 + rnd(10), adjustmentBp: -(1 + rnd(3000)) }),
        rule({ type: "ONE_WAY_FEE", feeFils: rnd(50_000) }),
      ];
      const q = computeQuote(
        base({
          dailyRateFils: 1 + rnd(200_000),
          endAt: at(1 + rnd(90 * D)),
          rules,
          returnBranchId: rnd(2) ? DXB : AUH,
          selection: [
            { extraId: "gps", quantity: rnd(2) },
            { extraId: "seat", quantity: rnd(4) },
            { extraId: "ins", quantity: rnd(2) },
          ],
        }),
      );
      for (const k of ["baseFils", "durationDiscountFils", "extrasFils", "oneWayFeeFils", "subtotalFils", "vatFils", "totalFils", "depositFils"] as const) {
        expect(Number.isInteger(q[k]) && q[k] >= 0, `${k}=${q[k]}`).toBe(true);
      }
      expect(Number.isInteger(q.seasonalAdjustmentFils)).toBe(true);
      expect(q.subtotalFils).toBe(q.baseFils - q.durationDiscountFils + q.extrasFils + q.oneWayFeeFils);
      expect(q.extrasFils).toBe(q.extras.reduce((s, e) => s + e.totalFils, 0));
      expect(q.vatFils).toBe(bp(q.subtotalFils, 500));
      expect(q.totalFils).toBe(q.subtotalFils + q.vatFils);
    }
  });
});

describe("computeLateCharge (25% of daily rate per started hour after 59 min grace, capped at a day per 24h)", () => {
  const end = T0;
  const rate = 20_000;
  const late = (min: number) => computeLateCharge(end, new Date(end.getTime() + min * 60_000), rate);

  it("on time / early / within grace is free", () => {
    expect(late(-30).feeFils).toBe(0);
    expect(late(0).feeFils).toBe(0);
    expect(late(59).feeFils).toBe(0);
  });
  it("60 minutes late = 1 hour = 25%", () => {
    expect(late(60)).toEqual({ lateMinutes: 60, chargeableHours: 1, feeFils: 5_000 });
  });
  it("3h10m late = 4 started hours capped at one daily rate", () => {
    expect(late(190).feeFils).toBe(20_000);
  });
  it("2h late = 2 hours = 50%", () => {
    expect(late(120).feeFils).toBe(10_000);
  });
  it("exactly 24h late = one daily rate; 25h late = one day + one hour", () => {
    expect(late(1440).feeFils).toBe(20_000);
    expect(late(1500).feeFils).toBe(25_000);
  });
  it("is an integer for odd daily rates", () => {
    expect(Number.isInteger(computeLateCharge(end, new Date(end.getTime() + 61 * 60_000), 33_333).feeFils)).toBe(true);
  });
});

describe("computeFuelCharge", () => {
  it("charges AED 60 per missing eighth, never negative", () => {
    expect(computeFuelCharge(8, 8)).toBe(0);
    expect(computeFuelCharge(8, 5)).toBe(18_000);
    expect(computeFuelCharge(4, 8)).toBe(0);
  });
});
