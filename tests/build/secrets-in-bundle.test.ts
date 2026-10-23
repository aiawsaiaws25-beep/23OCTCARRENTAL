// Q12: after `pnpm build`, no secret value from .env.local may appear in files
// served to the browser (.next/static). Values are never printed — only the
// variable name and file are reported.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { ROOT } from "../helpers/db";

const STATIC = join(ROOT, ".next", "static");
const isProdBuild = existsSync(join(ROOT, ".next", "BUILD_ID"));

const SECRET_KEYS = /SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL/i;

function secrets(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    for (const [k, v] of Object.entries(parseEnv(readFileSync(p, "utf8")))) {
      if (k.startsWith("NEXT_PUBLIC_")) continue;
      if (SECRET_KEYS.test(k) && v && v.length >= 8) out[k] = v;
    }
  }
  // DB passwords on their own, in case the URL is split up somewhere.
  for (const k of ["DATABASE_URL", "TEST_DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
    if (!out[k]) continue;
    try {
      const pw = decodeURIComponent(new URL(out[k]).password);
      if (pw.length >= 6) out[`${k} (password)`] = pw;
    } catch {}
  }
  return out;
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

describe.runIf(isProdBuild && existsSync(STATIC))("client bundle secrets (.next/static)", () => {
  it("contains no secret values from env files", () => {
    const s = secrets();
    expect(Object.keys(s).length).toBeGreaterThan(0);
    const leaks: string[] = [];
    let files = 0;
    for (const file of walk(STATIC)) {
      files++;
      const text = readFileSync(file, "latin1");
      for (const [k, v] of Object.entries(s)) if (text.includes(v)) leaks.push(`${k} in ${file.slice(ROOT.length)}`);
    }
    expect(files).toBeGreaterThan(0);
    expect(leaks).toEqual([]);
  });
});

describe("public folder", () => {
  it("contains no uploaded files (licences/damage photos are private)", () => {
    const pub = join(ROOT, "public");
    const bad = existsSync(pub)
      ? [...walk(pub)].filter((f) => /uploads|licen[cs]e|damage|\.(pdf|heic)$/i.test(f.slice(pub.length)))
      : [];
    expect(bad).toEqual([]);
  });

  it("UPLOADS_DIR is outside public/", () => {
    const dir = process.env.UPLOADS_DIR ?? "./uploads";
    expect(join(ROOT, dir).startsWith(join(ROOT, "public"))).toBe(false);
  });
});
