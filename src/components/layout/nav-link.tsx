"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

const tones = {
  light: "text-gray-700 hover:bg-canvas hover:text-ink",
  dark: "text-gray-200 hover:bg-white/10 hover:text-white",
};

/** Navigation link that marks itself aria-current when its section is active. */
function ActiveNavLink({
  href,
  children,
  exact = false,
  className,
  activeClassName = "bg-brand-50 text-brand-800",
  tone = "light",
}: {
  tone?: "light" | "dark";
  href: string;
  children: ReactNode;
  exact?: boolean;
  className?: string;
  activeClassName?: string;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-2 text-sm font-medium",
        active ? activeClassName : tones[tone],
        className,
      )}
    >
      {children}
    </Link>
  );
}

type NavLinkProps = Parameters<typeof ActiveNavLink>[0];

/** usePathname() is request data, so the active-state version streams in behind Suspense. */
export function NavLink(props: NavLinkProps) {
  return (
    <Suspense
      fallback={
        <Link
          href={props.href}
          className={cn("rounded-md px-3 py-2 text-sm font-medium", tones[props.tone ?? "light"], props.className)}
        >
          {props.children}
        </Link>
      }
    >
      <ActiveNavLink {...props} />
    </Suspense>
  );
}
