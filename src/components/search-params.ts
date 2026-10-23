import { z } from "zod";
import { DEFAULT_TIME_ZONE } from "./format";

// Parsing of the shared trip query string: ?pickupBranch&returnBranch&pickupDate&pickupTime&returnDate&returnTime
// Used by /search, /vehicles/[id], /book/[vehicleId]. The server services validate again.

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const tripSchema = z.object({
  pickupBranch: z.string().regex(/^[A-Z0-9]{2,10}$/),
  returnBranch: z.string().regex(/^[A-Z0-9]{2,10}$/),
  pickupDate: ymd,
  pickupTime: hm,
  returnDate: ymd,
  returnTime: hm,
});

export type TripParams = z.infer<typeof tripSchema>;

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Returns the parsed trip, or null when any part is missing/malformed. */
export function parseTrip(sp: RawSearchParams): TripParams | null {
  const raw = {
    pickupBranch: first(sp.pickupBranch)?.toUpperCase(),
    returnBranch: (first(sp.returnBranch) || first(sp.pickupBranch))?.toUpperCase(),
    pickupDate: first(sp.pickupDate),
    pickupTime: first(sp.pickupTime),
    returnDate: first(sp.returnDate),
    returnTime: first(sp.returnTime),
  };
  const parsed = tripSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function tripQuery(trip: TripParams, extra?: Record<string, string | undefined>): string {
  const params = new URLSearchParams(trip);
  for (const [k, v] of Object.entries(extra ?? {})) if (v) params.set(k, v);
  return params.toString();
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - instant.getTime();
}

/** Converts a wall-clock date + time in `timeZone` (default Asia/Dubai) to a UTC Date. */
export function zonedToUtc(date: string, time: string, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = zoneOffsetMs(new Date(guess), timeZone);
  const result = new Date(guess - offset);
  // Re-check once in case the offset differs at the result (DST edges; not relevant for Asia/Dubai).
  const offset2 = zoneOffsetMs(result, timeZone);
  return offset2 === offset ? result : new Date(guess - offset2);
}

/** Today's civil date (YYYY-MM-DD) in a zone. */
export function todayIn(timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(ymdStr: string, days: number): string {
  const [y, m, d] = ymdStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Current time. Only call from request-time code (after `connection()` or in Server Actions). */
export const nowMs = () => Date.now();
