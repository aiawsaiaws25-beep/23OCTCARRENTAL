"use client";

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import type { ButtonVariant } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

export type ActionState = {
  ok?: boolean;
  message?: string;
  /** Field name -> messages, shown as a list under the form-level message. */
  fieldErrors?: Record<string, string[] | undefined>;
};

export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Generic form bound to a Server Action that returns ActionState.
 * Children are the (server-rendered) fields; result messages render above the submit button.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  variant = "primary",
  className = "space-y-4",
  resetOnSuccess = false,
  testId,
  submitClassName,
}: {
  action: FormAction;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  className?: string;
  resetOnSuccess?: boolean;
  testId?: string;
  submitClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  const fieldMessages = Object.entries(state.fieldErrors ?? {}).flatMap(([, msgs]) => msgs ?? []);

  return (
    <form
      ref={formRef}
      action={formAction}
      // Submit via a transition so React does not auto-reset the fields (keeps input on validation errors).
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className={className}
      data-testid={testId}
    >
      {children}
      {state.message || fieldMessages.length ? (
        <Alert tone={state.ok ? "success" : "error"} testId={state.ok ? "form-success" : "form-error"}>
          {state.message}
          {fieldMessages.length ? (
            <ul className="mt-1 list-disc pl-5">
              {fieldMessages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      <SubmitButton variant={variant} pendingLabel={pendingLabel} className={submitClassName} pending={pending}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
