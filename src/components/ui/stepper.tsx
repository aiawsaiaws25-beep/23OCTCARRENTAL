import { cn } from "./cn";

export const BOOKING_STEPS = ["Dates", "Extras", "Driver & payment", "Voucher"] as const;

/** Booking progress indicator. `current` is the 0-based index of the active step. */
export function Stepper({ current, steps = BOOKING_STEPS }: { current: number; steps?: readonly string[] }) {
  return (
    <nav aria-label="Booking progress" className="no-print">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        {steps.map((step, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          return (
            <li key={step} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  state === "done" && "bg-brand-600 text-white",
                  state === "current" && "bg-brand-50 text-brand-800 ring-2 ring-brand-600",
                  state === "todo" && "bg-gray-100 text-gray-700",
                )}
              >
                {state === "done" ? (
                  <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
                    <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0z" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className={cn(state === "current" ? "font-semibold text-ink" : "text-muted")}>
                {step}
                {state === "done" ? <span className="sr-only"> (completed)</span> : null}
              </span>
              {i < steps.length - 1 ? <span aria-hidden="true" className="mx-1 hidden h-px w-8 bg-line sm:block" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
