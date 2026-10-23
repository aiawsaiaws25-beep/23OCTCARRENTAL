"use client";

import { catchError, type ErrorInfo } from "next/error";
import { useEffect } from "react";

function Fallback(props: { label: string }, { error, retry }: ErrorInfo) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
      <p className="font-semibold">We couldn&apos;t load {props.label}.</p>
      <p className="mt-1">Please try again in a moment.</p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-2 rounded-md bg-white px-3 py-1.5 font-medium text-red-900 ring-1 ring-red-300 hover:bg-red-100"
      >
        Try again
      </button>
    </div>
  );
}

/** Component-level error boundary so one failing section doesn't take down the whole page. */
export const SectionBoundary = catchError(Fallback);
