// Playwright fixtures: unique users per test, logged-in customer/admin pages,
// and direct access to the e2e database for setup/assertions.
import { randomUUID } from "node:crypto";
import { type APIRequestContext, type Browser, type BrowserContextOptions, type Page, test as base, expect } from "@playwright/test";
import { query } from "../tests/helpers/db";

export const PASSWORD = "Qa-Test-Passw0rd!";

export type TestUser = { email: string; password: string; name: string; id?: string };

export function uniqueEmail(prefix = "qa") {
  return `${prefix}+${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
}

export function e2eDb() {
  const url = process.env.QA_E2E_DATABASE_URL;
  if (!url) throw new Error("QA_E2E_DATABASE_URL not set (playwright.config.ts sets it)");
  return {
    url,
    query: <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => query<T>(url, sql, params),
  };
}

// Better Auth email+password endpoints. Origin header is required by its CSRF check.
async function authPost(req: APIRequestContext, baseURL: string, path: string, data: unknown) {
  const res = await req.post(`/api/auth/${path}`, { data, headers: { origin: baseURL } });
  return res;
}

export async function signUp(req: APIRequestContext, baseURL: string, user: TestUser) {
  const res = await authPost(req, baseURL, "sign-up/email", { email: user.email, password: user.password, name: user.name });
  expect(res.ok(), `sign-up failed: ${res.status()} ${await res.text()}`).toBe(true);
  const body = await res.json().catch(() => ({}));
  return { ...user, id: body?.user?.id as string | undefined };
}

export async function signIn(req: APIRequestContext, baseURL: string, user: Pick<TestUser, "email" | "password">) {
  const res = await authPost(req, baseURL, "sign-in/email", { email: user.email, password: user.password });
  expect(res.ok(), `sign-in failed: ${res.status()}`).toBe(true);
  return res;
}

/** Promote a user to ADMIN directly in the e2e DB (role column on users). */
export async function makeAdmin(email: string) {
  const rows = await e2eDb().query(`update users set role = 'ADMIN' where email = $1 returning id`, [email]);
  expect(rows.length, `no user ${email} to promote`).toBe(1);
}

/**
 * Production builds rate-limit Better Auth per client IP (x-forwarded-for when present). Every test
 * context gets its own private-range address so parallel sign-ups don't share one bucket.
 * (On Vercel the platform sets x-forwarded-for itself, so clients cannot choose their bucket.)
 */
export function fakeClientIp() {
  const b = () => Math.floor(Math.random() * 254) + 1;
  return `10.${b()}.${b()}.${b()}`;
}

/** New browser context (same device emulation as the project) with a freshly registered user logged in. */
export async function newUserPage(
  browser: Browser,
  baseURL: string,
  opts: { admin?: boolean; prefix?: string; contextOptions?: BrowserContextOptions } = {},
) {
  const context = await browser.newContext({
    ...opts.contextOptions,
    baseURL,
    extraHTTPHeaders: { ...opts.contextOptions?.extraHTTPHeaders, "x-forwarded-for": fakeClientIp() },
  });
  const page = await context.newPage();
  const user = await signUp(page.request, baseURL, {
    email: uniqueEmail(opts.prefix ?? (opts.admin ? "admin" : "customer")),
    password: PASSWORD,
    name: opts.admin ? "QA Admin" : "QA Customer",
  });
  if (opts.admin) {
    await makeAdmin(user.email);
    // Re-login so the session reflects the new role.
    await context.clearCookies();
    await signIn(page.request, baseURL, user);
  }
  return { context, page, user };
}

type Fixtures = {
  deviceOptions: BrowserContextOptions;
  customer: { page: Page; user: TestUser };
  otherCustomer: { page: Page; user: TestUser };
  admin: { page: Page; user: TestUser };
};

export const test = base.extend<Fixtures>({
  // Default page/request contexts get their own client IP as well.
  extraHTTPHeaders: async ({}, provide) => provide({ "x-forwarded-for": fakeClientIp() }),
  deviceOptions: async ({ viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, locale, timezoneId }, provide) =>
    provide({ viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, locale, timezoneId }),
  customer: async ({ browser, baseURL, deviceOptions }, provide) => {
    const s = await newUserPage(browser, baseURL!, { prefix: "customer", contextOptions: deviceOptions });
    await provide({ page: s.page, user: s.user });
    await s.context.close();
  },
  otherCustomer: async ({ browser, baseURL, deviceOptions }, provide) => {
    const s = await newUserPage(browser, baseURL!, { prefix: "other", contextOptions: deviceOptions });
    await provide({ page: s.page, user: s.user });
    await s.context.close();
  },
  admin: async ({ browser, baseURL, deviceOptions }, provide) => {
    const s = await newUserPage(browser, baseURL!, { admin: true, contextOptions: deviceOptions });
    await provide({ page: s.page, user: s.user });
    await s.context.close();
  },
});

export { expect };

/** Asserts the page has no horizontal overflow (mobile layout check). */
export async function expectNoHorizontalOverflow(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const { scrollWidth, clientWidth, culprits } = await page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    // Elements whose right edge sticks out of the viewport and that are not inside a scroll container.
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
      }
      return false;
    };
    const culprits = Array.from(document.body.querySelectorAll("*"))
      .filter((el) => el.getBoundingClientRect().right > cw + 1 && !inScroller(el))
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String(el.className).split(" ").slice(0, 3).join(".")} right=${Math.round(el.getBoundingClientRect().right)}`);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: cw, culprits };
  });
  expect(scrollWidth, `horizontal overflow on ${page.url()}: ${culprits.join(" | ")}`).toBeLessThanOrEqual(clientWidth + 1);
}

/** Future date at Dubai local time, as YYYY-MM-DD, `daysAhead` days from today. */
export function dubaiDate(daysAhead: number) {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(d);
}
