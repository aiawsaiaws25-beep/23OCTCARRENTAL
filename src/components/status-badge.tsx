import { Badge, type BadgeTone } from "@/components/ui/badge";

const reservationTones: Record<string, BadgeTone> = {
  PENDING: "warning",
  CONFIRMED: "success",
  PICKED_UP: "info",
  RETURNED: "neutral",
  CANCELLED: "danger",
  EXPIRED: "neutral",
  REFUNDED: "neutral",
};

const reservationLabels: Record<string, string> = {
  PENDING: "Awaiting payment",
  CONFIRMED: "Confirmed",
  PICKED_UP: "On rent",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  REFUNDED: "Refunded",
};

export function ReservationStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={reservationTones[status] ?? "neutral"} testId="reservation-status">
      {reservationLabels[status] ?? status}
    </Badge>
  );
}

const genericTones: Record<string, BadgeTone> = {
  AVAILABLE: "success",
  RESERVED: "info",
  ON_RENT: "info",
  MAINTENANCE: "warning",
  RETIRED: "neutral",
  SUCCEEDED: "success",
  FAILED: "danger",
  AUTHORIZED: "info",
  RELEASED: "neutral",
  CAPTURED: "warning",
  OPEN: "warning",
  CHARGED: "danger",
  RESOLVED: "success",
  MINOR: "neutral",
  MODERATE: "warning",
  MAJOR: "danger",
};

export function StatusBadge({ status }: { status: string }) {
  const label = status.charAt(0) + status.slice(1).toLowerCase().replaceAll("_", " ");
  return <Badge tone={genericTones[status] ?? "neutral"}>{label}</Badge>;
}
