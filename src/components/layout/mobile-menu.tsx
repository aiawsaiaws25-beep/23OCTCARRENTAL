"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Hamburger disclosure for small screens. Closes on navigation and Escape. */
export function MobileMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-11 items-center justify-center rounded-lg text-ink hover:bg-canvas"
      >
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      <div
        id={id}
        hidden={!open}
        className="absolute inset-x-0 top-full z-40 border-b border-line bg-white px-4 pb-4 pt-2 shadow-lg"
      >
        <nav
          aria-label="Mobile"
          className="flex flex-col gap-1"
          // Close after following a link (or submitting a form such as Log out).
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a,button[type=submit]")) setOpen(false);
          }}
        >
          {children}
        </nav>
      </div>
    </div>
  );
}
