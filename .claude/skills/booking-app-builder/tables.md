# Example table list (from DriveEasy, a car-rental app)

Rename the domain tables for your app (vehicles → rooms, branches → locations, and so on). The rules stay the same.

## Column rules for every table
- `id uuid primary key default gen_random_uuid()`
- `created_at timestamptz not null default now()` and `updated_at timestamptz not null default now()`
- Money: `integer` minor units, with `CHECK (col >= 0)`
- Percentages: integer basis points
- Periods: `start_at timestamptz`, `end_at timestamptz`, a generated `period tstzrange` (`[)`), and `CHECK (end_at > start_at)`
- Every foreign key column is indexed

## Auth (Better Auth mapped onto plural tables)
| Table | Purpose / key columns |
|---|---|
| users | name, email (unique on `lower(email)`), role enum (CUSTOMER, ADMIN), phone |
| sessions | user_id → users (cascade), token unique, expires_at |
| accounts | user_id → users (cascade), provider_id + account_id unique, password hash |
| verifications | identifier, value, expires_at |

## Customers
| Table | Purpose / key columns |
|---|---|
| driver_profiles | user_id unique → users; full name, date of birth, licence number, country, expiry; `licence_file_key` (private storage key, never a URL) |

## Catalog
| Table | Purpose / key columns |
|---|---|
| branches | code **unique**, name, address, `time_zone` (IANA), opening hours, active flag |
| vehicle_categories | name, slug unique, base daily rate (minor units), deposit amount |
| vehicles | category_id, home branch_id, plate **unique**, VIN **unique**, make, model, year, transmission enum, fuel enum, seats, status enum, mileage, photo paths |
| vehicle_features | name, slug unique |
| vehicle_feature_map | (vehicle_id, feature_id) composite primary key, cascade on delete |
| pricing_rules | type enum (SEASONAL, DURATION_DISCOUNT, ONE_WAY_FEE), category/branch scope, date range, basis points or fixed amount, priority |
| extras | code unique, name, pricing enum (PER_DAY, PER_RENTAL), price, max quantity, active |

## Bookings and money
| Table | Purpose / key columns |
|---|---|
| reservations | reference unique, user_id, vehicle_id, pick-up and return branch, start_at, end_at, `period`, status enum, `hold_expires_at`, `idempotency_key` (unique per user), price breakdown columns, total, deposit |
| reservation_extras | reservation_id (cascade), extra_id, quantity, unit price, line total (prices are copied at booking time) |
| payments | reservation_id, kind enum (RENTAL, ADJUSTMENT, BALANCE), status enum, amount, refunded amount, provider + provider id unique, idempotency key |
| deposits | reservation_id unique, status enum, amount, captured amount, provider hold id, expires_at |
| payment_webhook_events | provider + event id **unique** (duplicate-webhook guard), type, processed_at |

## Operations
| Table | Purpose / key columns |
|---|---|
| rental_agreements | reservation_id unique; mileage and fuel (eighths) **at pick-up and return**; staff ids; late minutes; charges |
| damage_reports | vehicle_id, reservation_id, stage enum (PICKUP, RETURN, OTHER), severity enum, status enum, description, private image keys, charge |
| maintenance_blocks | vehicle_id, start_at, end_at, `period`, reason, cancelled_at |
| vehicle_occupancy | vehicle_id, period, reservation_id **or** maintenance_block_id (each unique); carries the exclusion constraint |
| audit_logs | actor user_id, action, entity type and id, before/after jsonb, ip, created_at |
