import type { Metadata } from "next";
import { Suspense } from "react";
import { NavLink } from "@/components/layout/nav-link";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | DriveEasy admin" },
  robots: { index: false, follow: false },
};

const links = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/reservations", label: "Reservations" },
  { href: "/admin/fleet", label: "Fleet" },
  { href: "/admin/branches", label: "Branches" },
  { href: "/admin/pricing", label: "Pricing" },
  { href: "/admin/damage", label: "Damage" },
];

/** The admin sub-navigation is only rendered for admins (pages enforce access themselves). */
async function AdminNav() {
  const user = await getCurrentUser();
  if (user?.role !== "ADMIN") return null;
  return (
    <div className="no-print border-b border-line bg-ink text-white">
      <nav aria-label="Admin" className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 py-2 sm:px-6">
        {links.map((l) => (
          <NavLink
            key={l.href}
            href={l.href}
            exact={l.exact}
            tone="dark"
            className="shrink-0"
            activeClassName="bg-white/15 text-white"
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

// Every admin page and Server Action calls requireAdmin() itself, so access is enforced
// on the server, not by hiding links.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<div className="h-[53px] bg-ink" aria-hidden="true" />}>
        <AdminNav />
      </Suspense>
      {children}
    </div>
  );
}
