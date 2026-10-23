"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import type { AuthFormState } from "@/components/auth-forms";
import { safeNext } from "@/components/safe-next";
import { auth } from "@/lib/auth";

const loginSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name.").max(100),
    email: z.email("Enter a valid email address."),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number.")
      .optional()
      .or(z.literal("")),
    password: z.string().min(8, "Password must be at least 8 characters.").max(128),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

function message(err: unknown, fallback: string): string {
  if (isAPIError(err)) {
    const body = err.body as { message?: string; code?: string } | undefined;
    if (body?.code === "INVALID_EMAIL_OR_PASSWORD") return "Incorrect email or password.";
    if (body?.code === "USER_ALREADY_EXISTS" || body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL")
      return "An account with this email already exists. Log in instead.";
    if (body?.message) return body.message;
  }
  return fallback;
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const raw = { email: String(formData.get("email") ?? "").trim(), password: String(formData.get("password") ?? "") };
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values: { email: raw.email } };
  }
  try {
    await auth.api.signInEmail({ body: parsed.data, headers: await headers() });
  } catch (err) {
    if (!isAPIError(err)) throw err;
    return { error: message(err, "We couldn't log you in. Please try again."), values: { email: raw.email } };
  }
  redirect(safeNext(formData.get("next"), "/my-rentals"));
}

export async function registerAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? "").trim(),
    phone: String(formData.get("phone") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  };
  const values = { name: raw.name, email: raw.email, phone: raw.phone };
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }
  try {
    await auth.api.signUpEmail({
      body: {
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
        ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
      },
      headers: await headers(),
    });
  } catch (err) {
    if (!isAPIError(err)) throw err;
    return { error: message(err, "We couldn't create your account. Please try again."), values };
  }
  redirect(safeNext(formData.get("next"), "/my-rentals"));
}

export async function logoutAction(): Promise<void> {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch (err) {
    if (!isAPIError(err)) throw err;
  }
  redirect("/");
}
