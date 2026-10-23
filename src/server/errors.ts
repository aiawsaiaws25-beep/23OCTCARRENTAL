// Typed domain errors and the discriminated result type returned to the UI.
// Services throw DomainError for expected failures; public entry points wrap
// them with `toResult()` so callers get { ok: false, code, message } instead.
// Anything else is a bug and is re-thrown (and logged).
import { logger } from "./logger";

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "invalid_range"
  | "branch_closed"
  | "unavailable" // vehicle no longer available for the requested period
  | "hold_expired"
  | "invalid_state"
  | "not_eligible"
  | "payment_failed"
  | "deposit_failed"
  | "conflict";

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class VehicleUnavailableError extends DomainError {
  constructor(message = "This vehicle is no longer available for the selected dates.") {
    super("unavailable", message);
    this.name = "VehicleUnavailableError";
  }
}

export type Fail = { ok: false; code: ErrorCode; message: string; details?: Record<string, unknown> };
export type Result<T extends object = object> = ({ ok: true } & T) | Fail;

export function fail(code: ErrorCode, message: string, details?: Record<string, unknown>): Fail {
  return details ? { ok: false, code, message, details } : { ok: false, code, message };
}

function walk<T>(err: unknown, pick: (e: Record<string, unknown>) => T | undefined): T | undefined {
  let e: unknown = err;
  for (let i = 0; i < 4 && e && typeof e === "object"; i++) {
    const v = pick(e as Record<string, unknown>);
    if (v !== undefined) return v;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** PostgreSQL SQLSTATE of an error thrown by pg (possibly wrapped by Drizzle). */
export const pgCode = (err: unknown) =>
  walk(err, (e) => (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : undefined));
export const pgConstraint = (err: unknown) => walk(err, (e) => (typeof e.constraint === "string" ? e.constraint : undefined));

/** 23P01 = exclusion_violation: the overlap constraint fired. */
export const isExclusionViolation = (err: unknown) => pgCode(err) === "23P01";
export const isUniqueViolation = (err: unknown) => pgCode(err) === "23505";

/** Maps DB-level errors to domain errors; returns the original error otherwise. */
export function mapDbError(err: unknown): unknown {
  if (err instanceof DomainError) return err;
  if (isExclusionViolation(err)) return new VehicleUnavailableError();
  // 22P02 invalid uuid/number text, 22007/22008 invalid date/time: bad identifiers or dates from user input.
  if (pgCode(err) === "22P02") return new DomainError("not_found", "Not found.");
  if (pgCode(err) === "22007" || pgCode(err) === "22008") return new DomainError("validation", "Invalid date.");
  if (pgCode(err) === "23514") {
    return new DomainError("validation", "The data violates a validation rule.", { constraint: pgConstraint(err) });
  }
  return err;
}

export async function toResult<T extends object>(fn: () => Promise<T>, context?: string): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (raw) {
    const err = mapDbError(raw);
    if (err instanceof DomainError) return fail(err.code, err.message, err.details);
    logger.error("unexpected error", { context, err: raw });
    throw raw;
  }
}
