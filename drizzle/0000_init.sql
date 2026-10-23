-- btree_gist lets GiST indexes/exclusion constraints combine uuid equality with range overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."damage_severity" AS ENUM('MINOR', 'MODERATE', 'MAJOR');--> statement-breakpoint
CREATE TYPE "public"."damage_stage" AS ENUM('PICKUP', 'RETURN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."damage_status" AS ENUM('OPEN', 'CHARGED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('PENDING', 'AUTHORIZED', 'RELEASED', 'CAPTURED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."extra_pricing" AS ENUM('PER_DAY', 'PER_RENTAL');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('RENTAL', 'ADJUSTMENT', 'BALANCE');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."pricing_rule_type" AS ENUM('SEASONAL', 'DURATION_DISCOUNT', 'ONE_WAY_FEE');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('PENDING', 'CONFIRMED', 'PICKED_UP', 'RETURNED', 'CANCELLED', 'EXPIRED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."transmission" AS ENUM('AUTOMATIC', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('CUSTOMER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('AVAILABLE', 'RESERVED', 'ON_RENT', 'MAINTENANCE', 'RETIRED');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"emirate" text NOT NULL,
	"address" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"time_zone" text DEFAULT 'Asia/Dubai' NOT NULL,
	"opening_hours" text NOT NULL,
	"is_airport" boolean DEFAULT false NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"image_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code"),
	CONSTRAINT "branches_code_chk" CHECK ("branches"."code" ~ '^[A-Z0-9]{2,10}$'),
	CONSTRAINT "branches_lat_chk" CHECK ("branches"."latitude" is null or "branches"."latitude" between -90 and 90),
	CONSTRAINT "branches_lng_chk" CHECK ("branches"."longitude" is null or "branches"."longitude" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "damage_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"reservation_id" uuid,
	"reported_by" uuid,
	"stage" "damage_stage" DEFAULT 'OTHER' NOT NULL,
	"severity" "damage_severity" NOT NULL,
	"status" "damage_status" DEFAULT 'OPEN' NOT NULL,
	"description" text NOT NULL,
	"image_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_cost_fils" integer,
	"charged_fils" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "damage_reports_cost_chk" CHECK ("damage_reports"."estimated_cost_fils" is null or "damage_reports"."estimated_cost_fils" >= 0),
	CONSTRAINT "damage_reports_charged_chk" CHECK ("damage_reports"."charged_fils" >= 0),
	CONSTRAINT "damage_reports_description_chk" CHECK (length(trim("damage_reports"."description")) >= 3)
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"status" "deposit_status" DEFAULT 'PENDING' NOT NULL,
	"provider" text NOT NULL,
	"provider_hold_id" text,
	"idempotency_key" text NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"amount_fils" integer NOT NULL,
	"captured_fils" integer DEFAULT 0 NOT NULL,
	"capture_reason" text,
	"failure_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"authorized_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_provider_hold_id_unique" UNIQUE("provider_hold_id"),
	CONSTRAINT "deposits_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "deposits_amount_chk" CHECK ("deposits"."amount_fils" > 0),
	CONSTRAINT "deposits_capture_chk" CHECK ("deposits"."captured_fils" >= 0 and "deposits"."captured_fils" <= "deposits"."amount_fils"),
	CONSTRAINT "deposits_currency_chk" CHECK ("deposits"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"nationality" text,
	"licence_number" text NOT NULL,
	"licence_country" text NOT NULL,
	"licence_issued_on" date,
	"licence_expires_on" date NOT NULL,
	"licence_file_key" text,
	"licence_file_content_type" text,
	"licence_uploaded_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "driver_profiles_licence_dates_chk" CHECK ("driver_profiles"."licence_issued_on" is null or "driver_profiles"."licence_expires_on" > "driver_profiles"."licence_issued_on"),
	CONSTRAINT "driver_profiles_dob_chk" CHECK ("driver_profiles"."date_of_birth" > date '1900-01-01'),
	CONSTRAINT "driver_profiles_licence_number_chk" CHECK (length(trim("driver_profiles"."licence_number")) between 3 and 40)
);
--> statement-breakpoint
CREATE TABLE "extras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"pricing" "extra_pricing" NOT NULL,
	"price_fils" integer NOT NULL,
	"max_price_fils" integer,
	"max_quantity" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extras_code_unique" UNIQUE("code"),
	CONSTRAINT "extras_price_chk" CHECK ("extras"."price_fils" >= 0),
	CONSTRAINT "extras_max_price_chk" CHECK ("extras"."max_price_fils" is null or "extras"."max_price_fils" >= "extras"."price_fils"),
	CONSTRAINT "extras_max_qty_chk" CHECK ("extras"."max_quantity" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "maintenance_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"period" "tstzrange" GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_blocks_range_chk" CHECK ("maintenance_blocks"."end_at" > "maintenance_blocks"."start_at")
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"idempotency_key" text NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"amount_fils" integer NOT NULL,
	"refunded_fils" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_payment_id_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_amount_chk" CHECK ("payments"."amount_fils" > 0),
	CONSTRAINT "payments_refund_chk" CHECK ("payments"."refunded_fils" >= 0 and "payments"."refunded_fils" <= "payments"."amount_fils"),
	CONSTRAINT "payments_currency_chk" CHECK ("payments"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "pricing_rule_type" NOT NULL,
	"category_id" uuid,
	"pickup_branch_id" uuid,
	"return_branch_id" uuid,
	"valid_during" "tstzrange",
	"min_days" integer,
	"adjustment_bp" integer,
	"fee_fils" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_adjustment_chk" CHECK ("pricing_rules"."adjustment_bp" is null or "pricing_rules"."adjustment_bp" between -9000 and 30000),
	CONSTRAINT "pricing_rules_fee_chk" CHECK ("pricing_rules"."fee_fils" is null or "pricing_rules"."fee_fils" >= 0),
	CONSTRAINT "pricing_rules_min_days_chk" CHECK ("pricing_rules"."min_days" is null or "pricing_rules"."min_days" >= 1),
	CONSTRAINT "pricing_rules_shape_chk" CHECK (("pricing_rules"."type" = 'SEASONAL' and "pricing_rules"."valid_during" is not null and "pricing_rules"."adjustment_bp" is not null and not isempty("pricing_rules"."valid_during"))
       or ("pricing_rules"."type" = 'DURATION_DISCOUNT' and "pricing_rules"."min_days" is not null and "pricing_rules"."adjustment_bp" is not null and "pricing_rules"."adjustment_bp" < 0)
       or ("pricing_rules"."type" = 'ONE_WAY_FEE' and "pricing_rules"."fee_fils" is not null))
);
--> statement-breakpoint
CREATE TABLE "rental_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"agreement_number" text NOT NULL,
	"checked_out_by" uuid,
	"checked_in_by" uuid,
	"pickup_at" timestamp with time zone NOT NULL,
	"pickup_mileage_km" integer NOT NULL,
	"pickup_fuel_eighths" integer NOT NULL,
	"pickup_notes" text,
	"return_at" timestamp with time zone,
	"return_branch_id" uuid,
	"return_mileage_km" integer,
	"return_fuel_eighths" integer,
	"return_notes" text,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"late_fee_fils" integer DEFAULT 0 NOT NULL,
	"fuel_charge_fils" integer DEFAULT 0 NOT NULL,
	"damage_charge_fils" integer DEFAULT 0 NOT NULL,
	"extra_charges_vat_fils" integer DEFAULT 0 NOT NULL,
	"deposit_captured_fils" integer DEFAULT 0 NOT NULL,
	"outstanding_fils" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_agreements_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "rental_agreements_agreement_number_unique" UNIQUE("agreement_number"),
	CONSTRAINT "rental_agreements_pickup_mileage_chk" CHECK ("rental_agreements"."pickup_mileage_km" >= 0),
	CONSTRAINT "rental_agreements_pickup_fuel_chk" CHECK ("rental_agreements"."pickup_fuel_eighths" between 0 and 8),
	CONSTRAINT "rental_agreements_return_fuel_chk" CHECK ("rental_agreements"."return_fuel_eighths" is null or "rental_agreements"."return_fuel_eighths" between 0 and 8),
	CONSTRAINT "rental_agreements_return_mileage_chk" CHECK ("rental_agreements"."return_mileage_km" is null or "rental_agreements"."return_mileage_km" >= "rental_agreements"."pickup_mileage_km"),
	CONSTRAINT "rental_agreements_return_at_chk" CHECK ("rental_agreements"."return_at" is null or "rental_agreements"."return_at" > "rental_agreements"."pickup_at"),
	CONSTRAINT "rental_agreements_return_complete_chk" CHECK (("rental_agreements"."return_at" is null) = ("rental_agreements"."return_mileage_km" is null) and ("rental_agreements"."return_at" is null) = ("rental_agreements"."return_fuel_eighths" is null)),
	CONSTRAINT "rental_agreements_money_chk" CHECK ("rental_agreements"."late_minutes" >= 0 and "rental_agreements"."late_fee_fils" >= 0 and "rental_agreements"."fuel_charge_fils" >= 0 and "rental_agreements"."damage_charge_fils" >= 0
       and "rental_agreements"."extra_charges_vat_fils" >= 0 and "rental_agreements"."deposit_captured_fils" >= 0 and "rental_agreements"."outstanding_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservation_extras" (
	"reservation_id" uuid NOT NULL,
	"extra_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_fils" integer NOT NULL,
	"pricing" "extra_pricing" NOT NULL,
	"total_fils" integer NOT NULL,
	CONSTRAINT "reservation_extras_reservation_id_extra_id_pk" PRIMARY KEY("reservation_id","extra_id"),
	CONSTRAINT "reservation_extras_qty_chk" CHECK ("reservation_extras"."quantity" between 1 and 10),
	CONSTRAINT "reservation_extras_money_chk" CHECK ("reservation_extras"."unit_price_fils" >= 0 and "reservation_extras"."total_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"pickup_branch_id" uuid NOT NULL,
	"return_branch_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"period" "tstzrange" GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED NOT NULL,
	"status" "reservation_status" DEFAULT 'PENDING' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"days" integer NOT NULL,
	"daily_rate_fils" integer NOT NULL,
	"base_fils" integer NOT NULL,
	"extras_fils" integer DEFAULT 0 NOT NULL,
	"one_way_fee_fils" integer DEFAULT 0 NOT NULL,
	"discount_fils" integer DEFAULT 0 NOT NULL,
	"subtotal_fils" integer NOT NULL,
	"vat_rate_bps" integer NOT NULL,
	"vat_fils" integer NOT NULL,
	"total_fils" integer NOT NULL,
	"deposit_fils" integer NOT NULL,
	"price_breakdown" jsonb NOT NULL,
	"driver_name" text,
	"driver_email" text,
	"driver_phone" text,
	"driver_date_of_birth" date,
	"driver_licence_number" text,
	"driver_licence_country" text,
	"driver_licence_expires_on" date,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"cancellation_fee_fils" integer,
	"refunded_fils" integer DEFAULT 0 NOT NULL,
	"expired_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_reference_unique" UNIQUE("reference"),
	CONSTRAINT "reservations_range_chk" CHECK ("reservations"."end_at" > "reservations"."start_at"),
	CONSTRAINT "reservations_max_len_chk" CHECK ("reservations"."end_at" - "reservations"."start_at" <= interval '90 days'),
	CONSTRAINT "reservations_hold_chk" CHECK ("reservations"."status" <> 'PENDING' or "reservations"."hold_expires_at" is not null),
	CONSTRAINT "reservations_days_chk" CHECK ("reservations"."days" between 1 and 90),
	CONSTRAINT "reservations_money_chk" CHECK ("reservations"."daily_rate_fils" > 0 and "reservations"."base_fils" >= 0 and "reservations"."extras_fils" >= 0 and "reservations"."one_way_fee_fils" >= 0
       and "reservations"."discount_fils" >= 0 and "reservations"."subtotal_fils" >= 0 and "reservations"."vat_fils" >= 0 and "reservations"."total_fils" >= 0 and "reservations"."deposit_fils" >= 0),
	CONSTRAINT "reservations_total_chk" CHECK ("reservations"."total_fils" = "reservations"."subtotal_fils" + "reservations"."vat_fils"),
	CONSTRAINT "reservations_vat_rate_chk" CHECK ("reservations"."vat_rate_bps" between 0 and 10000),
	CONSTRAINT "reservations_refund_chk" CHECK ("reservations"."refunded_fils" >= 0),
	CONSTRAINT "reservations_cancel_fee_chk" CHECK ("reservations"."cancellation_fee_fils" is null or "reservations"."cancellation_fee_fils" >= 0),
	CONSTRAINT "reservations_currency_chk" CHECK ("reservations"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'CUSTOMER' NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_chk" CHECK (position('@' in "users"."email") > 1)
);
--> statement-breakpoint
CREATE TABLE "vehicle_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"daily_rate_fils" integer NOT NULL,
	"deposit_fils" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "vehicle_categories_rate_chk" CHECK ("vehicle_categories"."daily_rate_fils" > 0),
	CONSTRAINT "vehicle_categories_deposit_chk" CHECK ("vehicle_categories"."deposit_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vehicle_feature_map" (
	"vehicle_id" uuid NOT NULL,
	"feature_id" uuid NOT NULL,
	CONSTRAINT "vehicle_feature_map_vehicle_id_feature_id_pk" PRIMARY KEY("vehicle_id","feature_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_features_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "vehicle_occupancy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"reservation_id" uuid,
	"maintenance_block_id" uuid,
	CONSTRAINT "vehicle_occupancy_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "vehicle_occupancy_maintenance_block_id_unique" UNIQUE("maintenance_block_id"),
	CONSTRAINT "vehicle_occupancy_source_chk" CHECK (num_nonnulls("vehicle_occupancy"."reservation_id", "vehicle_occupancy"."maintenance_block_id") = 1),
	CONSTRAINT "vehicle_occupancy_period_chk" CHECK (not isempty("vehicle_occupancy"."period") and lower_inc("vehicle_occupancy"."period") and not upper_inc("vehicle_occupancy"."period"))
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"plate_number" text NOT NULL,
	"vin" text NOT NULL,
	"color" text,
	"transmission" "transmission" NOT NULL,
	"fuel_type" "fuel_type" NOT NULL,
	"seats" integer NOT NULL,
	"doors" integer NOT NULL,
	"luggage" integer NOT NULL,
	"daily_rate_fils" integer,
	"mileage_km" integer DEFAULT 0 NOT NULL,
	"status" "vehicle_status" DEFAULT 'AVAILABLE' NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_number_unique" UNIQUE("plate_number"),
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin"),
	CONSTRAINT "vehicles_year_chk" CHECK ("vehicles"."year" between 1990 and 2100),
	CONSTRAINT "vehicles_vin_chk" CHECK ("vehicles"."vin" ~ '^[A-HJ-NPR-Z0-9]{17}$'),
	CONSTRAINT "vehicles_seats_chk" CHECK ("vehicles"."seats" between 1 and 15),
	CONSTRAINT "vehicles_doors_chk" CHECK ("vehicles"."doors" between 2 and 6),
	CONSTRAINT "vehicles_luggage_chk" CHECK ("vehicles"."luggage" between 0 and 10),
	CONSTRAINT "vehicles_rate_chk" CHECK ("vehicles"."daily_rate_fils" is null or "vehicles"."daily_rate_fils" > 0),
	CONSTRAINT "vehicles_mileage_chk" CHECK ("vehicles"."mileage_km" >= 0)
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_pickup_branch_id_branches_id_fk" FOREIGN KEY ("pickup_branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_checked_out_by_users_id_fk" FOREIGN KEY ("checked_out_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_checked_in_by_users_id_fk" FOREIGN KEY ("checked_in_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_extras" ADD CONSTRAINT "reservation_extras_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_extras" ADD CONSTRAINT "reservation_extras_extra_id_extras_id_fk" FOREIGN KEY ("extra_id") REFERENCES "public"."extras"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_pickup_branch_id_branches_id_fk" FOREIGN KEY ("pickup_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_feature_map" ADD CONSTRAINT "vehicle_feature_map_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_feature_map" ADD CONSTRAINT "vehicle_feature_map_feature_id_vehicle_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."vehicle_features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_occupancy" ADD CONSTRAINT "vehicle_occupancy_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_occupancy" ADD CONSTRAINT "vehicle_occupancy_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_occupancy" ADD CONSTRAINT "vehicle_occupancy_maintenance_block_id_maintenance_blocks_id_fk" FOREIGN KEY ("maintenance_block_id") REFERENCES "public"."maintenance_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_uq" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "damage_reports_vehicle_idx" ON "damage_reports" USING btree ("vehicle_id","created_at");--> statement-breakpoint
CREATE INDEX "damage_reports_reservation_idx" ON "damage_reports" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "deposits_reservation_idx" ON "deposits" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "deposits_status_idx" ON "deposits" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_one_live_uq" ON "deposits" USING btree ("reservation_id") WHERE "deposits"."status" in ('PENDING', 'AUTHORIZED');--> statement-breakpoint
CREATE INDEX "maintenance_blocks_vehicle_idx" ON "maintenance_blocks" USING btree ("vehicle_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_uq" ON "payment_webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "payments_reservation_idx" ON "payments" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_rental_uq" ON "payments" USING btree ("reservation_id") WHERE "payments"."kind" = 'RENTAL' and "payments"."status" not in ('FAILED', 'CANCELLED');--> statement-breakpoint
CREATE INDEX "pricing_rules_type_idx" ON "pricing_rules" USING btree ("type","active");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_user_idem_uq" ON "reservations" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "reservations_user_idx" ON "reservations" USING btree ("user_id","start_at");--> statement-breakpoint
CREATE INDEX "reservations_vehicle_idx" ON "reservations" USING btree ("vehicle_id","start_at");--> statement-breakpoint
CREATE INDEX "reservations_status_idx" ON "reservations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reservations_hold_idx" ON "reservations" USING btree ("hold_expires_at") WHERE "reservations"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "reservations_period_gist" ON "reservations" USING gist ("vehicle_id","period");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "vehicle_feature_map_feature_idx" ON "vehicle_feature_map" USING btree ("feature_id");--> statement-breakpoint
CREATE INDEX "vehicles_branch_idx" ON "vehicles" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "vehicles_category_idx" ON "vehicles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "vehicles_status_idx" ON "vehicles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");