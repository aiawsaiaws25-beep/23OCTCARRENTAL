import { z } from "zod";

// Every setting the app reads. Swapping a local stand-in for a cloud service
// should only ever mean changing these values (see .env.example).
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().min(1).optional(),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),

  PAYMENTS_PROVIDER: z.enum(["fake", "stripe"]).default("fake"),
  PAYMENTS_WEBHOOK_URL: z.url().default("http://localhost:3000/api/webhooks/payments"),
  PAYMENTS_WEBHOOK_SECRET: z.string().min(16),
  FAKE_PAYMENTS_STATE_FILE: z.string().default("./.local/fake-payments.json"),
  FAKE_PAYMENTS_DUPLICATE_WEBHOOKS: z.stringbool().default(false),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  UPLOADS_DIR: z.string().default("./uploads"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  CRON_SECRET: z.string().min(16),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}
