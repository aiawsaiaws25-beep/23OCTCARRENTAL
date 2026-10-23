import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

const env = getEnv();

const pool = new Pool({
  connectionString: env.NODE_ENV === "test" ? (env.TEST_DATABASE_URL ?? env.DATABASE_URL) : env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
export { pool };
