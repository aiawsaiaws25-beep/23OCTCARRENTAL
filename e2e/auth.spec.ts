// Q2: registration, login, logout and authorization (UI + server-side checks).
import { PASSWORD, e2eDb, expect, signUp, test, uniqueEmail } from "./fixtures";

test.describe("auth", () => {
  test("register through the UI lands signed in", async ({ page }) => {
    const email = uniqueEmail("reg");
    await page.goto("/register");
    await page.getByLabel(/name/i).first().fill("QA Register");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password/i).first().fill(PASSWORD);
    const confirm = page.getByLabel(/confirm/i);
    if (await confirm.count()) await confirm.fill(PASSWORD);
    await page.getByRole("button", { name: /sign up|register|create account/i }).click();
    await expect(page).not.toHaveURL(/\/register/);
    await expect(page.getByRole("button", { name: /log ?out|sign ?out/i }).or(page.getByRole("link", { name: /my rentals|account|profile/i })).first()).toBeVisible();
  });

  test("registration rejects a duplicate email", async ({ page, baseURL }) => {
    const email = uniqueEmail("dup");
    await signUp(page.request, baseURL!, { email, password: PASSWORD, name: "Dup" });
    await page.context().clearCookies();
    await page.goto("/register");
    await page.getByLabel(/name/i).first().fill("Dup Again");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password/i).first().fill(PASSWORD);
    const confirm = page.getByLabel(/confirm/i);
    if (await confirm.count()) await confirm.fill(PASSWORD);
    await page.getByRole("button", { name: /sign up|register|create account/i }).click();
    await expect(page.getByRole("alert").or(page.getByText(/already|exists|in use/i)).first()).toBeVisible();
  });

  test("login with wrong password shows an error and no session", async ({ page, baseURL }) => {
    const email = uniqueEmail("badpw");
    await signUp(page.request, baseURL!, { email, password: PASSWORD, name: "Bad PW" });
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill("wrong-password-123");
    await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
    await expect(page.getByRole("alert").or(page.getByText(/invalid|incorrect|wrong/i)).first()).toBeVisible();
    const session = await page.request.get("/api/auth/get-session");
    expect(await session.text()).not.toContain(email);
  });

  test("login then logout through the UI", async ({ page, baseURL }) => {
    const email = uniqueEmail("inout");
    await signUp(page.request, baseURL!, { email, password: PASSWORD, name: "In Out" });
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
    expect(await (await page.request.get("/api/auth/get-session")).text()).toContain(email);

    // Logout may live inside a menu on small screens.
    const logout = page.getByRole("button", { name: /log ?out|sign ?out/i });
    if (!(await logout.first().isVisible())) {
      await page.getByRole("button", { name: /menu|account|open navigation/i }).first().click();
    }
    await logout.first().click();
    await expect.poll(async () => (await page.request.get("/api/auth/get-session")).text()).not.toContain(email);
    await page.goto("/my-rentals");
    await expect(page).toHaveURL(/\/login/);
  });

  test("sign-up cannot self-assign the ADMIN role", async ({ request, baseURL }) => {
    const email = uniqueEmail("escalate");
    const res = await request.post("/api/auth/sign-up/email", {
      data: { email, password: PASSWORD, name: "Sneaky", role: "ADMIN" },
      headers: { origin: baseURL! },
    });
    // Either rejected outright or accepted with the field ignored.
    const [row] = await e2eDb().query<{ role: string }>("select role from users where lower(email) = lower($1)", [email]);
    if (res.ok()) expect(row.role).toBe("CUSTOMER");
    else expect(row).toBeUndefined();
  });

  test("sign-up/sign-in from a foreign origin is rejected (CSRF)", async ({ request }) => {
    const res = await request.post("/api/auth/sign-up/email", {
      data: { email: uniqueEmail("csrf"), password: PASSWORD, name: "CSRF" },
      headers: { origin: "https://evil.example" },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("password shorter than 8 characters is rejected", async ({ request, baseURL }) => {
    const res = await request.post("/api/auth/sign-up/email", {
      data: { email: uniqueEmail("short"), password: "short", name: "Short" },
      headers: { origin: baseURL! },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("anonymous users are redirected from protected pages", async ({ page }) => {
    for (const path of ["/my-rentals", "/profile", "/admin"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login/);
    }
  });

  test("customers cannot open admin screens", async ({ customer }) => {
    for (const path of ["/admin", "/admin/fleet", "/admin/pricing", "/admin/reservations", "/admin/branches"]) {
      const res = await customer.page.goto(path);
      const hardDenied = /\/login/.test(customer.page.url()) || (res && [401, 403, 404].includes(res.status()));
      // With streaming (cacheComponents) notFound() inside Suspense renders the 404 UI with HTTP 200.
      const softDenied = await customer.page
        .getByRole("heading", { name: /not found/i })
        .waitFor({ timeout: 10_000 })
        .then(() => true, () => false);
      expect(hardDenied || softDenied, `${path} -> ${res?.status()} ${customer.page.url()}`).toBe(true);
      // Never any admin data in the response.
      const html = await customer.page.content();
      // Data, not navigation labels: reservation references, seeded/QA plate numbers, customer emails.
      expect(html, path).not.toMatch(/\bDE-[A-HJ-NP-Z2-9]{6}\b|QA-P[0-9A-F]{4,}|customer@driveeasy\.test/);
    }
  });

  test("admins can open the admin dashboard", async ({ admin }) => {
    const res = await admin.page.goto("/admin");
    expect(res?.status()).toBeLessThan(400);
    await expect(admin.page).toHaveURL(/\/admin/);
  });
});
