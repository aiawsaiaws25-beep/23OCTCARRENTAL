-- Sample custom migration: the double-booking guard.
-- Drizzle Kit can't generate EXCLUDE constraints, so this goes in a hand-written
-- migration after the generated one. Rename "resource" to your domain (vehicle, room, desk...).
--
-- Requires: CREATE EXTENSION IF NOT EXISTS btree_gist;
--
-- Design: every period that makes a resource unavailable (active bookings and
-- non-cancelled maintenance blocks) is mirrored into resource_occupancy by triggers.
-- One exclusion constraint on that table blocks every kind of overlap.
-- Triggers run inside the writing transaction, and Postgres checks exclusion
-- constraints against concurrent uncommitted rows, so two overlapping writers can
-- never both commit: the second waits, then fails with SQLSTATE 23P01.
-- Periods are half-open [start, end), so back-to-back bookings are allowed.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS resource_occupancy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  period tstzrange NOT NULL,
  booking_id uuid UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  maintenance_block_id uuid UNIQUE REFERENCES maintenance_blocks(id) ON DELETE CASCADE,
  CHECK ((booking_id IS NULL) <> (maintenance_block_id IS NULL))
);

ALTER TABLE resource_occupancy
  ADD CONSTRAINT resource_occupancy_no_overlap
  EXCLUDE USING gist (resource_id WITH =, period WITH &&);

-- bookings.period and maintenance_blocks.period are generated columns:
--   period tstzrange GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED

CREATE OR REPLACE FUNCTION sync_booking_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM resource_occupancy WHERE booking_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.status IN ('PENDING', 'CONFIRMED', 'IN_PROGRESS') THEN
    INSERT INTO resource_occupancy (resource_id, period, booking_id)
    VALUES (NEW.resource_id, NEW.period, NEW.id)
    ON CONFLICT (booking_id) DO UPDATE
      SET resource_id = EXCLUDED.resource_id, period = EXCLUDED.period
      WHERE resource_occupancy.resource_id IS DISTINCT FROM EXCLUDED.resource_id
         OR resource_occupancy.period IS DISTINCT FROM EXCLUDED.period;
  ELSE
    DELETE FROM resource_occupancy WHERE booking_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_occupancy_sync
AFTER INSERT OR UPDATE OF status, resource_id, start_at, end_at OR DELETE ON bookings
FOR EACH ROW EXECUTE FUNCTION sync_booking_occupancy();

CREATE OR REPLACE FUNCTION sync_maintenance_occupancy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM resource_occupancy WHERE maintenance_block_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.cancelled_at IS NULL THEN
    INSERT INTO resource_occupancy (resource_id, period, maintenance_block_id)
    VALUES (NEW.resource_id, NEW.period, NEW.id)
    ON CONFLICT (maintenance_block_id) DO UPDATE
      SET resource_id = EXCLUDED.resource_id, period = EXCLUDED.period
      WHERE resource_occupancy.resource_id IS DISTINCT FROM EXCLUDED.resource_id
         OR resource_occupancy.period IS DISTINCT FROM EXCLUDED.period;
  ELSE
    DELETE FROM resource_occupancy WHERE maintenance_block_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER maintenance_blocks_occupancy_sync
AFTER INSERT OR UPDATE OF cancelled_at, resource_id, start_at, end_at OR DELETE ON maintenance_blocks
FOR EACH ROW EXECUTE FUNCTION sync_maintenance_occupancy();

-- Quick check (should fail with 23P01 on the third insert, the second must succeed):
--   [10:00, 12:00) then [12:00, 14:00)  -> both fine (back-to-back)
--   [11:00, 13:00)                      -> exclusion_violation
