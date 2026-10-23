import { Client } from "pg";
import { describe, expect, it } from "vitest";

const urls = { driveeasy_dev: process.env.DATABASE_URL, driveeasy_test: process.env.TEST_DATABASE_URL };

describe.each(Object.entries(urls))("%s", (name, url) => {
  it("connects and has btree_gist", async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const { rows } = await client.query(
        "select current_database() as db, (select count(*) from pg_extension where extname = 'btree_gist')::int as gist",
      );
      expect(rows[0]).toEqual({ db: name, gist: 1 });
    } finally {
      await client.end();
    }
  });
});

it("btree_gist blocks overlapping rentals of the same vehicle", async () => {
  const client = new Client({ connectionString: urls.driveeasy_test });
  await client.connect();
  try {
    await client.query(`create temp table rental (
      vehicle_id int not null,
      period tstzrange not null,
      exclude using gist (vehicle_id with =, period with &&)
    )`);
    await client.query("insert into rental values (1, '[2026-11-01,2026-11-05)'), (2, '[2026-11-01,2026-11-05)')");
    await expect(client.query("insert into rental values (1, '[2026-11-04,2026-11-08)')")).rejects.toThrow(/exclusion/);
  } finally {
    await client.end();
  }
});
