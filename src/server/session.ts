import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { UserRole } from "@/db/schema";
import { auth } from "@/lib/auth";
import { DomainError } from "./errors";

export type CurrentUser = { id: string; name: string; email: string; role: UserRole; phone: string | null };

/**
 * The signed-in user, or null. Never throws for logged-out visitors.
 * Reads cookies, so with Cache Components call it inside <Suspense>.
 * Route Handlers may pass `request.headers`.
 */
export async function getCurrentUser(requestHeaders?: Headers): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: requestHeaders ?? (await headers()) });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: string | null; phone?: string | null };
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role === "ADMIN" ? "ADMIN" : "CUSTOMER",
    phone: u.phone ?? null,
  };
}

const loginUrl = (nextPath?: string) => (nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");

/** Server Components / Server Actions: redirects to /login?next=... when signed out. */
export async function requireUser(nextPath?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(nextPath));
  return user;
}

/** Signed out -> redirect to login; signed in but not ADMIN -> notFound() (admin area stays hidden). */
export async function requireAdmin(nextPath?: string): Promise<CurrentUser> {
  const user = await requireUser(nextPath);
  if (user.role !== "ADMIN") notFound();
  return user;
}

/** For services: throws a DomainError instead of redirecting. */
export function assertAdmin(user: { role: UserRole } | null | undefined): void {
  if (!user) throw new DomainError("unauthenticated", "Please sign in.");
  if (user.role !== "ADMIN") throw new DomainError("forbidden", "Admins only.");
}
