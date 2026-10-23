import "server-only";
import { tripSchema, zonedToUtc, type TripParams } from "@/components/search-params";
import { listBranches } from "@/server/catalog";

export type ResolvedTrip = {
  pickupBranchId: string;
  returnBranchId: string;
  pickupAt: Date;
  returnAt: Date;
};

/** Validates the trip from the client and resolves branch codes to ids and local times to UTC. */
export async function resolveTrip(trip: TripParams): Promise<ResolvedTrip | null> {
  const parsed = tripSchema.safeParse(trip);
  if (!parsed.success) return null;
  const branches = await listBranches();
  const pickup = branches.find((b) => b.code === parsed.data.pickupBranch);
  const dropoff = branches.find((b) => b.code === parsed.data.returnBranch);
  if (!pickup || !dropoff) return null;
  return {
    pickupBranchId: pickup.id,
    returnBranchId: dropoff.id,
    pickupAt: zonedToUtc(parsed.data.pickupDate, parsed.data.pickupTime, pickup.timeZone),
    returnAt: zonedToUtc(parsed.data.returnDate, parsed.data.returnTime, dropoff.timeZone),
  };
}
