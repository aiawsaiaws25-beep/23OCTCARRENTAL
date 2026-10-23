import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const control =
  "block w-full rounded-lg border border-gray-400 bg-white px-3 text-ink shadow-sm placeholder:text-gray-500 " +
  "focus:border-brand-600 focus:outline-2 focus:outline-offset-0 focus:outline-brand-600 " +
  "disabled:cursor-not-allowed disabled:bg-gray-100 aria-invalid:border-red-700";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-11 text-sm", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "h-11 pr-8 text-sm", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-2 text-sm", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("block text-sm font-medium text-ink", className)} {...props} />;
}

/**
 * Label + control + hint + error, wired with aria-describedby / aria-invalid.
 * Pass the control as a render function so it receives the right ids.
 */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
  required,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | string[];
  className?: string;
  required?: boolean;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: true;
    required?: boolean;
  }) => ReactNode;
}) {
  const errorText = Array.isArray(error) ? error[0] : error;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errorText ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      {/* Required fields are the default; optional ones say so in their hint. Keeping the label
          text exact gives inputs clean accessible names. */}
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": errorText ? true : undefined,
        required: required || undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {errorText ? (
        <p id={errorId} className="text-xs font-medium text-red-700">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}

export function Fieldset({ legend, children, className }: { legend: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn("space-y-3", className)}>
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
      {children}
    </fieldset>
  );
}
