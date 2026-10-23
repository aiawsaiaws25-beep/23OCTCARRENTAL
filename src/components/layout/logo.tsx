import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-md text-ink" aria-label="DriveEasy home">
      <span className="flex size-9 items-center justify-center rounded-lg bg-brand-600 text-white" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 13l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5v4a1 1 0 0 1-1 1h-1a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0H4a1 1 0 0 1-1-1v-4z" />
        </svg>
      </span>
      <span className="text-lg font-bold tracking-tight">
        Drive<span className="text-brand-600">Easy</span>
      </span>
    </Link>
  );
}
