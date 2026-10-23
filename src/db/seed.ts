// Sample data for local development and tests: `pnpm db:seed [--url <url>] [--reset]`.
// Safe to call on an already-seeded DB (it skips). Test-account passwords are
// generated randomly and written to .local/seed-accounts.json (gitignored); an
// existing file is reused so logins stay stable across re-seeds.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { count, sql } from "drizzle-orm";
import { computeQuote, type RuleInput } from "@/server/pricing";
import type { Database } from "./client";
import * as s from "./schema";

export const SEED_ACCOUNTS_FILE = resolve(process.cwd(), ".local/seed-accounts.json");

export type SeedAccount = { role: "ADMIN" | "CUSTOMER"; name: string; email: string; password: string };
export type SeedOptions = {
  /** Override passwords (e.g. tests). Otherwise generated / read from SEED_ACCOUNTS_FILE. */
  passwords?: { admin?: string; customer?: string };
  /** Write the credentials file (default true). */
  writeAccountsFile?: boolean;
  /** Reference "now" for future reservations (default: current time). */
  now?: Date;
};
export type SeedResult = {
  skipped: boolean;
  branches: number;
  vehicles: number;
  reservations: number;
  accounts: SeedAccount[];
  accountsFile?: string;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const BRANCHES = [
  {
    code: "DXB",
    name: "Dubai Airport (DXB)",
    city: "Dubai",
    emirate: "Dubai",
    address: "Terminal 3 Arrivals, Car Rental Hall, Dubai International Airport",
    phone: "+971 4 000 1001",
    email: "dxb@driveeasy.test",
    openingHours: "Open 24 hours, 7 days a week",
    isAirport: true,
    latitude: 25.2528,
    longitude: 55.3644,
  },
  {
    code: "DMR",
    name: "Dubai Marina",
    city: "Dubai",
    emirate: "Dubai",
    address: "Marina Walk, Tower A, Ground Floor, Dubai Marina",
    phone: "+971 4 000 1002",
    email: "marina@driveeasy.test",
    openingHours: "Daily 08:00-22:00",
    isAirport: false,
    latitude: 25.0805,
    longitude: 55.1403,
  },
  {
    code: "AUH",
    name: "Abu Dhabi Airport (AUH)",
    city: "Abu Dhabi",
    emirate: "Abu Dhabi",
    address: "Terminal A Arrivals, Zayed International Airport",
    phone: "+971 2 000 1003",
    email: "auh@driveeasy.test",
    openingHours: "Open 24 hours, 7 days a week",
    isAirport: true,
    latitude: 24.4331,
    longitude: 54.6511,
  },
  {
    code: "SHJ",
    name: "Sharjah City Centre",
    city: "Sharjah",
    emirate: "Sharjah",
    address: "Al Wahda Street, near City Centre Sharjah",
    phone: "+971 6 000 1004",
    email: "sharjah@driveeasy.test",
    openingHours: "Sat-Thu 08:00-21:00, Fri 14:00-21:00",
    isAirport: false,
    latitude: 25.3253,
    longitude: 55.3934,
  },
] as const;

const CATEGORIES = [
  { slug: "economy", name: "Economy", description: "Small, fuel-efficient city cars.", dailyRateFils: 9900, depositFils: 100000, sortOrder: 1 },
  { slug: "compact", name: "Compact", description: "Comfortable hatchbacks and saloons.", dailyRateFils: 12900, depositFils: 100000, sortOrder: 2 },
  { slug: "suv", name: "SUV", description: "Space for family and luggage.", dailyRateFils: 22900, depositFils: 150000, sortOrder: 3 },
  { slug: "luxury", name: "Luxury", description: "Premium saloons for business and leisure.", dailyRateFils: 49900, depositFils: 300000, sortOrder: 4 },
  { slug: "electric", name: "Electric", description: "Zero-emission EVs.", dailyRateFils: 27900, depositFils: 150000, sortOrder: 5 },
  { slug: "van", name: "Van & People Carrier", description: "Seven seats or more.", dailyRateFils: 25900, depositFils: 150000, sortOrder: 6 },
] as const;

const FEATURES = [
  { code: "BLUETOOTH", name: "Bluetooth", icon: "bluetooth" },
  { code: "APPLE_CARPLAY", name: "Apple CarPlay / Android Auto", icon: "smartphone" },
  { code: "REAR_CAMERA", name: "Reversing camera", icon: "camera" },
  { code: "CRUISE", name: "Cruise control", icon: "gauge" },
  { code: "SUNROOF", name: "Sunroof", icon: "sun" },
  { code: "LEATHER", name: "Leather seats", icon: "armchair" },
  { code: "AWD", name: "All-wheel drive", icon: "mountain" },
  { code: "NAV", name: "Built-in navigation", icon: "map" },
  { code: "USB_C", name: "USB-C charging", icon: "plug" },
  { code: "KEYLESS", name: "Keyless entry", icon: "key" },
] as const;

type F = (typeof FEATURES)[number]["code"];
type VehicleSeed = {
  slug: string;
  make: string;
  model: string;
  year: number;
  category: (typeof CATEGORIES)[number]["slug"];
  branch: (typeof BRANCHES)[number]["code"];
  transmission: "AUTOMATIC" | "MANUAL";
  fuelType: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
  seats: number;
  doors: number;
  luggage: number;
  color: string;
  rate?: number;
  features: F[];
};

const BASIC: F[] = ["BLUETOOTH", "USB_C", "REAR_CAMERA"];
const VEHICLES: VehicleSeed[] = [
  { slug: "nissan-sunny", make: "Nissan", model: "Sunny", year: 2025, category: "economy", branch: "DXB", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 2, color: "White", features: BASIC },
  { slug: "toyota-yaris", make: "Toyota", model: "Yaris", year: 2025, category: "economy", branch: "DXB", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 2, color: "Silver", features: BASIC },
  { slug: "kia-picanto", make: "Kia", model: "Picanto", year: 2024, category: "economy", branch: "DMR", transmission: "MANUAL", fuelType: "PETROL", seats: 4, doors: 4, luggage: 1, color: "Red", rate: 8900, features: ["BLUETOOTH", "USB_C"] },
  { slug: "hyundai-accent", make: "Hyundai", model: "Accent", year: 2025, category: "economy", branch: "SHJ", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 2, color: "Blue", features: BASIC },
  { slug: "toyota-corolla", make: "Toyota", model: "Corolla", year: 2025, category: "compact", branch: "DXB", transmission: "AUTOMATIC", fuelType: "HYBRID", seats: 5, doors: 4, luggage: 3, color: "Grey", features: [...BASIC, "APPLE_CARPLAY", "CRUISE"] },
  { slug: "mazda-3", make: "Mazda", model: "3", year: 2024, category: "compact", branch: "DMR", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 2, color: "Soul Red", features: [...BASIC, "APPLE_CARPLAY", "KEYLESS"] },
  { slug: "honda-civic", make: "Honda", model: "Civic", year: 2025, category: "compact", branch: "AUH", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 3, color: "Black", features: [...BASIC, "APPLE_CARPLAY", "CRUISE"] },
  { slug: "volkswagen-golf", make: "Volkswagen", model: "Golf", year: 2024, category: "compact", branch: "SHJ", transmission: "MANUAL", fuelType: "PETROL", seats: 5, doors: 5, luggage: 2, color: "White", rate: 11900, features: [...BASIC, "CRUISE"] },
  { slug: "toyota-rav4", make: "Toyota", model: "RAV4", year: 2025, category: "suv", branch: "DXB", transmission: "AUTOMATIC", fuelType: "HYBRID", seats: 5, doors: 5, luggage: 4, color: "Silver", features: [...BASIC, "APPLE_CARPLAY", "AWD", "CRUISE"] },
  { slug: "nissan-patrol", make: "Nissan", model: "Patrol", year: 2025, category: "suv", branch: "DXB", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 7, doors: 5, luggage: 5, color: "Pearl White", rate: 39900, features: [...BASIC, "APPLE_CARPLAY", "AWD", "LEATHER", "SUNROOF", "NAV"] },
  { slug: "hyundai-tucson", make: "Hyundai", model: "Tucson", year: 2024, category: "suv", branch: "AUH", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 5, luggage: 4, color: "Grey", features: [...BASIC, "APPLE_CARPLAY", "CRUISE"] },
  { slug: "kia-sportage", make: "Kia", model: "Sportage", year: 2025, category: "suv", branch: "SHJ", transmission: "AUTOMATIC", fuelType: "DIESEL", seats: 5, doors: 5, luggage: 4, color: "Green", features: [...BASIC, "APPLE_CARPLAY", "KEYLESS"] },
  { slug: "mercedes-e-class", make: "Mercedes-Benz", model: "E-Class", year: 2025, category: "luxury", branch: "DXB", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 5, doors: 4, luggage: 3, color: "Obsidian Black", features: [...BASIC, "APPLE_CARPLAY", "LEATHER", "NAV", "SUNROOF", "KEYLESS", "CRUISE"] },
  { slug: "bmw-5-series", make: "BMW", model: "5 Series", year: 2025, category: "luxury", branch: "DMR", transmission: "AUTOMATIC", fuelType: "HYBRID", seats: 5, doors: 4, luggage: 3, color: "Mineral White", features: [...BASIC, "APPLE_CARPLAY", "LEATHER", "NAV", "KEYLESS", "CRUISE"] },
  { slug: "lexus-es", make: "Lexus", model: "ES 300h", year: 2024, category: "luxury", branch: "AUH", transmission: "AUTOMATIC", fuelType: "HYBRID", seats: 5, doors: 4, luggage: 3, color: "Sonic Grey", rate: 44900, features: [...BASIC, "LEATHER", "NAV", "SUNROOF", "CRUISE"] },
  { slug: "tesla-model-3", make: "Tesla", model: "Model 3", year: 2025, category: "electric", branch: "DXB", transmission: "AUTOMATIC", fuelType: "ELECTRIC", seats: 5, doors: 4, luggage: 3, color: "Midnight Silver", features: ["BLUETOOTH", "USB_C", "REAR_CAMERA", "NAV", "KEYLESS", "CRUISE"] },
  { slug: "tesla-model-y", make: "Tesla", model: "Model Y", year: 2025, category: "electric", branch: "DMR", transmission: "AUTOMATIC", fuelType: "ELECTRIC", seats: 5, doors: 5, luggage: 4, color: "Pearl White", rate: 31900, features: ["BLUETOOTH", "USB_C", "REAR_CAMERA", "NAV", "KEYLESS", "AWD"] },
  { slug: "byd-atto-3", make: "BYD", model: "Atto 3", year: 2025, category: "electric", branch: "AUH", transmission: "AUTOMATIC", fuelType: "ELECTRIC", seats: 5, doors: 5, luggage: 3, color: "Blue", rate: 22900, features: [...BASIC, "APPLE_CARPLAY", "KEYLESS"] },
  { slug: "toyota-innova", make: "Toyota", model: "Innova", year: 2024, category: "van", branch: "DXB", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 8, doors: 5, luggage: 4, color: "Silver", features: [...BASIC, "CRUISE"] },
  { slug: "kia-carnival", make: "Kia", model: "Carnival", year: 2025, category: "van", branch: "SHJ", transmission: "AUTOMATIC", fuelType: "PETROL", seats: 8, doors: 5, luggage: 5, color: "Black", rate: 29900, features: [...BASIC, "APPLE_CARPLAY", "KEYLESS", "CRUISE"] },
];

const EXTRAS = [
  { code: "CHILD_SEAT", name: "Child seat", description: "ISOFIX child seat (9-36 kg).", pricing: "PER_DAY", priceFils: 2500, maxPriceFils: 25000, maxQuantity: 3, sortOrder: 1 },
  { code: "GPS", name: "GPS navigation", description: "Portable sat-nav with UAE maps.", pricing: "PER_DAY", priceFils: 2000, maxPriceFils: 15000, maxQuantity: 1, sortOrder: 2 },
  { code: "ADDITIONAL_DRIVER", name: "Additional driver", description: "Add a second named driver (must meet the same requirements).", pricing: "PER_RENTAL", priceFils: 5000, maxPriceFils: null, maxQuantity: 2, sortOrder: 3 },
  { code: "FULL_INSURANCE", name: "Full insurance cover", description: "Reduces your excess for damage to zero.", pricing: "PER_DAY", priceFils: 4500, maxPriceFils: null, maxQuantity: 1, sortOrder: 4 },
] as const;

// Deterministic, valid-format test VINs (17 chars, no I/O/Q). Not real vehicles.
function testVin(i: number): string {
  const body = `DE${String(i + 1).padStart(3, "0")}`;
  return `TSTDRV${body}`.padEnd(17, "X").replace(/[IOQ]/g, "X");
}

function plate(branch: string, i: number): string {
  const emirate = branch === "AUH" ? "AD" : branch === "SHJ" ? "SHJ" : "DXB";
  return `${emirate} ${String.fromCharCode(65 + (i % 20))} ${String(10000 + i * 137).slice(0, 5)}`;
}

function loadOrCreateAccounts(opts: SeedOptions): SeedAccount[] {
  let existing: SeedAccount[] = [];
  if (existsSync(SEED_ACCOUNTS_FILE)) {
    try {
      existing = (JSON.parse(readFileSync(SEED_ACCOUNTS_FILE, "utf8")) as { accounts: SeedAccount[] }).accounts ?? [];
    } catch {
      existing = [];
    }
  }
  const pw = (role: "ADMIN" | "CUSTOMER") =>
    (role === "ADMIN" ? opts.passwords?.admin : opts.passwords?.customer) ??
    existing.find((a) => a.role === role)?.password ??
    randomBytes(12).toString("base64url");
  return [
    { role: "ADMIN", name: "DriveEasy Admin", email: "admin@driveeasy.test", password: pw("ADMIN") },
    { role: "CUSTOMER", name: "Test Customer", email: "customer@driveeasy.test", password: pw("CUSTOMER") },
  ];
}

function reference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return "DE-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function seed(db: Database, opts: SeedOptions = {}): Promise<SeedResult> {
  const [{ n }] = await db.select({ n: count() }).from(s.branches);
  if (n > 0) return { skipped: true, branches: n, vehicles: 0, reservations: 0, accounts: [] };

  const now = opts.now ?? new Date();
  const accounts = loadOrCreateAccounts(opts);

  const result = await db.transaction(async (tx) => {
    const branchRows = await tx
      .insert(s.branches)
      .values(BRANCHES.map((b) => ({ ...b, timeZone: "Asia/Dubai", imageUrl: `/branches/${b.code.toLowerCase()}.svg` })))
      .returning();
    const branchId = Object.fromEntries(branchRows.map((b) => [b.code, b.id])) as Record<string, string>;

    const categoryRows = await tx.insert(s.vehicleCategories).values([...CATEGORIES]).returning();
    const categoryId = Object.fromEntries(categoryRows.map((c) => [c.slug, c.id])) as Record<string, string>;
    const categoryBySlug = Object.fromEntries(categoryRows.map((c) => [c.slug, c]));

    const featureRows = await tx.insert(s.vehicleFeatures).values([...FEATURES]).returning();
    const featureId = Object.fromEntries(featureRows.map((f) => [f.code, f.id])) as Record<string, string>;

    const vehicleRows = await tx
      .insert(s.vehicles)
      .values(
        VEHICLES.map((v, i) => ({
          branchId: branchId[v.branch],
          categoryId: categoryId[v.category],
          slug: v.slug,
          make: v.make,
          model: v.model,
          year: v.year,
          plateNumber: plate(v.branch, i),
          vin: testVin(i),
          color: v.color,
          transmission: v.transmission,
          fuelType: v.fuelType,
          seats: v.seats,
          doors: v.doors,
          luggage: v.luggage,
          dailyRateFils: v.rate ?? null,
          mileageKm: 4000 + i * 2311,
          images: [`/vehicles/${v.slug}.svg`],
        })),
      )
      .returning();
    await tx
      .insert(s.vehicleFeatureMap)
      .values(VEHICLES.flatMap((v, i) => v.features.map((f) => ({ vehicleId: vehicleRows[i].id, featureId: featureId[f] }))));

    const extraRows = await tx.insert(s.extras).values(EXTRAS.map((e) => ({ ...e }))).returning();

    // Pricing rules
    const year = now.getUTCFullYear();
    const peakFrom = new Date(Date.UTC(year, 11, 15, 0, 0) - 4 * HOUR); // 15 Dec 00:00 Dubai
    const peakTo = new Date(Date.UTC(year + 1, 0, 5, 0, 0) - 4 * HOUR); // 5 Jan 00:00 Dubai
    await tx.insert(s.pricingRules).values([
      { name: "Festive season +20%", type: "SEASONAL", validDuring: `[${peakFrom.toISOString()},${peakTo.toISOString()})`, adjustmentBp: 2000 },
      { name: "Weekly discount 10%", type: "DURATION_DISCOUNT", minDays: 7, adjustmentBp: -1000 },
      { name: "Monthly discount 25%", type: "DURATION_DISCOUNT", minDays: 28, adjustmentBp: -2500 },
      { name: "One-way within Dubai", type: "ONE_WAY_FEE", pickupBranchId: branchId.DXB, returnBranchId: branchId.DMR, feeFils: 5000 },
      { name: "One-way within Dubai", type: "ONE_WAY_FEE", pickupBranchId: branchId.DMR, returnBranchId: branchId.DXB, feeFils: 5000 },
      { name: "One-way (inter-emirate)", type: "ONE_WAY_FEE", feeFils: 25000 },
    ]);

    // Accounts (Better Auth credential accounts with scrypt hashes).
    const userRows = [];
    for (const a of accounts) {
      const [u] = await tx
        .insert(s.users)
        .values({ name: a.name, email: a.email, emailVerified: true, role: a.role, phone: a.role === "CUSTOMER" ? "+971 50 000 0000" : null })
        .returning();
      await tx.insert(s.accounts).values({ userId: u.id, accountId: u.id, providerId: "credential", password: await hashPassword(a.password) });
      userRows.push(u);
    }
    const [admin, customer] = userRows;
    await tx.insert(s.driverProfiles).values({
      userId: customer.id,
      fullName: "Test Customer",
      email: customer.email,
      phone: "+971 50 000 0000",
      dateOfBirth: "1990-05-15",
      nationality: "AE",
      licenceNumber: "TEST-123456",
      licenceCountry: "AE",
      licenceIssuedOn: "2015-01-10",
      licenceExpiresOn: "2030-01-10",
    });

    // Reservations: a few confirmed future rentals and one past, returned rental.
    const rulesRaw = await tx
      .select({
        type: s.pricingRules.type,
        categoryId: s.pricingRules.categoryId,
        pickupBranchId: s.pricingRules.pickupBranchId,
        returnBranchId: s.pricingRules.returnBranchId,
        validFrom: sql<string | null>`lower(${s.pricingRules.validDuring})`,
        validTo: sql<string | null>`upper(${s.pricingRules.validDuring})`,
        minDays: s.pricingRules.minDays,
        adjustmentBp: s.pricingRules.adjustmentBp,
        feeFils: s.pricingRules.feeFils,
      })
      .from(s.pricingRules);
    const rules: RuleInput[] = rulesRaw.map((r) => ({
      ...r,
      validFrom: r.validFrom ? new Date(r.validFrom) : null,
      validTo: r.validTo ? new Date(r.validTo) : null,
    }));
    // 10:00 Dubai time, N days from today.
    const at = (daysFromNow: number, hourDubai = 10) => {
      const d = new Date(now.getTime() + daysFromNow * DAY);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourDubai - 4, 0));
    };
    const plan = [
      { v: 0, start: at(5), end: at(8), ret: "DXB", extras: ["GPS"], status: "CONFIRMED" as const },
      { v: 8, start: at(10), end: at(17), ret: "DMR", extras: ["CHILD_SEAT", "FULL_INSURANCE"], status: "CONFIRMED" as const },
      { v: 12, start: at(20), end: at(22), ret: "DXB", extras: [], status: "CONFIRMED" as const },
      // back-to-back with the first rental on the same car
      { v: 0, start: at(8), end: at(11), ret: "DXB", extras: [], status: "CONFIRMED" as const },
      { v: 4, start: at(-10), end: at(-6), ret: "DXB", extras: [], status: "RETURNED" as const },
    ];
    let reservationCount = 0;
    for (const p of plan) {
      const v = vehicleRows[p.v];
      const cat = categoryBySlug[VEHICLES[p.v].category];
      const selected = extraRows.filter((e) => (p.extras as string[]).includes(e.code));
      const quote = computeQuote({
        startAt: p.start,
        endAt: p.end,
        dailyRateFils: v.dailyRateFils ?? cat.dailyRateFils,
        depositFils: cat.depositFils,
        categoryId: v.categoryId,
        pickupBranchId: v.branchId,
        returnBranchId: branchId[p.ret],
        rules,
        extras: selected,
        selection: selected.map((e) => ({ extraId: e.id, quantity: 1 })),
      });
      const [r] = await tx
        .insert(s.reservations)
        .values({
          reference: reference(),
          userId: customer.id,
          vehicleId: v.id,
          pickupBranchId: v.branchId,
          returnBranchId: branchId[p.ret],
          startAt: p.start,
          endAt: p.end,
          status: p.status,
          idempotencyKey: `seed-${randomUUID()}`,
          days: quote.days,
          dailyRateFils: quote.dailyRateFils,
          baseFils: quote.baseFils,
          extrasFils: quote.extrasFils,
          oneWayFeeFils: quote.oneWayFeeFils,
          discountFils: quote.durationDiscountFils,
          subtotalFils: quote.subtotalFils,
          vatRateBps: quote.vatRateBps,
          vatFils: quote.vatFils,
          totalFils: quote.totalFils,
          depositFils: quote.depositFils,
          priceBreakdown: quote,
          driverName: "Test Customer",
          driverEmail: customer.email,
          driverPhone: "+971 50 000 0000",
          driverDateOfBirth: "1990-05-15",
          driverLicenceNumber: "TEST-123456",
          driverLicenceCountry: "AE",
          driverLicenceExpiresOn: "2030-01-10",
          confirmedAt: new Date(p.start.getTime() - 20 * DAY),
          pickedUpAt: p.status === "RETURNED" ? p.start : null,
          returnedAt: p.status === "RETURNED" ? p.end : null,
        })
        .returning();
      reservationCount++;
      if (quote.extras.length) {
        await tx.insert(s.reservationExtras).values(
          quote.extras.map((l) => ({
            reservationId: r.id,
            extraId: l.extraId,
            quantity: l.quantity,
            unitPriceFils: l.unitPriceFils,
            pricing: selected.find((e) => e.id === l.extraId)!.pricing,
            totalFils: l.totalFils,
          })),
        );
      }
      // Money rows use provider "seed": they are local records only and are never sent to a provider.
      await tx.insert(s.payments).values({
        reservationId: r.id,
        userId: customer.id,
        kind: "RENTAL",
        status: "SUCCEEDED",
        provider: "seed",
        providerPaymentId: `seed_pay_${r.id}`,
        idempotencyKey: `seed-pay-${r.id}`,
        amountFils: quote.totalFils,
      });
      await tx.insert(s.deposits).values({
        reservationId: r.id,
        status: p.status === "RETURNED" ? "RELEASED" : "AUTHORIZED",
        provider: "seed",
        providerHoldId: `seed_hold_${r.id}`,
        idempotencyKey: `seed-hold-${r.id}`,
        amountFils: quote.depositFils,
        expiresAt: new Date(p.end.getTime() + 7 * DAY),
        authorizedAt: new Date(p.start.getTime() - 20 * DAY),
        releasedAt: p.status === "RETURNED" ? p.end : null,
      });
      if (p.status === "RETURNED") {
        await tx.insert(s.rentalAgreements).values({
          reservationId: r.id,
          agreementNumber: `RA-${r.reference.slice(3)}`,
          checkedOutBy: admin.id,
          checkedInBy: admin.id,
          pickupAt: p.start,
          pickupMileageKm: v.mileageKm - 420,
          pickupFuelEighths: 8,
          returnAt: p.end,
          returnBranchId: branchId[p.ret],
          returnMileageKm: v.mileageKm,
          returnFuelEighths: 8,
        });
      }
    }

    // A planned maintenance block (service) on the Patrol.
    await tx.insert(s.maintenanceBlocks).values({
      vehicleId: vehicleRows[9].id,
      startAt: at(3, 8),
      endAt: at(4, 18),
      reason: "Scheduled 20,000 km service",
      createdBy: admin.id,
    });

    await tx.insert(s.auditLogs).values({ actorUserId: null, action: "seed.run", entityType: "system", data: { at: now.toISOString() } });
    return { branches: branchRows.length, vehicles: vehicleRows.length, reservations: reservationCount };
  });

  let accountsFile: string | undefined;
  if (opts.writeAccountsFile !== false) {
    mkdirSync(dirname(SEED_ACCOUNTS_FILE), { recursive: true });
    writeFileSync(
      SEED_ACCOUNTS_FILE,
      JSON.stringify({ note: "Local test accounts generated by pnpm db:seed. Do not commit.", accounts }, null, 2) + "\n",
    );
    accountsFile = SEED_ACCOUNTS_FILE;
  }
  return { skipped: false, ...result, accounts, accountsFile };
}

/** Vehicle photo slugs used by the seed (public/vehicles/<slug>.svg). */
export const SEED_VEHICLE_SLUGS = VEHICLES.map((v) => v.slug);
export const SEED_BRANCH_CODES = BRANCHES.map((b) => b.code);
