import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-gray-100 text-gray-800 ring-gray-300",
  brand: "bg-brand-50 text-brand-800 ring-brand-200",
  success: "bg-green-50 text-green-800 ring-green-300",
  warning: "bg-amber-50 text-amber-900 ring-amber-300",
  danger: "bg-red-50 text-red-800 ring-red-300",
  info: "bg-blue-50 text-blue-800 ring-blue-300",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  testId,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
