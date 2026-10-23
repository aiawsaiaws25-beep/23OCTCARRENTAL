# Team briefs and TASKS.md template

Adapt the names to your app. Each brief is the only context an agent has, so keep the constraints explicit.

## Brief every agent gets
- Project path, OS, tool versions, local DB names, and the port allocation.
- "Read TASKS.md first; your tasks are X1–Xn; follow file ownership; re-read before editing."
- "Read AGENTS.md / the framework docs in `node_modules/next/dist/docs/` before writing framework code" (Next.js versions change APIs).
- "Everything runs locally. Don't create or log in to cloud accounts."
- "Don't commit. Never print secret values from `.env.local`."
- "When something another agent needs is ready, mark TASKS.md **and** SendMessage them."
- "If you're blocked on something only the user can decide, message the lead. Don't guess."
- "When done, send the lead a final report: what was built, test results, what's untested, and decisions the user should know about."

## Database Engine brief (extra points)
- Priority: schema, migrations and auth first. Then publish typed service signatures to the App. Then migrate and seed `_dev` early.
- Every business rule lives in `src/server/**`, including pricing, availability, holds, payments and policy.
- Map 23P01, 40P01 and 40001 to one "unavailable" error.
- Write cloud adapters behind env switches and say plainly that they're not live-tested.

## App brief (extra points)
- Call the Database Engine's typed functions. Don't write SQL or pricing logic.
- Show only the server's quote; never trust client prices.
- Use stable roles and labels (plus `data-testid` where roles are ambiguous) so QA's tests hold up.
- No mock data, no dead buttons; loading, empty and error states on every page; enforce admin access server-side.
- Replace the framework starter page first.

## QA brief (extra points)
- You write tests, not product code. Bugs go to their owner.
- Point Playwright's web server at a QA-owned database and its own build directory and payment state file.
- Run concurrency tests at both the database and browser level, repeated many times.
- Use a fixed clock, unique data per test, and no reliance on seed order.
- Report "deployed app works" as blocked until cloud access exists.

## TASKS.md template

```markdown
# <App> — shared task list
Team: db-engine, app, qa. Lead: main session.
Markers: [ ] todo · [~] in progress (name) · [x] done · [!] blocked (why)
Rules: edit only your lines (qa owns Bugs); re-read before editing; mark + message when a dependency is ready.

## File ownership
- db-engine: src/db/**, drizzle/**, src/server/**, src/lib/**, src/app/api/**, scripts/**, vercel.json, .env.example
- app: src/app/** (not api), src/components/**, public/**
- qa: e2e/**, tests/**, *.test.ts, playwright/vitest configs
- Shared (message first): package.json, lockfile, next.config.ts

## Local resources
- DBs: app=_dev, qa=_test (+ throwaways), db-engine=_scratch
- Ports: qa=3000, app=<free port>, db-engine=<free port>. Only qa runs `next build`.
- Nobody commits.

## db-engine
- [ ] D1 Schema … (one line per deliverable)
## app
- [ ] A1 Design system + layout …
## qa
- [ ] Q1 Harness: reset/migrate/seed helpers, auth fixtures …
## Bugs
<!-- - [ ] B1 (owner: app|db-engine) summary — repro — test name -->
## Blocked on user (cloud)
- Vercel link, Neon, Blob store, payment provider test keys
```
