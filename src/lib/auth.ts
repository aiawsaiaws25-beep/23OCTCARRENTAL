import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import { accounts, sessions, users, verifications } from "@/db/schema";
import { getEnv } from "@/lib/env";

const env = getEnv();

const devOrigins =
  env.NODE_ENV === "production" ? [] : ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://localhost:3005"];

// Email + password auth stored in Postgres. Better Auth's models are mapped onto
// our plural tables (users, sessions, accounts, verifications) with uuid ids.
// `role` can never be set by sign-up input (input: false); admins are created by
// the seed or promoted in the DB.
export const auth = betterAuth({
  appName: "DriveEasy",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [...new Set([env.APP_URL, env.BETTER_AUTH_URL, ...devOrigins])],
  database: drizzleAdapter(db, { provider: "pg", schema: { users, sessions, accounts, verifications } }),
  advanced: { database: { generateId: "uuid" } },
  user: {
    modelName: "users",
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "CUSTOMER", input: false },
      phone: { type: "string", required: false, input: true },
    },
  },
  session: { modelName: "sessions", expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  account: { modelName: "accounts" },
  verification: { modelName: "verifications" },
  emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
  // Must be last: lets auth.api.* calls from Server Actions set cookies.
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
