---
name: booking-app-builder
description: Use this skill when building any booking or reservation web app with a three-agent team (App, Database Engine, QA), working local first and ready to move to Vercel later.
---

# Booking App Builder

A playbook for building a booking or reservation web app with three agents that share one task list.
It was distilled from building DriveEasy, a car-rental app. The stack is Next.js (App Router, TypeScript, Tailwind), PostgreSQL, Drizzle ORM, Better Auth, Vitest and Playwright.

Supporting files in this folder:
- [tables.md](tables.md): a full example table list and the column rules
- [sample-migration.sql](sample-migration.sql): the double-booking guard (exclusion constraint and triggers)
- [team-briefs.md](team-briefs.md): ready-to-adapt briefs for the three agents and a TASKS.md template

---

## 1. When to use this skill

Use it when the app sells **time slots on a limited resource**, where two people must never get the same resource at the same time.

It fits:
- Car, bike, scooter or equipment rental
- Hotel rooms, holiday homes, campsites
- Meeting rooms, desks, studios, sports courts
- Clinic, salon or tutor appointments (the resource is the person or chair)
- Event seats, boat trips, tours with fixed capacity per slot
- Parking spaces, storage units, EV chargers

It doesn't fit apps with no shared resource, such as pure e-commerce or content sites. Unlimited-capacity bookings, such as webinars, don't need the overlap guard either.

---

## 2. Step 0: local setup (before any agent starts)

**Rule: everything runs locally. Create no cloud accounts until the user gives the links.**

1. Detect the OS and use its installer: `winget` (Windows), Homebrew (macOS), `apt` (Linux). Check what's installed first and only install or update what's missing.
2. Install these tools:
   - Node.js (current LTS)
   - pnpm
   - Git (set the user's name and email only if they aren't set)
   - PostgreSQL (latest stable, running as a service)
3. Set up the local database:
   - Create one app role with `CREATEDB`. Create `<app>_dev` and `<app>_test`.
   - Run `CREATE EXTENSION btree_gist` in each one. The overlap guard needs it.
   - Store the superuser password in the user's pgpass file. Never put it in the repo.
4. Create the project:
   - Next.js with TypeScript, App Router, Tailwind and ESLint.
   - Add Drizzle ORM, Drizzle Kit, `pg`, Zod, Better Auth, `qrcode`, Vitest, Playwright and `tsx`.
   - Run `playwright install` to get the browsers.
5. Set up local stand-ins, each behind an interface and chosen by an env var:

   | Need | Local stand-in | Env switch | Cloud later |
   |---|---|---|---|
   | Payments | Fake provider in a JSON state file: succeed, fail, cancel, refund, hold and release deposits, signed webhooks, duplicate webhooks | `PAYMENTS_PROVIDER=fake` | `stripe` |
   | Private uploads | `./uploads` folder (never under `public/`) with path-traversal checks | `STORAGE_PROVIDER=local` | `vercel-blob` |
   | Scheduled cleanup | `pnpm jobs:release-holds` CLI | — | Vercel Cron calling a protected route |

6. Create the settings files:
   - `.env.local` holds the local DB URLs and generated secrets.
   - `.env.example` lists every variable, cloud ones included, with no values.
   - `.gitignore` covers `.env*` but keeps `.env.example` (`!.env.example`), plus `/uploads/` and `/.local/`.
7. Run `git init` and make the first commit.
8. Turn on agent teams by putting `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }` in `.claude/settings.json`. **Restart Claude Code** before creating the team.
9. Finish with a checklist that shows each tool's version, each database and each stand-in with ✅ or ❌.

---

## 3. The three-agent team

| Agent | Owns (files) | Builds |
|---|---|---|
| **Database Engine** | `src/db/**`, `drizzle/**`, `src/server/**`, `src/lib/**`, `src/app/api/**`, `scripts/**`, `vercel.json`, `.env.example` | Schema, migrations, seed, auth wiring, every business rule (availability, pricing, holds, payments, policy), route handlers, cloud adapters |
| **App** | `src/app/**` (not `api`), `src/components/**`, `public/**` | Every page and form. It calls typed server functions and never writes SQL or pricing rules. |
| **QA** | `e2e/**`, `tests/**`, `*.test.ts`, test configs, the **Bugs** section | Tests only. It never fixes product code. |

Shared files (`package.json`, `next.config.ts`, the lockfile) need a message to the others before anyone edits them.

**Shared task list.** `TASKS.md` sits at the repo root. The template is in [team-briefs.md](team-briefs.md).
- Markers: `[ ]` todo, `[~]` in progress (with the agent's name), `[x]` done, `[!]` blocked.
- Each agent edits only its own lines and re-reads the file before every edit.

**Communication.** Agents message each other directly. When a piece someone depends on is ready, mark it in TASKS.md **and** send a message.

**Bug hand-off:**
1. QA adds `- [ ] B<n> (owner: app|db-engine) summary - repro - test name` and messages the owner.
2. The owner fixes it, marks it `[x]` and messages QA.
3. QA retests and adds "verified", or reopens it with details.

**Keep agents from colliding:**
- One database each: app uses `_dev`, QA uses `_test` plus throwaway ones, db-engine uses `_scratch`.
- One port each. Only QA runs `next build`.
- Nobody commits. The lead commits at milestones after asking the user.

**Order of work:** the Database Engine publishes the schema and typed function signatures first, so the App isn't blocked. It also migrates and seeds `_dev` early, before the services are finished, so the UI has real data.

---

## 4. Database rules

- **Primary keys:** UUIDs everywhere (`gen_random_uuid()`), including auth tables. Map Better Auth to them with `generateId: "uuid"`.
- **Time:**
  - Store every timestamp as `timestamptz` in UTC.
  - Each location stores an IANA time zone, used only for display.
- **Money:**
  - Integer minor units (cents, fils, pence). Never floats.
  - Percentages are integer basis points (500 = 5%).
  - Put a `CHECK (amount >= 0)` on every money column.
- **Uniqueness:** add unique constraints on natural identifiers (plate, VIN and location code in DriveEasy). Match emails case-insensitively with `lower(email)`.
- **Integrity:** add foreign keys with deliberate cascade rules, CHECK constraints (`end > start`, value ranges) and an index on every foreign key and filter column.
- **Status lists:** Postgres enums. Keep them as **separate columns**, never one combined status.
  - Resource: `AVAILABLE, RESERVED, IN_USE, MAINTENANCE, RETIRED`
  - Booking: `PENDING, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, EXPIRED, REFUNDED`
  - Payment: `PENDING, SUCCEEDED, FAILED, CANCELLED, PARTIALLY_REFUNDED, REFUNDED`
  - Deposit: `PENDING, AUTHORIZED, RELEASED, CAPTURED, FAILED`
- **How double booking is blocked:**
  1. Each booking and each maintenance block stores a half-open `tstzrange [start, end)` period.
  2. Triggers copy every *active* period (PENDING, CONFIRMED, IN_PROGRESS bookings and non-cancelled blocks) into an `occupancy` table.
  3. That table has `EXCLUDE USING gist (resource_id WITH =, period WITH &&)`.
  4. The trigger runs inside the writing transaction, so two overlapping writes can never both commit. The loser gets SQLSTATE `23P01`.
  5. Because the range is half-open, back-to-back bookings (one ends at 10:00, the next starts at 10:00) are allowed.

  See [sample-migration.sql](sample-migration.sql).
- **Expired holds:** a constraint can't depend on `now()`, so an expired PENDING hold keeps blocking its period until it is set to EXPIRED. Expire holds in two places: lazily on the locked resource during the next booking, and with the cleanup job.

---

## 5. The booking transaction, step by step

1. **Validate input** with Zod: UUIDs, real dates, start before end, minimum lead time, maximum length. Reject bad input before it reaches SQL.
2. **Check the idempotency key.** If this user already has a booking with this key, return it.
3. **BEGIN.**
4. **Lock the resource row:** `SELECT ... FROM resources WHERE id = $1 FOR UPDATE`. This makes bookings for one resource run one at a time.
5. **Check the idempotency key again** inside the transaction. A duplicate request may have committed while this one waited for the lock (see bug B4).
6. **Expire stale holds** on this resource.
7. **Check for overlaps** with active bookings and maintenance blocks. Return a friendly "unavailable" error if there is one.
8. **Price on the server:** base rate × units, extras, fees, taxes and deposit. Never trust prices sent by the client.
9. **Insert a PENDING booking** with `hold_expires_at` (DriveEasy uses 15 minutes) and the price breakdown.
10. **COMMIT.** Map `23P01` (overlap), `40P01` (deadlock) and `40001` (serialization) to the same "unavailable" error, retrying once where it's safe.
11. **Take payment** (the charge and the deposit authorisation) with provider idempotency keys derived from the booking.
12. **Confirm** only after both are verified, either by the synchronous result or by a signed webhook.
13. **Webhooks:** verify the signature, store the event id with a unique constraint, and skip it if already processed. Applying an event must be idempotent.
14. **Cleanup route** `/api/cron/release-holds` (GET and POST) requires `Authorization: Bearer $CRON_SECRET`. It expires holds and releases deposits, and running it twice is safe.

---

## 6. QA checklist (all must pass before "finished")

- [ ] Migrations run cleanly on an **empty** database, and twice in a row; the exclusion constraint is present
- [ ] Register, log in, log out; customers and anonymous users are blocked from admin, **server-side**
- [ ] Search by location, dates and filters; availability calendar is correct
- [ ] Full flow: search → hold → pay → voucher/QR → start → finish/return
- [ ] **Concurrency:** N parallel bookings for the same resource and dates, repeated many times, give exactly one winner. Also run it with two browser sessions.
- [ ] Back-to-back bookings (end == next start) both succeed
- [ ] Expired holds are released; the cleanup route rejects a missing or wrong secret; repeated runs are safe
- [ ] Pricing: rates, extras, fees, tax, late charges, deposit, all in integer minor units; tampered client prices are ignored
- [ ] Fake payments: success, failure, cancel, retry (no double charge), refund, deposit hold, release and capture, duplicate webhook applied once, bad signature rejected
- [ ] Users can't see others' bookings, vouchers or uploads (guess IDs, call server actions directly, hit the file route)
- [ ] Unit tests and browser tests pass on desktop **and** mobile viewports, with no horizontal overflow
- [ ] `next build` and `next start` pass; no secrets in `.next/static`
- [ ] Every page has loading, empty and error states; no mock data; no dead buttons

The definition of done also includes "the deployed app works end to end". If the user hasn't supplied cloud access, report that item as **blocked**, not done.

---

## 7. Moving to the cloud later

Code doesn't change; settings do. Ask the user for links and credentials, and never log in for them.

| Service | Set these | Notes |
|---|---|---|
| **Vercel** | Project linked by the user; `APP_URL`, `BETTER_AUTH_URL` per environment | Separate Preview and Production env vars; different secrets in each |
| **Neon** (Vercel Marketplace) | `DATABASE_URL` (pooled, `-pooler` host) for the app; `DATABASE_URL_UNPOOLED` for migrations | Build command `pnpm db:deploy && pnpm build`; the migrate script refuses to run on Vercel without the unpooled URL; run `CREATE EXTENSION btree_gist` |
| **Blob storage** | `STORAGE_PROVIDER=vercel-blob`, `BLOB_READ_WRITE_TOKEN` | Private access for IDs and licences, served only through the authorised file route |
| **Payments** (e.g. Stripe test mode) | `PAYMENTS_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Deposits use `capture_method: manual`; register the webhook URL and events; env validation refuses non-test keys outside production |
| **Cron** | `CRON_SECRET`; `vercel.json` `crons` | The Hobby plan only allows daily crons; lazy expiry keeps correctness either way |

Keep secrets server-only: `import "server-only"` in every server module, and never put a secret in a `NEXT_PUBLIC_` variable.

---

## 8. Lessons learned (from DriveEasy)

These notes were written while the App and QA agents were still finishing. Add to them as later problems surface.

**Setup**
- **`create-next-app` rejects capital letters in the folder name.** Fix: scaffold into a lowercase folder in a temp directory, then move the files in.
- **pnpm blocks dependency build scripts, so esbuild didn't install.** Fix: allow it under `allowBuilds:` in `pnpm-workspace.yaml`, then `pnpm rebuild esbuild`.
- **Vitest needed a newer `@types/node`.** Fix: match `@types/node` to the installed Node major version.
- **Vitest 5 no longer exports `loadEnv`.** Fix: read env files with `node:util` `parseEnv` in `vitest.config.mts`.
- **`tsc` failed on `LayoutProps`.** Fix: those types are generated, so the typecheck script is `next typegen && tsc --noEmit`.
- **`NODE_ENV` in `.env.local` overrode the tooling.** Fix: never set it in env files.
- **The Git update failed because Git Bash windows were open.** Fix: don't kill the user's processes. Report it, since a patch-level gap is fine.
- **The agent-teams setting had no effect until restart.** Fix: restart Claude Code before creating the team.

**Team and dev servers**
- **Port 3001 was taken by an unrelated program.** Fix: check ports first, pick a free one, and add it to the auth trusted origins.
- **Next.js 16 allows one `next dev` per build directory**, so QA's server couldn't start while App's was running. Fix: in `next.config.ts`, set `distDir: process.env.NEXT_DIST_DIR || ".next"`; QA uses `.next-qa`.
- **The user opened the app and saw the starter page with broken images.** Fix: replace the home page first, and remove starter assets only along with the code that references them.
- **The home page showed "couldn't load" errors because the dev database had no tables.** Fix: migrate and seed `_dev` as soon as migrations work, before the services are finished.
- **`import "server-only"` broke Vitest and the CLI scripts.** Fix: alias it to a stub in Vitest, and run scripts with `tsx --conditions=react-server`.

**Database and logic bugs QA caught**
- **B4: the same idempotency key sent concurrently returned "unavailable" to every request but the first.** The row lock made them queue, and each one failed the overlap check before looking up the key. Fix: check the key again inside the transaction, after taking the lock.
- **B2: a non-UUID ID reached Postgres** (`22P02`) and caused a 500 error. Fix: validate IDs first and return `not_found`.
- **B3: an impossible date such as `2031-13-45`** passed the regex but crashed Postgres (`22008`). Fix: parse dates properly, not just with a regex.
- **B5: date changes refunded price decreases inside the 48-hour window**, which contradicted the written policy. Fix: one policy module drives both the code and the UI, and tests use a fixed clock.
- **B1: pricing returned `-0`.** Fix: normalise rounding results (`|| 0`).
- **Drizzle Kit can't express `EXCLUDE` constraints.** Fix: put the constraint and triggers in a custom SQL migration.
- **An exclusion constraint can't use `now()`.** Fix: expire holds lazily during booking as well as with the cron job.

**Deployment**
- **Vercel Hobby only allows daily crons**, but DriveEasy's cleanup is set to every 5 minutes. Fix: ask the user which plan they're on before setting the schedule.
- **Cloud adapters can't be tested without accounts.** Fix: say so plainly in reports, and never claim they were tested live.
