"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass } from "./button";

/** Shared body for error.tsx boundaries. */
export function ErrorView({
  error,
  retry,
  title = "Something went wrong",
}: {
  error: unknown;
  retry: () => void;
  title?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest =
    typeof error === "object" && error !== null && "digest" in error ? String((error as { digest?: unknown }).digest) : null;
  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-20 text-center"
    >
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 text-muted">
        We couldn&apos;t load this page. Your bookings and payments are safe. Please try again.
      </p>
      {digest ? <p className="mt-2 font-mono text-xs text-muted">Error reference: {digest}</p> : null}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" className={buttonClass("primary")} onClick={() => retry()}>
          Try again
        </button>
        <Link href="/" className={buttonClass("secondary")}>
          Go home
        </Link>
      </div>
    </div>
  );
}
