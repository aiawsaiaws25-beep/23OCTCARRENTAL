"use client";

import { useActionState } from "react";
import type { CancelState } from "@/app/my-rentals/[id]/actions";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";

export function CancelForm({
  action,
  label,
}: {
  action: (state: CancelState, formData: FormData) => Promise<CancelState>;
  label: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      {state.message ? (
        <Alert tone={state.ok ? "success" : "error"} testId={state.ok ? "cancel-success" : "cancel-error"}>
          {state.message}
        </Alert>
      ) : null}
      {!state.ok ? (
        <SubmitButton variant="danger" pendingLabel="Cancelling…">
          {label}
        </SubmitButton>
      ) : null}
    </form>
  );
}
