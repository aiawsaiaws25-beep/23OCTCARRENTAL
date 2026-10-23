import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";
import { NavLink } from "./nav-link";
import { UserNav } from "./user-nav";

const links = [
  { href: "/search", label: "Find a car" },
  { href: "/branches", label: "Branches" },
  { href: "/my-rentals", label: "My rentals" },
];

export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <div className="relative mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <NavLink key={l.href} href={l.href}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Suspense fallback={<Skeleton className="h-9 w-40" />}>
            <UserNav variant="desktop" />
          </Suspense>
        </div>
        <MobileMenu>
          {links.map((l) => (
            <NavLink key={l.href} href={l.href} className="py-3 text-base">
              {l.label}
            </NavLink>
          ))}
          <div className="mt-2 border-t border-line pt-3">
            <Suspense fallback={<Skeleton className="h-10 w-full" />}>
              <UserNav variant="mobile" />
            </Suspense>
          </div>
        </MobileMenu>
      </div>
    </header>
  );
}
