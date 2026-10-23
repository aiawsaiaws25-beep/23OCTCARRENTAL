import { z } from "zod";

// Every setting the app reads. Swapping a local stand-in for a cloud service
// should only ever mean changing these values (see .env.example).
// Server-only: never import this from client components.
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),

    // Pooled URL used by the running app (Neon: the pooled "-pooler" host).
    DATABASE_URL: z.string().min(1),
    // Direct URL used only for migrations (Neon: DATABASE_URL_UNPOOLED). Optional locally.
    DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
    TEST_DATABASE_URL: z.string().min(1).optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url().default("http://localhost:3000"),

    PAYMENTS_PROVIDER: z.enum(["fake", "stripe"]).default("fake"),
    PAYMENTS_WEBHOOK_URL: z.url().default("http://localhost:3000/api/webhooks/payments"),
    PAYMENTS_WEBHOOK_SECRET: z.string().min(16).optional(),
    FAKE_PAYMENTS_STATE_FILE: z.string().default("./.local/fake-payments.json"),
    FAKE_PAYMENTS_DUPLICATE_WEBHOOKS: z.stringbool().default(false),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    STORAGE_PROVIDER: z.enum(["local", "vercel-blob"]).default("local"),
    UPLOADS_DIR: z.string().default("./uploads"),
    BLOB_READ_WRITE_TOKEN: z.string().optional(),

    CRON_SECRET: z.string().min(16),
    // HMAC key for voucher QR codes; falls back to BETTER_AUTH_SECRET.
    VOUCHER_SECRET: z.string().min(16).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENTS_PROVIDER === "fake" && !env.PAYMENTS_WEBHOOK_SECRET) {
      ctx.addIssue({ code: "custom", path: ["PAYMENTS_WEBHOOK_SECRET"], message: "Required when PAYMENTS_PROVIDER=fake" });
    }
    if (env.PAYMENTS_PROVIDER === "stripe") {
      for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: "Required when PAYMENTS_PROVIDER=stripe" });
      }
      if (env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.startsWith("sk_test_") && env.NODE_ENV !== "production") {
        ctx.addIssue({ code: "custom", path: ["STRIPE_SECRET_KEY"], message: "Use a Stripe test-mode key (sk_test_...) outside production" });
      }
    }
    if (env.STORAGE_PROVIDER === "vercel-blob" && !env.BLOB_READ_WRITE_TOKEN) {
      ctx.addIssue({ code: "custom", path: ["BLOB_READ_WRITE_TOKEN"], message: "Required when STORAGE_PROVIDER=vercel-blob" });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  // Empty values (e.g. `STRIPE_SECRET_KEY=` copied from .env.example) count as unset.
  cached ??= envSchema.parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")));
  return cached;
}

/** For tests: forget the parsed env so changed process.env values are picked up. */
export function resetEnvCache(): void {
  cached = undefined;
}
