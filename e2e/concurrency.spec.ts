// Q5/Q6 end to end: two browser sessions reserve the same car at the same moment.
import { e2eDb, expect, newUserPage, test } from "./fixtures";
import { freshVehicle, q, trip, type Trip } from "./booking";

test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "race tests run once (chromium desktop)");

async function race(browser: import("@playwright/test").Browser, baseURL: string, vehicleId: string, a: Trip, b: Trip) {
  const s1 = await newUserPage(browser, baseURL);
  const s2 = await newUserPage(browser, baseURL);
  try {
    await Promise.all([s1.page.goto(`/book/${vehicleId}/extras?${q(a)}`), s2.page.goto(`/book/${vehicleId}/extras?${q(b)}`)]);
    const btn1 = s1.page.getByRole("button", { name: /continue to driver details/i });
    const btn2 = s2.page.getByRole("button", { name: /continue to driver details/i });
    await Promise.all([expect(btn1).toBeEnabled(), expect(btn2).toBeEnabled()]);
    await Promise.all([btn1.click(), btn2.click()]);
    const outcome = async (p: import("@playwright/test").Page) => {
      await Promise.race([p.waitForURL(/\/checkout\//, { timeout: 20_000 }).catch(() => {}), p.getByRole("alert").filter({ hasText: /available|booked/i }).first().waitFor({ timeout: 20_000 }).catch(() => {})]);
      return /\/checkout\//.test(p.url()) ? "won" : "lost";
    };
    const results = await Promise.all([outcome(s1.page), outcome(s2.page)]);
    return { results, s1, s2 };
  } finally {
    // contexts closed by caller after assertions
  }
}

test.describe("concurrent reservations", () => {
  for (let i = 0; i < 3; i++) {
    test(`overlapping dates from two sessions at the same time: exactly one wins (#${i + 1})`, async ({ browser, baseURL }) => {
      const v = await freshVehicle();
      const { results, s1, s2 } = await race(browser, baseURL!, v.vehicleId, trip(v.branchCode, 5, 8), trip(v.branchCode, 6, 9));
      try {
        expect(results.sort()).toEqual(["lost", "won"]);
        const loser = results[0] === "lost" ? s1.page : s2.page;
        void loser;
        const rows = await e2eDb().query<{ n: number }>(
          `select count(*)::int n from reservations where vehicle_id = $1 and status in ('PENDING','CONFIRMED','PICKED_UP')`,
          [v.vehicleId],
        );
        expect(rows[0].n).toBe(1);
      } finally {
        await s1.context.close();
        await s2.context.close();
      }
    });
  }

  test("back-to-back from two sessions at the same time: both win", async ({ browser, baseURL }) => {
    const v = await freshVehicle();
    const { results, s1, s2 } = await race(browser, baseURL!, v.vehicleId, trip(v.branchCode, 5, 7, "10:00", "10:00"), trip(v.branchCode, 7, 9, "10:00", "10:00"));
    try {
      expect(results).toEqual(["won", "won"]);
    } finally {
      await s1.context.close();
      await s2.context.close();
    }
  });

  test("the loser sees a clear 'no longer available' message", async ({ browser, baseURL }) => {
    const v = await freshVehicle();
    const t = trip(v.branchCode, 11, 12);
    const s1 = await newUserPage(browser, baseURL!);
    const s2 = await newUserPage(browser, baseURL!);
    try {
      await s1.page.goto(`/book/${v.vehicleId}/extras?${q(t)}`);
      await s2.page.goto(`/book/${v.vehicleId}/extras?${q(t)}`);
      await s1.page.getByRole("button", { name: /continue to driver details/i }).click();
      await s1.page.waitForURL(/\/checkout\//);
      await s2.page.getByRole("button", { name: /continue to driver details/i }).click();
      await expect(s2.page.getByRole("alert").filter({ hasText: /no longer available|already booked|not available/i }).first()).toBeVisible();
    } finally {
      await s1.context.close();
      await s2.context.close();
    }
  });
});
