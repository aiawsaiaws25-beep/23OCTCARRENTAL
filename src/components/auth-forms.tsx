"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export type AuthFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "phone" | "password" | "confirmPassword", string[]>>;
  values?: { name?: string; email?: string; phone?: string };
};

type Action = (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;

export function LoginForm({ action, next }: { action: Action; next?: string }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field id="email" label="Email" error={state.fieldErrors?.email} required>
        {(p) => (
          <Input {...p} name="email" type="email" autoComplete="email" defaultValue={state.values?.email} />
        )}
      </Field>
      <Field id="password" label="Password" error={state.fieldErrors?.password} required>
        {(p) => <Input {...p} name="password" type="password" autoComplete="current-password" />}
      </Field>
      <SubmitButton className="w-full" pendingLabel="Logging in…">
        Log in
      </SubmitButton>
      <p className="text-center text-sm text-muted">
        New to DriveEasy?{" "}
        <Link
          href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}
          className="font-medium text-brand-700 underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({ action, next }: { action: Action; next?: string }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Field id="name" label="Name" error={state.fieldErrors?.name} required>
        {(p) => <Input {...p} name="name" autoComplete="name" defaultValue={state.values?.name} />}
      </Field>
      <Field id="email" label="Email" error={state.fieldErrors?.email} required>
        {(p) => (
          <Input {...p} name="email" type="email" autoComplete="email" defaultValue={state.values?.email} />
        )}
      </Field>
      <Field id="phone" label="Mobile number" hint="Optional. For example +971 50 123 4567" error={state.fieldErrors?.phone}>
        {(p) => <Input {...p} name="phone" type="tel" autoComplete="tel" defaultValue={state.values?.phone} />}
      </Field>
      <Field id="password" label="Password" hint="At least 8 characters" error={state.fieldErrors?.password} required>
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" />}
      </Field>
      <Field id="confirmPassword" label="Confirm password" error={state.fieldErrors?.confirmPassword} required>
        {(p) => <Input {...p} name="confirmPassword" type="password" autoComplete="new-password" />}
      </Field>
      <SubmitButton className="w-full" pendingLabel="Creating account…">
        Sign up
      </SubmitButton>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="font-medium text-brand-700 underline"
        >
          Log in
        </Link>
      </p>
    </form>
  );
}
