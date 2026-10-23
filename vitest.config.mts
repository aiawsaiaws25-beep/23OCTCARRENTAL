import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Later files win, matching Next.js precedence for the test environment.
const envFiles = [".env", ".env.local", ".env.test", ".env.test.local"];
const env = Object.assign({}, ...envFiles.filter(existsSync).map((f) => parseEnv(readFileSync(f, "utf8"))));

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    env,
  },
});
