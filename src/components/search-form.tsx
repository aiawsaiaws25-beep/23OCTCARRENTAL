"use client";

import Form from "next/form";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input, Label, Select } from "@/components/ui/field";

export type BranchOption = { code: string; name: string; city: string };

export type SearchDefaults = {
  pickupBranch?: string;
  returnBranch?: string;
  pickupDate?: string;
  pickupTime?: string;
  returnDate?: string;
  returnTime?: string;
};

/**
 * Pick-up/return branch + date/time search. Submits a plain GET to /search so it works
 * without JavaScript; the server validates everything again.
 */
export function SearchForm({
  branches,
  defaults,
  minDate,
  layout = "hero",
  hidden,
}: {
  branches: BranchOption[];
  defaults: SearchDefaults;
  /** Today's date in UAE time, from the server (YYYY-MM-DD). */
  minDate: string;
  layout?: "hero" | "compact" | "stacked";
  /** Extra params (filters) to carry along when re-searching. */
  hidden?: Record<string, string>;
}) {
  const [differentReturn, setDifferentReturn] = useState(
    Boolean(defaults.returnBranch && defaults.returnBranch !== defaults.pickupBranch),
  );
  const [pickupDate, setPickupDate] = useState(defaults.pickupDate ?? "");
  const [pickupBranch, setPickupBranch] = useState(defaults.pickupBranch ?? branches[0]?.code ?? "");

  const compact = layout === "compact";

  return (
    <Form
      action="/search"
      role="search"
      aria-label="Search cars"
      className={cn(
        "grid gap-4",
        layout === "stacked"
          ? "sm:grid-cols-2"
          : compact
            ? "md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-end"
            : "lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-end",
      )}
    >
      {hidden
        ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)
        : null}
      <div className={cn("space-y-3", layout === "stacked" && "sm:col-span-2")}>
        <div className="space-y-1.5">
          <Label htmlFor="pickupBranch">Pick-up branch</Label>
          <Select
            id="pickupBranch"
            name="pickupBranch"
            required
            value={pickupBranch}
            onChange={(e) => setPickupBranch(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name} ({b.city})
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="size-4 rounded border-gray-400 accent-brand-600"
            checked={differentReturn}
            onChange={(e) => setDifferentReturn(e.target.checked)}
          />
          Return to a different branch
        </label>
        {differentReturn ? (
          <div className="space-y-1.5">
            <Label htmlFor="returnBranch">Return branch</Label>
            <Select id="returnBranch" name="returnBranch" required defaultValue={defaults.returnBranch ?? pickupBranch}>
              {branches.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name} ({b.city})
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <input type="hidden" name="returnBranch" value={pickupBranch} />
        )}
      </div>

      <fieldset className="grid grid-cols-[1fr_8.5rem] gap-2 self-start">
        <legend className="sr-only">Pick-up date and time</legend>
        <div className="space-y-1.5">
          <Label htmlFor="pickupDate">Pick-up date</Label>
          <Input
            id="pickupDate"
            name="pickupDate"
            type="date"
            required
            min={minDate}
            value={pickupDate}
            onChange={(e) => setPickupDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pickupTime">Time</Label>
          <Input id="pickupTime" name="pickupTime" type="time" step={1800} required defaultValue={defaults.pickupTime ?? "10:00"} />
        </div>
      </fieldset>

      <fieldset className="grid grid-cols-[1fr_8.5rem] gap-2 self-start">
        <legend className="sr-only">Return date and time</legend>
        <div className="space-y-1.5">
          <Label htmlFor="returnDate">Return date</Label>
          <Input
            id="returnDate"
            name="returnDate"
            type="date"
            required
            min={pickupDate || minDate}
            defaultValue={defaults.returnDate}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="returnTime">Time</Label>
          <Input id="returnTime" name="returnTime" type="time" step={1800} required defaultValue={defaults.returnTime ?? "10:00"} />
        </div>
      </fieldset>

      <button type="submit" className={buttonClass(
          "primary",
          "lg",
          cn("self-start", layout === "stacked" ? "sm:col-span-2" : compact ? "md:mt-6" : "lg:mt-6"),
        )}>
        Search cars
      </button>
    </Form>
  );
}
