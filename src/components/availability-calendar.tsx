import Link from "next/link";
import { cn } from "@/components/ui/cn";

export type CalendarDayStatus = "available" | "partial" | "booked" | "maintenance";
export type CalendarDay = { date: string; status: CalendarDayStatus };

const statusLabel: Record<CalendarDayStatus, string> = {
  available: "Available",
  partial: "Partly booked",
  booked: "Booked",
  maintenance: "Unavailable (maintenance)",
};

const statusClass: Record<CalendarDayStatus, string> = {
  available: "bg-green-50 text-green-900 ring-green-200",
  partial: "bg-amber-50 text-amber-900 ring-amber-300",
  booked: "bg-red-50 text-red-900 ring-red-200 line-through decoration-red-400",
  maintenance: "bg-gray-100 text-gray-600 ring-gray-200 line-through",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseYmd(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

/** Weekday index (Mon = 0) of a civil date. Pure arithmetic, no time zone involved. */
function weekdayMon0(ymd: string) {
  const { y, m, d } = parseYmd(ymd);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function monthTitle(ym: string) {
  const { y, m } = parseYmd(`${ym}-01`);
  return new Intl.DateTimeFormat("en-AE", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

/**
 * Month grids for a vehicle's availability. `days` comes from the server (branch time zone);
 * this component only lays them out. Grouped by month, Monday-first.
 */
export function AvailabilityCalendar({
  days,
  prevHref,
  nextHref,
  caption,
}: {
  days: CalendarDay[];
  prevHref?: string | null;
  nextHref?: string | null;
  caption?: string;
}) {
  const months = new Map<string, CalendarDay[]>();
  for (const day of days) {
    const key = day.date.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key)!.push(day);
  }

  return (
    <section aria-label="Availability calendar" data-testid="availability-calendar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {caption ? <p className="text-sm text-muted">{caption}</p> : <span />}
        <div className="flex gap-2">
          {prevHref ? (
            <Link
              href={prevHref}
              scroll={false}
              className="rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-canvas"
            >
              <span aria-hidden="true">←</span> Earlier
            </Link>
          ) : null}
          {nextHref ? (
            <Link
              href={nextHref}
              scroll={false}
              className="rounded-md border border-line bg-white px-3 py-1.5 text-sm hover:bg-canvas"
            >
              Later <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </div>
      </div>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        {[...months.entries()].map(([ym, monthDays]) => {
          const lead = weekdayMon0(monthDays[0].date);
          return (
            <div key={ym}>
              <h3 className="mb-2 text-sm font-semibold">{monthTitle(ym)}</h3>
              <div role="grid" aria-label={monthTitle(ym)} className="grid grid-cols-7 gap-1 text-center text-xs">
                <div role="row" className="contents">
                  {WEEKDAYS.map((w) => (
                    <div role="columnheader" key={w} className="py-1 font-medium text-muted">
                      <abbr title={w} className="no-underline">
                        {w.slice(0, 2)}
                      </abbr>
                    </div>
                  ))}
                </div>
                <div role="row" className="contents">
                  {Array.from({ length: lead }, (_, i) => (
                    <div key={`lead-${i}`} role="gridcell" aria-hidden="true" />
                  ))}
                  {monthDays.map((day) => {
                    const { d } = parseYmd(day.date);
                    return (
                      <div
                        key={day.date}
                        role="gridcell"
                        data-testid="calendar-day"
                        data-date={day.date}
                        data-status={day.status}
                        data-available={day.status === "available" ? "true" : "false"}
                        aria-label={`${day.date}: ${statusLabel[day.status]}`}
                        title={statusLabel[day.status]}
                        className={cn("rounded-md py-2 font-medium ring-1 ring-inset", statusClass[day.status])}
                      >
                        {d}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <ul className="mt-4 flex flex-wrap gap-4 text-xs text-muted" aria-label="Legend">
        {(Object.keys(statusLabel) as CalendarDayStatus[]).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("inline-block size-3 rounded ring-1 ring-inset", statusClass[s])} />
            {statusLabel[s]}
          </li>
        ))}
      </ul>
    </section>
  );
}
