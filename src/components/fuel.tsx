import { Select } from "@/components/ui/field";
import type { ComponentProps } from "react";

const LABELS = ["Empty", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8", "Full"];

/** Fuel level in eighths of a tank (0..8). */
export function fuelLabel(eighths: number | null | undefined): string {
  if (eighths == null) return "—";
  return LABELS[eighths] ?? `${eighths}/8`;
}

export function FuelSelect(props: Omit<ComponentProps<"select">, "children">) {
  return (
    <Select {...props}>
      {LABELS.map((label, i) => (
        <option key={i} value={i}>
          {label}
        </option>
      )).reverse()}
    </Select>
  );
}

export function FuelGauge({ eighths }: { eighths: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-flex h-2.5 w-24 overflow-hidden rounded-full bg-gray-200"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={8}
        aria-valuenow={eighths}
        aria-label="Fuel level"
      >
        <span className="bg-brand-600" style={{ width: `${(eighths / 8) * 100}%` }} />
      </span>
      <span className="text-sm">{fuelLabel(eighths)}</span>
    </span>
  );
}
