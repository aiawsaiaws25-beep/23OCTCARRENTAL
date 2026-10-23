// Minimal structured JSON logger: one JSON object per line on stdout/stderr,
// which Vercel and most log pipelines parse natively. Values under secret-looking
// keys (password, token, secret, authorization, cookie, signature...) are redacted.
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|signature/i;

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "warn" : "info")) as Level | "silent";
  return ORDER[lvl] ?? ORDER.info;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    const out: Record<string, unknown> = { name: value.name, message: value.message, stack: value.stack };
    const code = (value as { code?: unknown }).code;
    if (code !== undefined) out.code = code;
    if (value.cause !== undefined && depth < 3) out.cause = sanitize(value.cause, depth + 1);
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return depth > 4 ? "[array]" : value.map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    if (depth > 4) return "[object]";
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : sanitize(v, depth + 1)]),
    );
  }
  return value;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>, bindings?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg,
    ...(sanitize({ ...bindings, ...fields }) as Record<string, unknown>),
  });
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export type Logger = {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
};

function make(bindings?: Record<string, unknown>): Logger {
  return {
    debug: (m, f) => write("debug", m, f, bindings),
    info: (m, f) => write("info", m, f, bindings),
    warn: (m, f) => write("warn", m, f, bindings),
    error: (m, f) => write("error", m, f, bindings),
    child: (b) => make({ ...bindings, ...b }),
  };
}

export const logger: Logger = make({ service: "driveeasy" });
