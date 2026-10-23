"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function format(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Shows how long the car stays reserved; refreshes the page when the hold runs out. */
export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();
  const end = Date.parse(expiresAt);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const left = now == null ? null : end - now;
  const expired = left != null && left <= 0;

  useEffect(() => {
    if (expired) router.refresh();
  }, [expired, router]);

  return (
    <div
      data-testid="hold-countdown"
      className={`rounded-lg px-4 py-3 text-sm ring-1 ${expired ? "bg-red-50 text-red-900 ring-red-200" : "bg-amber-50 text-amber-900 ring-amber-200"}`}
    >
      {expired ? (
        <p role="alert" className="font-semibold">
          Your hold has expired.
        </p>
      ) : (
        <p>
          We&apos;re holding this car for you for{" "}
          <span className="font-semibold tabular-nums" aria-live="off">
            {left == null ? "a few minutes" : format(left)}
          </span>
          . Complete your details and payment before the timer runs out.
        </p>
      )}
    </div>
  );
}
