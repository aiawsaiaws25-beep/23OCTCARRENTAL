import Link from "next/link";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="no-print mt-16 border-t border-line bg-white">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3 sm:px-6">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted">
            Car rental across the UAE. Transparent prices in AED with 5% VAT included in every quote.
          </p>
        </div>
        <nav aria-label="Footer" className="text-sm">
          <h2 className="font-semibold text-ink">Explore</h2>
          <ul className="mt-3 space-y-2 text-muted">
            <li>
              <Link className="hover:text-ink hover:underline" href="/search">
                Find a car
              </Link>
            </li>
            <li>
              <Link className="hover:text-ink hover:underline" href="/branches">
                Branches
              </Link>
            </li>
            <li>
              <Link className="hover:text-ink hover:underline" href="/my-rentals">
                My rentals
              </Link>
            </li>
          </ul>
        </nav>
        <div className="text-sm text-muted">
          <h2 className="font-semibold text-ink">Good to know</h2>
          <ul className="mt-3 space-y-2">
            <li>Times are shown in UAE time (GST, UTC+4).</li>
            <li>A refundable security deposit is held on your card at booking.</li>
            <li>Bring your driving licence and the pick-up voucher.</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line py-4 text-center text-xs text-muted">DriveEasy, United Arab Emirates</div>
    </footer>
  );
}
