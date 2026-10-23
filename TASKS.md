# DriveEasy — shared task list

Team: **db-engine** (Database Engine Agent), **app** (App Agent), **qa** (QA Agent). Lead: main session.

How to use this file
- Status markers: `[ ]` todo · `[~]` in progress (add your name) · `[x]` done · `[!]` blocked (say why).
- Only change your own lines, except QA adds bugs under **Bugs**. Re-read the file before editing; others edit it too.
- When something another agent depends on is ready, mark it here AND tell them with SendMessage.

Assumptions (from lead): currency AED stored in fils (integer); branches in `Asia/Dubai`; UAE VAT 5%.
Local first: payments use `PAYMENTS_PROVIDER=fake`, storage `STORAGE_PROVIDER=local`. Cloud adapters (Stripe test mode, Vercel Blob, Neon) are written and selectable by env, but nothing is deployed and no cloud account is used until the user supplies links.

## File ownership (avoid editing another agent's files — message them instead)
- db-engine: `src/db/**`, `drizzle/**`, `src/server/**` (domain services: availability, pricing, reservations, payments flow, holds, audit), `src/lib/services/**`, `src/lib/auth.ts`, `src/lib/env.ts`, `scripts/**`, `src/app/api/**` (route handlers: auth, webhooks, cron, file serving), `vercel.json`, `drizzle.config.ts`, `.env.example`
- app: `src/app/**` except `src/app/api/**`, `src/components/**`, `src/hooks/**`, `src/styles/**`, `public/**`
- qa: `e2e/**`, `tests/**`, `playwright.config.ts`, `vitest.config.mts`, and `*.test.ts` files anywhere
- Shared, coordinate first: `package.json`, `pnpm-lock.yaml`, `next.config.ts`, `src/middleware.ts`/`src/proxy.ts`

## Local resources (do not fight over them)
- Databases: app uses `driveeasy_dev`; qa owns `driveeasy_test`; db-engine creates its own scratch DB `driveeasy_scratch` (role `driveeasy` has CREATEDB) for clean-migration runs.
- Ports: qa's Playwright server uses 3000; app uses `pnpm dev --port 3005` (3001 is taken by an unrelated `node server/dev-api.js` process on this machine); db-engine uses 3002 if needed.
- Only qa runs `next build`. Others use `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- Nobody commits to git. The lead commits at milestones after asking the user.

## db-engine
- [x] (db-engine) D1 Schema for all 18 tables (UUID PKs, UTC timestamptz, integer fils, FKs, checks, indexes, cascades, unique plate/VIN/branch code, enums for vehicle/reservation/payment/deposit status)
- [x] (db-engine) D2 tstzrange periods + EXCLUDE USING gist on active reservations/holds and maintenance blocks per vehicle (half-open `[start,end)` so back-to-back works)
- [x] (db-engine) D3 Migrations via drizzle-kit (custom SQL for btree_gist + exclusion constraints); `pnpm db:migrate` passes on a clean DB
- [x] (db-engine) D4 Better Auth wired to `users` table (uuid ids), roles CUSTOMER/ADMIN, session helpers `requireUser()` / `requireAdmin()`
- [x] (db-engine) D5 Seed: branches, categories, vehicles, features, extras, pricing rules, future reservations, one admin + one customer (creds recorded in `scripts/seed` output / `.env.example` notes, test values only)
- [x] (db-engine) D6 Services: search/availability (incl. per-vehicle calendar), server-side pricing quote (daily rate, days, extras, one-way fee, VAT, deposit, late-return charge)
- [x] (db-engine) D7 Reservation transaction: BEGIN → lock vehicle row → overlap check → hold with expiry → price on server → pending reservation → COMMIT; idempotency key; reject when unavailable
- [x] (db-engine) D8 Payment flow: charge + deposit hold via PaymentProvider; confirm reservation only after verified payment + deposit authorisation; webhook route with signature check + duplicate-event de-dup; refund/cancel per cancellation policy; modify dates
- [x] (db-engine) D9 Expired-hold release: idempotent service + `POST /api/cron/release-holds` protected by `CRON_SECRET` + local `pnpm jobs:release-holds`
- [x] (db-engine) D10 Admin services: branches, fleet, pricing, reservations, check-out/check-in (mileage + fuel in rental_agreements), damage reports, audit_logs
- [x] (db-engine) D11 Private licence/damage uploads: storage adapter (local + Vercel Blob private), authorised file route (owner or admin only)
- [x] (db-engine) D12 Stripe test-mode adapter (charges + manual-capture deposit holds) behind `PAYMENTS_PROVIDER=stripe` — written + typechecked, NOT live-tested (needs Stripe test keys); Vercel Blob adapter likewise
- [x] (db-engine) D13 Deployment prep: `vercel.json` cron, migrate-on-deploy script using unpooled URL, env docs in `.env.example`, structured server logger

## app
- [x] A1 Design system + layout (responsive header/nav, footer, buttons, inputs, cards, loading/empty/error states)
- [x] A2 Home + search form (pick-up/return branch, dates/times)
- [x] A3 Search results with filters (category, transmission, seats, fuel, price)
- [x] A4 Vehicle details + availability calendar
- [x] A5 Branch pages
- [x] A6 Booking flow: dates → extras → driver details + licence upload → price breakdown → checkout/payment
- [x] A7 Pick-up voucher with reservation reference + QR code
- [x] A8 My rentals: view, modify dates, cancel per policy; profile page
- [x] A9 Login / register / logout
- [x] A10 Admin: branches, fleet, pricing, reservations, check-out, check-in, damage reports
- [x] A11 Mobile + desktop polish; every screen on the real DB; no mock data or dead buttons

## qa
- [x] (qa) Q1 Test harness: test DB reset + migrate + seed helpers; Playwright auth fixtures — `tests/helpers/{db,factory}.ts`, vitest globalSetup rebuilds driveeasy_test; Playwright server runs on driveeasy_e2e (`e2e/prepare-db.ts`), fixtures in `e2e/fixtures.ts`
- [ ] Q2 Auth: register, login, logout, authorization
- [ ] Q3 Search, branches, date ranges, filters, availability calendars
- [ ] Q4 Full rental: search → payment → voucher → check-out → return
- [~] (qa) Q5 Concurrency: two simultaneous overlapping reservations → exactly one succeeds — DB level (20x10 raw tx) + service level (20 rounds x 10 users, same-key x10, parallel pay) passing; 2-browser e2e pending A6
- [~] (qa) Q6 Back-to-back rentals (end == next start) both succeed — DB + service level passing (hold, pay, check-out after previous check-in); e2e pending A6
- [ ] Q7 Expired holds + release endpoint (idempotent, CRON_SECRET enforced)
- [ ] Q8 Pricing: daily rates, extras, one-way fee, VAT, late return, deposit
- [ ] Q9 Payments: success, failure, cancel, retry, refund, deposit release, duplicate webhook
- [ ] Q10 Access control: other users' reservations, vouchers, licence files; admin-only screens
- [x] (qa) Q11 Migrations on a clean DB — fresh driveeasy_clean → migrate (x2, idempotent) → seed; exclusion constraint, triggers, uuid PKs, int money, timestamptz, FKs/checks/uniques asserted (tests/integration/migrations.test.ts)
- [ ] Q12 Production build (`next build` + `next start`) locally; preview/production Vercel builds once deployed
- [ ] Q13 Desktop + mobile layouts (Playwright mobile projects)

## Bugs
<!-- qa: `- [ ] B1 (owner: app|db-engine) summary — repro — found in test X`; owner marks [x] when fixed, qa retests and adds "verified". -->
- [x] B2 (owner: db-engine) searchVehicles throws (unhandled 22P02 → 500 + error log) when pickupBranchId/returnBranchId is not a UUID, instead of returning { ok:false, code:"not_found" } (getQuote already guards with isUuid) — repro: searchVehicles({ pickupBranchId: "DXB", ... }) — tests/integration/catalog.test.ts "non-uuid branch ids are a clean not_found" — verified (qa)
- [x] B3 (owner: db-engine) getVehicleCalendar throws (22008 date out of range) for a regex-valid but impossible date like "2031-13-45" (reachable from a ?from= query param) instead of returning null — tests/integration/catalog.test.ts "does not throw on an impossible calendar date" — verified (qa)
- [x] B4 (owner: db-engine) createReservationHold: the same idempotency key sent concurrently (double-click / network retry) returns "unavailable" for all but the first call instead of the same reservation — the vehicle FOR UPDATE lock serialises them and the loser fails isVehicleFree before the idempotency lookup; fix: re-check findByIdempotencyKey inside the tx after the lock (or on unavailable) — tests/integration/reservations.test.ts "same idempotency key sent 10x in parallel" — verified (qa)
- [x] B5 (owner: db-engine) modifyReservationDates refunds a price decrease even when the change is made < 48h before the original pick-up; policy.ts says decreases are refunded only >= 48h before — repro: confirmed 3-day booking, shorten to 1 day with now = pick-up - 30h → refundedFils 21000 (expected 0) — reservations.test.ts "shorter rental < 48h before pick-up is not refunded" — verified (qa)
- [x] B6 (owner: app) /admin/pricing overflows horizontally on mobile (scrollWidth 586px at 412px viewport, Pixel 7 + iPhone 14): the rules table sits in an overflow-x container, but the last <th> holds a SPAN.sr-only (position:absolute) whose containing block is outside that scroller, so it sticks out to x=586 and widens the page. Fix: add `relative` to the overflow-x-auto wrapper (or the table). Check other admin tables too — e2e/layout.spec.ts "admin pages have no horizontal overflow" [mobile-chrome, mobile-safari] — verified (qa)
- [x] B1 (owner: db-engine) computeQuote returns durationDiscountFils = -0 (negative zero) when no duration discount applies (bp(base, -0) → Math.round(-0)); cosmetic but leaks into breakdown objects/Object.is comparisons — fix e.g. `Math.abs`/`|| 0` or bp(base, Math.abs(discountBp)) — repro: computeQuote with rules=[] — tests/unit/pricing.test.ts "3 days at AED 150…" + "only the best duration discount…" — verified (qa)

## Blocked on user (cloud)
- Vercel project link + `vercel login` by the user
- Neon via Vercel Marketplace (pooled `DATABASE_URL`, unpooled `DATABASE_URL_UNPOOLED`)
- Vercel Blob store (`BLOB_READ_WRITE_TOKEN`)
- Stripe test keys + webhook secret
