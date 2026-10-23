import Image from "next/image";
import Link from "next/link";
import { formatAED, pluralize } from "@/components/format";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";

export type VehicleCardData = {
  id: string;
  make: string;
  model: string;
  year: number;
  categoryName: string;
  transmission: string;
  fuelType: string;
  seats: number;
  doors?: number;
  luggage: number;
  imageUrl: string | null;
  dailyRateFils: number;
  /** Server quote for the selected trip (without extras), if dates were chosen. */
  totalFils?: number | null;
  days?: number | null;
  oneWayFeeFils?: number | null;
};

export function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export function VehicleSpecs({ v }: { v: Pick<VehicleCardData, "transmission" | "fuelType" | "seats" | "luggage" | "doors"> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted" aria-label="Specifications">
      <li>{pluralize(v.seats, "seat")}</li>
      <li>{titleCase(v.transmission)}</li>
      <li>{titleCase(v.fuelType)}</li>
      <li>{pluralize(v.luggage, "bag")}</li>
      {v.doors ? <li>{pluralize(v.doors, "door")}</li> : null}
    </ul>
  );
}

export function VehicleImage({ src, alt, priority, className }: { src: string | null; alt: string; priority?: boolean; className?: string }) {
  return (
    <div className={`relative aspect-[16/9] overflow-hidden bg-brand-50 ${className ?? ""}`}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          unoptimized={src.endsWith(".svg")}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted">No photo</div>
      )}
    </div>
  );
}

export function VehicleCard({ v, href, priority }: { v: VehicleCardData; href: string; priority?: boolean }) {
  const name = `${v.make} ${v.model}`;
  return (
    <article
      data-testid="vehicle-card"
      data-vehicle-id={v.id}
      className="flex flex-col overflow-hidden rounded-xl border border-line bg-white shadow-sm transition-shadow hover:shadow-md"
    >
      <VehicleImage src={v.imageUrl} alt={`${name} ${v.year}`} priority={priority} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold leading-tight">
              <Link href={href} className="hover:underline">
                {name}
              </Link>
            </h3>
            <p className="text-sm text-muted">{v.year} or similar</p>
          </div>
          <Badge tone="brand">{v.categoryName}</Badge>
        </div>
        <div className="mt-3">
          <VehicleSpecs v={v} />
        </div>
        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div>
            <p className="text-sm text-muted">
              <span data-testid="vehicle-daily-rate" className="text-lg font-bold text-ink">
                {formatAED(v.dailyRateFils)}
              </span>{" "}
              / day
            </p>
            {v.totalFils != null ? (
              <p className="text-xs text-muted" data-testid="vehicle-trip-total">
                {formatAED(v.totalFils)} total{v.days ? ` for ${pluralize(v.days, "day")}` : ""}, VAT incl.
                {v.oneWayFeeFils ? ` Includes one-way fee ${formatAED(v.oneWayFeeFils)}.` : ""}
              </p>
            ) : null}
          </div>
          <Link href={href} className={buttonClass("primary", "sm")} aria-label={`View ${name}`}>
            View
          </Link>
        </div>
      </div>
    </article>
  );
}
