"use client";

import Form from "next/form";
import { useState } from "react";
import type { BranchOption } from "@/components/search-form";
import { buttonClass } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";

/** Date/time selection for a specific vehicle. Pick-up branch is fixed to the car's branch. */
export function TripDatesForm({
  action,
  pickupBranch,
  branches,
  minDate,
  defaults,
}: {
  action: string;
  pickupBranch: BranchOption;
  branches: BranchOption[];
  minDate: string;
  defaults: { returnBranch: string; pickupDate: string; pickupTime: string; returnDate: string; returnTime: string };
}) {
  const [pickupDate, setPickupDate] = useState(defaults.pickupDate);
  return (
    <Form action={action} className="space-y-5" aria-label="Choose rental dates">
      <input type="hidden" name="pickupBranch" value={pickupBranch.code} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">Pick-up branch</span>
          <p className="flex h-11 items-center rounded-lg border border-line bg-canvas px-3 text-sm">
            {pickupBranch.name} ({pickupBranch.city})
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="returnBranch">Return branch</Label>
          <Select id="returnBranch" name="returnBranch" defaultValue={defaults.returnBranch} required>
            {branches.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name} ({b.city}){b.code === pickupBranch.code ? " - same branch" : ""}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="grid grid-cols-[1fr_8.5rem] gap-2">
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
            <Label htmlFor="pickupTime">Pick-up time</Label>
            <Input id="pickupTime" name="pickupTime" type="time" step={1800} required defaultValue={defaults.pickupTime} />
          </div>
        </fieldset>
        <fieldset className="grid grid-cols-[1fr_8.5rem] gap-2">
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
            <Label htmlFor="returnTime">Return time</Label>
            <Input id="returnTime" name="returnTime" type="time" step={1800} required defaultValue={defaults.returnTime} />
          </div>
        </fieldset>
      </div>
      <p className="text-xs text-muted">Times are local UAE time. A rental day is each started 24 hours.</p>
      <button type="submit" className={buttonClass("primary", "lg", "w-full sm:w-auto")}>
        Check availability and price
      </button>
    </Form>
  );
}
