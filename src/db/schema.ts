// DriveEasy database schema (Drizzle). PostgreSQL 16+ with btree_gist.
//
// Conventions
// - UUID primary keys (gen_random_uuid()).
// - Every timestamp is `timestamptz` and stored in UTC. Branches carry an IANA
//   `time_zone` (Asia/Dubai) that the UI uses for display only.
// - Money is integer minor units: fils for AED (100 fils = 1 AED). Never floats.
// - Percentages are integer basis points (bp): 500 bp = 5 %.
// - Fuel level is integer eighths of a tank (0 = empty, 8 = full).
//
// Overlap protection (see drizzle/0001_* custom migration):
// Reservations and maintenance blocks each keep a generated half-open
// `period tstzrange [start, end)`. Triggers mirror every *active* reservation
// (PENDING, CONFIRMED, PICKED_UP) and every non-cancelled maintenance block
// into `vehicle_occupancy`, which has
//   EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)
// Because the mirror row is written by a trigger inside the same transaction
// as the reservation/maintenance write, two concurrent transactions that try to
// occupy overlapping periods for the same vehicle cannot both commit: the
// second blocks on the first's index entry and then fails with SQLSTATE 23P01
// (exclusion_violation). Half-open ranges mean [10:00,12:00) and
// [12:00,14:00) do not overlap, so back-to-back rentals are allowed.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** tstzrange, read back as its text form e.g. ["2026-11-01 08:00:00+00","2026-11-03 08:00:00+00") */
export const tstzrange = customType<{ data: string; driverData: string }>({
  dataType: () => "tstzrange",
});

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const id = () => uuid("id").primaryKey().defaultRandom();
const fils = (name: string) => integer(name);

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["CUSTOMER", "ADMIN"]);
export const vehicleStatus = pgEnum("vehicle_status", ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"]);
export const reservationStatus = pgEnum("reservation_status", [
  "PENDING",
  "CONFIRMED",
  "PICKED_UP",
  "RETURNED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
]);
export const paymentStatus = pgEnum("payment_status", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);
export const paymentKind = pgEnum("payment_kind", ["RENTAL", "ADJUSTMENT", "BALANCE"]);
export const depositStatus = pgEnum("deposit_status", ["PENDING", "AUTHORIZED", "RELEASED", "CAPTURED", "FAILED"]);
export const transmission = pgEnum("transmission", ["AUTOMATIC", "MANUAL"]);
export const fuelType = pgEnum("fuel_type", ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"]);
export const extraPricing = pgEnum("extra_pricing", ["PER_DAY", "PER_RENTAL"]);
export const pricingRuleType = pgEnum("pricing_rule_type", ["SEASONAL", "DURATION_DISCOUNT", "ONE_WAY_FEE"]);
export const damageSeverity = pgEnum("damage_severity", ["MINOR", "MODERATE", "MAJOR"]);
export const damageStage = pgEnum("damage_stage", ["PICKUP", "RETURN", "OTHER"]);
export const damageStatus = pgEnum("damage_status", ["OPEN", "CHARGED", "RESOLVED"]);

export const ACTIVE_RESERVATION_STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP"] as const;

// ---------------------------------------------------------------------------
// Auth (Better Auth). Model names are mapped in src/lib/auth.ts.
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: userRole("role").notNull().default("CUSTOMER"),
    phone: text("phone"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    check("users_email_chk", sql`position('@' in ${t.email}) > 1`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: tz("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tz("access_token_expires_at"),
    refreshTokenExpiresAt: tz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("accounts_user_idx").on(t.userId),
    uniqueIndex("accounts_provider_account_uq").on(t.providerId, t.accountId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tz("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const driverProfiles = pgTable(
  "driver_profiles",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone").notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
    nationality: text("nationality"),
    licenceNumber: text("licence_number").notNull(),
    licenceCountry: text("licence_country").notNull(),
    licenceIssuedOn: date("licence_issued_on", { mode: "string" }),
    licenceExpiresOn: date("licence_expires_on", { mode: "string" }).notNull(),
    // Private storage key (never a public URL). Served via /api/files/<key>.
    licenceFileKey: text("licence_file_key"),
    licenceFileContentType: text("licence_file_content_type"),
    licenceUploadedAt: tz("licence_uploaded_at"),
    verifiedAt: tz("verified_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("driver_profiles_licence_dates_chk", sql`${t.licenceIssuedOn} is null or ${t.licenceExpiresOn} > ${t.licenceIssuedOn}`),
    check("driver_profiles_dob_chk", sql`${t.dateOfBirth} > date '1900-01-01'`),
    check("driver_profiles_licence_number_chk", sql`length(trim(${t.licenceNumber})) between 3 and 40`),
  ],
);

// ---------------------------------------------------------------------------
// Branches and fleet
// ---------------------------------------------------------------------------

export const branches = pgTable(
  "branches",
  {
    id: id(),
    code: text("code").notNull().unique(), // e.g. DXB
    name: text("name").notNull(),
    city: text("city").notNull(),
    emirate: text("emirate").notNull(),
    address: text("address").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    timeZone: text("time_zone").notNull().default("Asia/Dubai"), // IANA zone, display only
    openingHours: text("opening_hours").notNull(), // human readable, e.g. "Open 24 hours"
    isAirport: boolean("is_airport").notNull().default(false),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    imageUrl: text("image_url"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("branches_code_chk", sql`${t.code} ~ '^[A-Z0-9]{2,10}$'`),
    check("branches_lat_chk", sql`${t.latitude} is null or ${t.latitude} between -90 and 90`),
    check("branches_lng_chk", sql`${t.longitude} is null or ${t.longitude} between -180 and 180`),
  ],
);

export const vehicleCategories = pgTable(
  "vehicle_categories",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    dailyRateFils: fils("daily_rate_fils").notNull(), // default rate for vehicles in this category
    depositFils: fils("deposit_fils").notNull(), // refundable security deposit (authorisation only)
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("vehicle_categories_rate_chk", sql`${t.dailyRateFils} > 0`),
    check("vehicle_categories_deposit_chk", sql`${t.depositFils} >= 0`),
  ],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: id(),
    // Current/home branch. Updated on check-in of a one-way rental.
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => vehicleCategories.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(), // photo slug, e.g. toyota-yaris
    make: text("make").notNull(),
    model: text("model").notNull(),
    year: integer("year").notNull(),
    plateNumber: text("plate_number").notNull().unique(),
    vin: text("vin").notNull().unique(),
    color: text("color"),
    transmission: transmission("transmission").notNull(),
    fuelType: fuelType("fuel_type").notNull(),
    seats: integer("seats").notNull(),
    doors: integer("doors").notNull(),
    luggage: integer("luggage").notNull(),
    // Overrides the category rate when set.
    dailyRateFils: fils("daily_rate_fils"),
    mileageKm: integer("mileage_km").notNull().default(0),
    status: vehicleStatus("status").notNull().default("AVAILABLE"),
    // Public image paths/URLs (vehicle photos may be public).
    images: jsonb("images").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("vehicles_branch_idx").on(t.branchId),
    index("vehicles_category_idx").on(t.categoryId),
    index("vehicles_status_idx").on(t.status),
    check("vehicles_year_chk", sql`${t.year} between 1990 and 2100`),
    check("vehicles_vin_chk", sql`${t.vin} ~ '^[A-HJ-NPR-Z0-9]{17}$'`),
    check("vehicles_seats_chk", sql`${t.seats} between 1 and 15`),
    check("vehicles_doors_chk", sql`${t.doors} between 2 and 6`),
    check("vehicles_luggage_chk", sql`${t.luggage} between 0 and 10`),
    check("vehicles_rate_chk", sql`${t.dailyRateFils} is null or ${t.dailyRateFils} > 0`),
    check("vehicles_mileage_chk", sql`${t.mileageKm} >= 0`),
  ],
);

export const vehicleFeatures = pgTable("vehicle_features", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  icon: text("icon"),
  createdAt: createdAt(),
});

export const vehicleFeatureMap = pgTable(
  "vehicle_feature_map",
  {
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    featureId: uuid("feature_id")
      .notNull()
      .references(() => vehicleFeatures.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.featureId] }), index("vehicle_feature_map_feature_idx").on(t.featureId)],
);

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

// SEASONAL:          `adjustmentBp` (+/-) applies to each rental day whose start lies in `validDuring`.
// DURATION_DISCOUNT: `adjustmentBp` (negative) applies to the rental subtotal when days >= `minDays`.
//                    Only the best (largest discount) matching rule applies.
// ONE_WAY_FEE:       `feeFils` when pick-up branch != return branch. A rule with both branches set
//                    beats one with only one set, which beats a generic rule (both null).
// `categoryId` null = applies to every category.
export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: id(),
    name: text("name").notNull(),
    type: pricingRuleType("type").notNull(),
    categoryId: uuid("category_id").references(() => vehicleCategories.id, { onDelete: "cascade" }),
    pickupBranchId: uuid("pickup_branch_id").references(() => branches.id, { onDelete: "cascade" }),
    returnBranchId: uuid("return_branch_id").references(() => branches.id, { onDelete: "cascade" }),
    validDuring: tstzrange("valid_during"),
    minDays: integer("min_days"),
    adjustmentBp: integer("adjustment_bp"),
    feeFils: fils("fee_fils"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("pricing_rules_type_idx").on(t.type, t.active),
    check("pricing_rules_adjustment_chk", sql`${t.adjustmentBp} is null or ${t.adjustmentBp} between -9000 and 30000`),
    check("pricing_rules_fee_chk", sql`${t.feeFils} is null or ${t.feeFils} >= 0`),
    check("pricing_rules_min_days_chk", sql`${t.minDays} is null or ${t.minDays} >= 1`),
    check(
      "pricing_rules_shape_chk",
      sql`(${t.type} = 'SEASONAL' and ${t.validDuring} is not null and ${t.adjustmentBp} is not null and not isempty(${t.validDuring}))
       or (${t.type} = 'DURATION_DISCOUNT' and ${t.minDays} is not null and ${t.adjustmentBp} is not null and ${t.adjustmentBp} < 0)
       or (${t.type} = 'ONE_WAY_FEE' and ${t.feeFils} is not null)`,
    ),
  ],
);

export const extras = pgTable(
  "extras",
  {
    id: id(),
    code: text("code").notNull().unique(), // CHILD_SEAT, GPS, ADDITIONAL_DRIVER, FULL_INSURANCE
    name: text("name").notNull(),
    description: text("description"),
    pricing: extraPricing("pricing").notNull(),
    priceFils: fils("price_fils").notNull(),
    // Optional cap per unit for PER_DAY extras (e.g. GPS max AED 150 per rental).
    maxPriceFils: fils("max_price_fils"),
    maxQuantity: integer("max_quantity").notNull().default(1),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("extras_price_chk", sql`${t.priceFils} >= 0`),
    check("extras_max_price_chk", sql`${t.maxPriceFils} is null or ${t.maxPriceFils} >= ${t.priceFils}`),
    check("extras_max_qty_chk", sql`${t.maxQuantity} between 1 and 10`),
  ],
);

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export type PriceBreakdown = {
  days: number;
  dailyRateFils: number;
  baseFils: number;
  seasonalAdjustmentFils: number;
  durationDiscountFils: number;
  extras: {
    extraId: string;
    code: string;
    name: string;
    pricing: "PER_DAY" | "PER_RENTAL";
    quantity: number;
    unitPriceFils: number;
    totalFils: number;
  }[];
  extrasFils: number;
  oneWayFeeFils: number;
  subtotalFils: number;
  vatRateBps: number;
  vatFils: number;
  totalFils: number;
  depositFils: number;
};

export const reservations = pgTable(
  "reservations",
  {
    id: id(),
    reference: text("reference").notNull().unique(), // e.g. DE-7KQ2MX, shown on the voucher
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    pickupBranchId: uuid("pickup_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    returnBranchId: uuid("return_branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    startAt: tz("start_at").notNull(),
    endAt: tz("end_at").notNull(),
    // Generated half-open range [start_at, end_at). See header comment.
    period: tstzrange("period")
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(start_at, end_at, '[)')`),
    status: reservationStatus("status").notNull().default("PENDING"),
    // PENDING reservations are temporary holds until this instant.
    holdExpiresAt: tz("hold_expires_at"),
    // Client-supplied key: retrying the same booking request returns the same reservation.
    idempotencyKey: text("idempotency_key").notNull(),
    currency: text("currency").notNull().default("AED"),
    days: integer("days").notNull(),
    dailyRateFils: fils("daily_rate_fils").notNull(),
    baseFils: fils("base_fils").notNull(),
    extrasFils: fils("extras_fils").notNull().default(0),
    oneWayFeeFils: fils("one_way_fee_fils").notNull().default(0),
    discountFils: fils("discount_fils").notNull().default(0),
    subtotalFils: fils("subtotal_fils").notNull(),
    vatRateBps: integer("vat_rate_bps").notNull(),
    vatFils: fils("vat_fils").notNull(),
    totalFils: fils("total_fils").notNull(),
    depositFils: fils("deposit_fils").notNull(),
    priceBreakdown: jsonb("price_breakdown").$type<PriceBreakdown>().notNull(),
    // Driver snapshot for this rental (copied from driver_profiles).
    driverName: text("driver_name"),
    driverEmail: text("driver_email"),
    driverPhone: text("driver_phone"),
    driverDateOfBirth: date("driver_date_of_birth", { mode: "string" }),
    driverLicenceNumber: text("driver_licence_number"),
    driverLicenceCountry: text("driver_licence_country"),
    driverLicenceExpiresOn: date("driver_licence_expires_on", { mode: "string" }),
    confirmedAt: tz("confirmed_at"),
    cancelledAt: tz("cancelled_at"),
    cancellationReason: text("cancellation_reason"),
    cancellationFeeFils: fils("cancellation_fee_fils"),
    refundedFils: fils("refunded_fils").notNull().default(0),
    expiredAt: tz("expired_at"),
    pickedUpAt: tz("picked_up_at"),
    returnedAt: tz("returned_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("reservations_user_idem_uq").on(t.userId, t.idempotencyKey),
    index("reservations_user_idx").on(t.userId, t.startAt),
    index("reservations_vehicle_idx").on(t.vehicleId, t.startAt),
    index("reservations_status_idx").on(t.status),
    index("reservations_hold_idx").on(t.holdExpiresAt).where(sql`${t.status} = 'PENDING'`),
    index("reservations_period_gist").using("gist", t.vehicleId, t.period),
    check("reservations_range_chk", sql`${t.endAt} > ${t.startAt}`),
    check("reservations_max_len_chk", sql`${t.endAt} - ${t.startAt} <= interval '90 days'`),
    check("reservations_hold_chk", sql`${t.status} <> 'PENDING' or ${t.holdExpiresAt} is not null`),
    check("reservations_days_chk", sql`${t.days} between 1 and 90`),
    check(
      "reservations_money_chk",
      sql`${t.dailyRateFils} > 0 and ${t.baseFils} >= 0 and ${t.extrasFils} >= 0 and ${t.oneWayFeeFils} >= 0
       and ${t.discountFils} >= 0 and ${t.subtotalFils} >= 0 and ${t.vatFils} >= 0 and ${t.totalFils} >= 0 and ${t.depositFils} >= 0`,
    ),
    check("reservations_total_chk", sql`${t.totalFils} = ${t.subtotalFils} + ${t.vatFils}`),
    check("reservations_vat_rate_chk", sql`${t.vatRateBps} between 0 and 10000`),
    check("reservations_refund_chk", sql`${t.refundedFils} >= 0`),
    check("reservations_cancel_fee_chk", sql`${t.cancellationFeeFils} is null or ${t.cancellationFeeFils} >= 0`),
    check("reservations_currency_chk", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const reservationExtras = pgTable(
  "reservation_extras",
  {
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    extraId: uuid("extra_id")
      .notNull()
      .references(() => extras.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    unitPriceFils: fils("unit_price_fils").notNull(),
    pricing: extraPricing("pricing").notNull(),
    totalFils: fils("total_fils").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.reservationId, t.extraId] }),
    check("reservation_extras_qty_chk", sql`${t.quantity} between 1 and 10`),
    check("reservation_extras_money_chk", sql`${t.unitPriceFils} >= 0 and ${t.totalFils} >= 0`),
  ],
);

// Mirror of active reservations + maintenance blocks; carries the exclusion
// constraint (added in the custom migration). Written only by triggers.
export const vehicleOccupancy = pgTable(
  "vehicle_occupancy",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    period: tstzrange("period").notNull(),
    reservationId: uuid("reservation_id")
      .unique()
      .references(() => reservations.id, { onDelete: "cascade" }),
    maintenanceBlockId: uuid("maintenance_block_id")
      .unique()
      .references(() => maintenanceBlocks.id, { onDelete: "cascade" }),
  },
  (t) => [
    check("vehicle_occupancy_source_chk", sql`num_nonnulls(${t.reservationId}, ${t.maintenanceBlockId}) = 1`),
    check("vehicle_occupancy_period_chk", sql`not isempty(${t.period}) and lower_inc(${t.period}) and not upper_inc(${t.period})`),
  ],
);

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export const payments = pgTable(
  "payments",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: paymentKind("kind").notNull(),
    status: paymentStatus("status").notNull().default("PENDING"),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id").unique(),
    // Unique: a retried request with the same key reuses this row and the provider call.
    idempotencyKey: text("idempotency_key").notNull().unique(),
    currency: text("currency").notNull().default("AED"),
    amountFils: fils("amount_fils").notNull(),
    refundedFils: fils("refunded_fils").notNull().default(0),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payments_reservation_idx").on(t.reservationId),
    // At most one live (non-failed) rental charge per reservation: retries can never double-charge.
    uniqueIndex("payments_one_rental_uq")
      .on(t.reservationId)
      .where(sql`${t.kind} = 'RENTAL' and ${t.status} not in ('FAILED', 'CANCELLED')`),
    check("payments_amount_chk", sql`${t.amountFils} > 0`),
    check("payments_refund_chk", sql`${t.refundedFils} >= 0 and ${t.refundedFils} <= ${t.amountFils}`),
    check("payments_currency_chk", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const deposits = pgTable(
  "deposits",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    status: depositStatus("status").notNull().default("PENDING"),
    provider: text("provider").notNull(),
    providerHoldId: text("provider_hold_id").unique(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    currency: text("currency").notNull().default("AED"),
    amountFils: fils("amount_fils").notNull(),
    capturedFils: fils("captured_fils").notNull().default(0),
    captureReason: text("capture_reason"),
    failureReason: text("failure_reason"),
    expiresAt: tz("expires_at").notNull(),
    authorizedAt: tz("authorized_at"),
    releasedAt: tz("released_at"),
    capturedAt: tz("captured_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("deposits_reservation_idx").on(t.reservationId),
    index("deposits_status_idx").on(t.status),
    uniqueIndex("deposits_one_live_uq")
      .on(t.reservationId)
      .where(sql`${t.status} in ('PENDING', 'AUTHORIZED')`),
    check("deposits_amount_chk", sql`${t.amountFils} > 0`),
    check("deposits_capture_chk", sql`${t.capturedFils} >= 0 and ${t.capturedFils} <= ${t.amountFils}`),
    check("deposits_currency_chk", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

// Processed provider webhook events (de-duplication by provider event id).
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: tz("received_at").notNull().defaultNow(),
    processedAt: tz("processed_at"),
  },
  (t) => [uniqueIndex("payment_webhook_events_uq").on(t.provider, t.eventId)],
);

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export const rentalAgreements = pgTable(
  "rental_agreements",
  {
    id: id(),
    reservationId: uuid("reservation_id")
      .notNull()
      .unique()
      .references(() => reservations.id, { onDelete: "restrict" }),
    agreementNumber: text("agreement_number").notNull().unique(),
    checkedOutBy: uuid("checked_out_by").references(() => users.id, { onDelete: "set null" }),
    checkedInBy: uuid("checked_in_by").references(() => users.id, { onDelete: "set null" }),
    pickupAt: tz("pickup_at").notNull(),
    pickupMileageKm: integer("pickup_mileage_km").notNull(),
    pickupFuelEighths: integer("pickup_fuel_eighths").notNull(),
    pickupNotes: text("pickup_notes"),
    returnAt: tz("return_at"),
    returnBranchId: uuid("return_branch_id").references(() => branches.id, { onDelete: "restrict" }),
    returnMileageKm: integer("return_mileage_km"),
    returnFuelEighths: integer("return_fuel_eighths"),
    returnNotes: text("return_notes"),
    lateMinutes: integer("late_minutes").notNull().default(0),
    lateFeeFils: fils("late_fee_fils").notNull().default(0),
    fuelChargeFils: fils("fuel_charge_fils").notNull().default(0),
    damageChargeFils: fils("damage_charge_fils").notNull().default(0),
    extraChargesVatFils: fils("extra_charges_vat_fils").notNull().default(0),
    // Charged against the deposit; anything above the deposit is outstanding.
    depositCapturedFils: fils("deposit_captured_fils").notNull().default(0),
    outstandingFils: fils("outstanding_fils").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("rental_agreements_pickup_mileage_chk", sql`${t.pickupMileageKm} >= 0`),
    check("rental_agreements_pickup_fuel_chk", sql`${t.pickupFuelEighths} between 0 and 8`),
    check("rental_agreements_return_fuel_chk", sql`${t.returnFuelEighths} is null or ${t.returnFuelEighths} between 0 and 8`),
    check(
      "rental_agreements_return_mileage_chk",
      sql`${t.returnMileageKm} is null or ${t.returnMileageKm} >= ${t.pickupMileageKm}`,
    ),
    check("rental_agreements_return_at_chk", sql`${t.returnAt} is null or ${t.returnAt} > ${t.pickupAt}`),
    check(
      "rental_agreements_return_complete_chk",
      sql`(${t.returnAt} is null) = (${t.returnMileageKm} is null) and (${t.returnAt} is null) = (${t.returnFuelEighths} is null)`,
    ),
    check(
      "rental_agreements_money_chk",
      sql`${t.lateMinutes} >= 0 and ${t.lateFeeFils} >= 0 and ${t.fuelChargeFils} >= 0 and ${t.damageChargeFils} >= 0
       and ${t.extraChargesVatFils} >= 0 and ${t.depositCapturedFils} >= 0 and ${t.outstandingFils} >= 0`,
    ),
  ],
);

export const damageReports = pgTable(
  "damage_reports",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, { onDelete: "set null" }),
    reportedBy: uuid("reported_by").references(() => users.id, { onDelete: "set null" }),
    stage: damageStage("stage").notNull().default("OTHER"),
    severity: damageSeverity("severity").notNull(),
    status: damageStatus("status").notNull().default("OPEN"),
    description: text("description").notNull(),
    // Private storage keys; served through /api/files/<key> to admins (and the renter).
    imageKeys: jsonb("image_keys").$type<string[]>().notNull().default([]),
    estimatedCostFils: fils("estimated_cost_fils"),
    chargedFils: fils("charged_fils").notNull().default(0),
    resolvedAt: tz("resolved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("damage_reports_vehicle_idx").on(t.vehicleId, t.createdAt),
    index("damage_reports_reservation_idx").on(t.reservationId),
    check("damage_reports_cost_chk", sql`${t.estimatedCostFils} is null or ${t.estimatedCostFils} >= 0`),
    check("damage_reports_charged_chk", sql`${t.chargedFils} >= 0`),
    check("damage_reports_description_chk", sql`length(trim(${t.description})) >= 3`),
  ],
);

export const maintenanceBlocks = pgTable(
  "maintenance_blocks",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    startAt: tz("start_at").notNull(),
    endAt: tz("end_at").notNull(),
    period: tstzrange("period")
      .notNull()
      .generatedAlwaysAs(sql`tstzrange(start_at, end_at, '[)')`),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: tz("cancelled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("maintenance_blocks_vehicle_idx").on(t.vehicleId, t.startAt),
    check("maintenance_blocks_range_chk", sql`${t.endAt} > ${t.startAt}`),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(), // e.g. reservation.cancel, vehicle.update
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_actor_idx").on(t.actorUserId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type UserRole = (typeof userRole.enumValues)[number];
export type Branch = typeof branches.$inferSelect;
export type VehicleCategory = typeof vehicleCategories.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type VehicleStatus = (typeof vehicleStatus.enumValues)[number];
export type Extra = typeof extras.$inferSelect;
export type PricingRule = typeof pricingRules.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
export type ReservationStatus = (typeof reservationStatus.enumValues)[number];
export type Payment = typeof payments.$inferSelect;
export type PaymentStatus = (typeof paymentStatus.enumValues)[number];
export type Deposit = typeof deposits.$inferSelect;
export type DepositStatus = (typeof depositStatus.enumValues)[number];
export type RentalAgreement = typeof rentalAgreements.$inferSelect;
export type DamageReport = typeof damageReports.$inferSelect;
export type MaintenanceBlock = typeof maintenanceBlocks.$inferSelect;
export type DriverProfile = typeof driverProfiles.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
