"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./button";
import { Spinner } from "./spinner";

type Props = Omit<ComponentProps<"button">, "type"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pendingLabel?: string;
  /** Override for forms submitted via startTransition (useFormStatus does not see those). */
  pending?: boolean;
};

/** Submit button that shows a spinner and disables itself while its form's action runs. */
export function SubmitButton({ variant, size, className, children, pendingLabel, disabled, pending: pendingProp, ...props }: Props) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <button
      type="submit"
      className={buttonClass(variant, size, className)}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? (
        <>
          <Spinner className="size-4" />
          <span>{pendingLabel ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
