-- Double-booking protection (custom migration; drizzle-kit cannot express EXCLUDE constraints).
--
-- Design: every period that makes a vehicle unavailable is mirrored into
-- vehicle_occupancy by triggers on reservations and maintenance_blocks:
--   * reservations with status PENDING, CONFIRMED or PICKED_UP
--   * maintenance_blocks that are not cancelled
-- vehicle_occupancy carries one exclusion constraint:
--   EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)
-- so no two rows for the same vehicle may overlap, whatever their source
-- (reservation vs reservation, reservation vs maintenance, maintenance vs maintenance).
--
-- Why this is race-safe: the trigger runs inside the writing transaction, and
-- PostgreSQL checks exclusion constraints against uncommitted rows of concurrent
-- transactions too (the second writer waits for the first to commit or roll back,
-- then raises SQLSTATE 23P01 exclusion_violation). No application-level check can
-- be skipped or raced past. The reservation service also locks the vehicle row
-- (SELECT ... FOR UPDATE) and checks for overlaps first so it can return a friendly
-- error; the constraint is the last line of defence and 23P01 maps to the same
-- "vehicle unavailable" error.
--
-- Periods are half-open [start, end): a rental ending at 10:00 and the next one
-- starting at 10:00 do not overlap.
--
-- A constraint predicate cannot depend on now(), so a PENDING reservation keeps
-- occupying its period until it is expired (status -> EXPIRED) by the hold-release
-- job or lazily by the reservation service (which expires stale holds on the locked
-- vehicle before inserting a new one).

ALTER TABLE "vehicle_occupancy"
  ADD CONSTRAINT "vehicle_occupancy_no_overlap"
  EXCLUDE USING gist ("vehicle_id" WITH =, "period" WITH &&);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION driveeasy_sync_reservation_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM vehicle_occupancy WHERE reservation_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.status IN ('PENDING', 'CONFIRMED', 'PICKED_UP') THEN
    INSERT INTO vehicle_occupancy (vehicle_id, period, reservation_id)
    VALUES (NEW.vehicle_id, NEW.period, NEW.id)
    ON CONFLICT (reservation_id) DO UPDATE
      SET vehicle_id = EXCLUDED.vehicle_id, period = EXCLUDED.period
      WHERE vehicle_occupancy.vehicle_id IS DISTINCT FROM EXCLUDED.vehicle_id
         OR vehicle_occupancy.period IS DISTINCT FROM EXCLUDED.period;
  ELSE
    DELETE FROM vehicle_occupancy WHERE reservation_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER reservations_occupancy_sync
AFTER INSERT OR UPDATE OF status, vehicle_id, start_at, end_at OR DELETE ON reservations
FOR EACH ROW EXECUTE FUNCTION driveeasy_sync_reservation_occupancy();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION driveeasy_sync_maintenance_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM vehicle_occupancy WHERE maintenance_block_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.cancelled_at IS NULL THEN
    INSERT INTO vehicle_occupancy (vehicle_id, period, maintenance_block_id)
    VALUES (NEW.vehicle_id, NEW.period, NEW.id)
    ON CONFLICT (maintenance_block_id) DO UPDATE
      SET vehicle_id = EXCLUDED.vehicle_id, period = EXCLUDED.period
      WHERE vehicle_occupancy.vehicle_id IS DISTINCT FROM EXCLUDED.vehicle_id
         OR vehicle_occupancy.period IS DISTINCT FROM EXCLUDED.period;
  ELSE
    DELETE FROM vehicle_occupancy WHERE maintenance_block_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER maintenance_blocks_occupancy_sync
AFTER INSERT OR UPDATE OF cancelled_at, vehicle_id, start_at, end_at OR DELETE ON maintenance_blocks
FOR EACH ROW EXECUTE FUNCTION driveeasy_sync_maintenance_occupancy();
