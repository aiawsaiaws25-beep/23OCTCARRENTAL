// Q5/Q6 at the database level: the exclusion constraint on vehicle_occupancy
// (fed by triggers from reservations + maintenance_blocks) must make overlapping
// active bookings impossible, even under true concurrency, while allowing
// back-to-back rentals ([a,b) then [b,c)).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasMigrations } from "../helpers/db";
import { at, closeQaPool, createUser, createVehicle, insertReservation, pgCode, qaPool } from "../helpers/factory";

describe.runIf(hasMigrations())("overlap protection (DB level)", () => {
  let userId: string;
  beforeAll(async () => {
    userId = (await createUser()).id;
  });
  afterAll(closeQaPool);

  async function vehicle() {
    const v = await createVehicle();
    return { vehicleId: v.id, branchId: v.branchId };
  }

  it("rejects an overlapping active reservation with 23P01", async () => {
    const v = await vehicle();
    await insertReservation({ ...v, userId, startAt: at(0), endAt: at(3) });
    const err = await insertReservation({ ...v, userId, startAt: at(2), endAt: at(5) }).catch((e) => e);
    expect(pgCode(err)).toBe("23P01");
  });

  it("rejects a reservation fully inside / enclosing another", async () => {
    const v = await vehicle();
    await insertReservation({ ...v, userId, startAt: at(10), endAt: at(15), status: "CONFIRMED" });
    expect(pgCode(await insertReservation({ ...v, userId, startAt: at(11), endAt: at(12) }).catch((e) => e))).toBe("23P01");
    expect(pgCode(await insertReservation({ ...v, userId, startAt: at(9), endAt: at(16) }).catch((e) => e))).toBe("23P01");
    // Identical period too.
    expect(pgCode(await insertReservation({ ...v, userId, startAt: at(10), endAt: at(15) }).catch((e) => e))).toBe("23P01");
  });

  it("allows back-to-back rentals (end == next start) in both orders", async () => {
    const v = await vehicle();
    await insertReservation({ ...v, userId, startAt: at(20, 10), endAt: at(22, 10), status: "CONFIRMED" });
    await expect(insertReservation({ ...v, userId, startAt: at(22, 10), endAt: at(24, 10) })).resolves.toBeTruthy();
    await expect(insertReservation({ ...v, userId, startAt: at(18, 10), endAt: at(20, 10) })).resolves.toBeTruthy();
    // ...but one minute of overlap is rejected.
    expect(pgCode(await insertReservation({ ...v, userId, startAt: at(24, 9, 59), endAt: at(25) }).catch((e) => e))).toBe("23P01");
  });

  it("allows the same period on a different vehicle", async () => {
    const a = await vehicle();
    const b = await vehicle();
    await insertReservation({ ...a, userId, startAt: at(30), endAt: at(33) });
    await expect(insertReservation({ ...b, userId, startAt: at(30), endAt: at(33) })).resolves.toBeTruthy();
  });

  it.each(["CANCELLED", "EXPIRED", "RETURNED", "REFUNDED"] as const)("a %s reservation frees the period", async (status) => {
    const v = await vehicle();
    const r = await insertReservation({ ...v, userId, startAt: at(40), endAt: at(43) });
    await qaPool().query(`update reservations set status = $1 where id = $2`, [status, r.id]);
    await expect(insertReservation({ ...v, userId, startAt: at(41), endAt: at(44) })).resolves.toBeTruthy();
  });

  it("inactive reservations can be inserted overlapping anything", async () => {
    const v = await vehicle();
    await insertReservation({ ...v, userId, startAt: at(50), endAt: at(53), status: "CONFIRMED" });
    await expect(insertReservation({ ...v, userId, startAt: at(50), endAt: at(53), status: "CANCELLED" })).resolves.toBeTruthy();
  });

  it("re-activating a cancelled reservation into an occupied period fails", async () => {
    const v = await vehicle();
    const old = await insertReservation({ ...v, userId, startAt: at(60), endAt: at(63) });
    await qaPool().query(`update reservations set status = 'CANCELLED' where id = $1`, [old.id]);
    await insertReservation({ ...v, userId, startAt: at(61), endAt: at(62), status: "CONFIRMED" });
    const err = await qaPool()
      .query(`update reservations set status = 'CONFIRMED' where id = $1`, [old.id])
      .catch((e) => e);
    expect(pgCode(err)).toBe("23P01");
  });

  it("moving dates into an occupied period fails; moving into a free one succeeds", async () => {
    const v = await vehicle();
    await insertReservation({ ...v, userId, startAt: at(70), endAt: at(72), status: "CONFIRMED" });
    const r = await insertReservation({ ...v, userId, startAt: at(72), endAt: at(74), status: "CONFIRMED" });
    const err = await qaPool()
      .query(`update reservations set start_at = $1 where id = $2`, [at(71), r.id])
      .catch((e) => e);
    expect(pgCode(err)).toBe("23P01");
    await qaPool().query(`update reservations set start_at = $1, end_at = $2 where id = $3`, [at(75), at(77), r.id]);
    // The old slot is free again after the move.
    await expect(insertReservation({ ...v, userId, startAt: at(72), endAt: at(74) })).resolves.toBeTruthy();
  });

  it("maintenance blocks and reservations exclude each other", async () => {
    const v = await vehicle();
    await qaPool().query(`insert into maintenance_blocks (vehicle_id, start_at, end_at, reason) values ($1, $2, $3, 'service')`, [
      v.vehicleId,
      at(80),
      at(82),
    ]);
    expect(pgCode(await insertReservation({ ...v, userId, startAt: at(81), endAt: at(83) }).catch((e) => e))).toBe("23P01");
    await expect(insertReservation({ ...v, userId, startAt: at(82), endAt: at(84) })).resolves.toBeTruthy();
    const err = await qaPool()
      .query(`insert into maintenance_blocks (vehicle_id, start_at, end_at, reason) values ($1, $2, $3, 'x')`, [v.vehicleId, at(83), at(85)])
      .catch((e) => e);
    expect(pgCode(err)).toBe("23P01");
  });

  it("cancelling a maintenance block frees the period", async () => {
    const v = await vehicle();
    const { rows } = await qaPool().query(
      `insert into maintenance_blocks (vehicle_id, start_at, end_at, reason) values ($1, $2, $3, 'service') returning id`,
      [v.vehicleId, at(90), at(92)],
    );
    await qaPool().query(`update maintenance_blocks set cancelled_at = now() where id = $1`, [rows[0].id]);
    await expect(insertReservation({ ...v, userId, startAt: at(90), endAt: at(92) })).resolves.toBeTruthy();
  });

  it("rejects end <= start", async () => {
    const v = await vehicle();
    expect(pgCode(await insertReservation({ ...v, userId, startAt: at(100), endAt: at(100) }).catch((e) => e))).toBe("23514");
    expect(pgCode(await insertReservation({ ...v, userId, startAt: at(101), endAt: at(100) }).catch((e) => e))).toMatch(/^(23514|22000)$/); // 22000: invalid range from the generated column
  });

  it("vehicle_occupancy cannot be written to bypass the mirror", async () => {
    // Direct insert without a source row violates the source check.
    const v = await vehicle();
    const err = await qaPool()
      .query(`insert into vehicle_occupancy (vehicle_id, period) values ($1, tstzrange($2, $3, '[)'))`, [v.vehicleId, at(110), at(111)])
      .catch((e) => e);
    expect(pgCode(err)).toBe("23514");
  });

  describe("true concurrency: N parallel transactions for overlapping periods", () => {
    const ROUNDS = 20;
    const PARALLEL = 10;

    it(`exactly one of ${PARALLEL} wins, ${ROUNDS} rounds`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const v = await vehicle();
        const results = await Promise.allSettled(
          Array.from({ length: PARALLEL }, async (_, i) => {
            const c = await qaPool().connect();
            try {
              await c.query("begin");
              // Different but overlapping ranges, all covering day 200 noon.
              const r = await insertReservation({ ...v, userId, startAt: at(200 - (i % 3), 10), endAt: at(201 + (i % 2), 10) }, c);
              await c.query("select pg_sleep(0.01)");
              await c.query("commit");
              return r;
            } catch (e) {
              await c.query("rollback").catch(() => {});
              throw e;
            } finally {
              c.release();
            }
          }),
        );
        const ok = results.filter((r) => r.status === "fulfilled");
        const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
        expect(ok.length, `round ${round}`).toBe(1);
        // Raw concurrent inserts can also lose via deadlock detection (40P01): Postgres
        // aborts one side of a cycle of exclusion-constraint waits. Either way: one winner.
        for (const f of failed) expect(pgCode(f.reason), String(f.reason)).toMatch(/^(23P01|40P01)$/);
        const { rows } = await qaPool().query(
          `select count(*)::int n from reservations where vehicle_id = $1 and status in ('PENDING','CONFIRMED','PICKED_UP')`,
          [v.vehicleId],
        );
        expect(rows[0].n).toBe(1);
      }
    });

    it("parallel back-to-back bookings all succeed", async () => {
      const v = await vehicle();
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) => insertReservation({ ...v, userId, startAt: at(300 + i), endAt: at(301 + i) })),
      );
      expect(results.filter((r) => r.status === "fulfilled").length).toBe(8);
    });
  });
});
