// Q13: desktop + mobile layouts. Runs in every project (desktop + Pixel 7 + iPhone 14).
import { expect, expectNoHorizontalOverflow, test } from "./fixtures";

const PUBLIC_PAGES = ["/", "/login", "/register", "/branches"];

test.describe("layout", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} renders without horizontal overflow`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status(), path).toBeLessThan(400);
      await expect(page.locator("header").first()).toBeVisible();
      await expect(page.locator("footer").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test("search results page has no horizontal overflow", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /search/i }).first().click();
    await page.waitForURL(/search|vehicles/);
    await expectNoHorizontalOverflow(page);
  });

  test("navigation is usable", async ({ page, isMobile }) => {
    await page.goto("/");
    if (isMobile) {
      const toggle = page.getByRole("button", { name: /menu|navigation/i }).first();
      await expect(toggle).toBeVisible();
      await toggle.click();
    }
    const login = page.getByRole("link", { name: /log ?in|sign ?in/i }).first();
    await expect(login).toBeVisible();
    await login.click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("logged-in pages have no horizontal overflow", async ({ customer }) => {
    for (const path of ["/my-rentals", "/profile"]) {
      await customer.page.goto(path);
      await expectNoHorizontalOverflow(customer.page);
    }
  });

  test("admin pages have no horizontal overflow", async ({ admin }) => {
    for (const path of ["/admin", "/admin/fleet", "/admin/reservations", "/admin/pricing"]) {
      await admin.page.goto(path);
      await expectNoHorizontalOverflow(admin.page);
    }
  });

  test("unknown routes show a not-found page, not a crash", async ({ page }) => {
    const res = await page.goto("/this-page-does-not-exist-qa");
    expect(res?.status()).toBe(404);
    await expect(page.getByText(/not found|404/i).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
