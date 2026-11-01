import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { createRun } from "@/db/operations";
import { createSalesOrder } from "@/db/sales";
import { wipeDatabase } from "@/db/wipe";
import { freshDb, testDbUrl } from "./helpers";

/*
 * Run and sales order codes come from a counter, not from chance: two made
 * on the same day can't get the same code, and the second is never lost.
 */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

async function setUp() {
  const db = await freshDb();
  dbs.push(db);
  const ids: Record<string, string> = {};
  for (const p of await db.select().from(t.products)) ids[p.name] = p.id;
  return { db, big: ids["Liberiaanse Kip 950 ml"]! };
}

describe.skipIf(!testDbUrl)("codes", () => {
  it("two runs on the same day both exist, numbered 01 and 02", async () => {
    const { db, big } = await setUp();
    // The old codes used the first 4 letters of the form's key: these two would have clashed.
    const a = await createRun(db, { idempotencyKey: "a3f9-first", plannedFor: "2026-10-29", targets: { [big]: 10 } });
    const b = await createRun(db, { idempotencyKey: "a3f9-second", plannedFor: "2026-10-29", targets: { [big]: 20 } });
    expect(a.id).not.toBe(b.id);
    expect([a.code, b.code]).toEqual(["RUN-20261029-01", "RUN-20261029-02"]);
    const other = await createRun(db, { idempotencyKey: "x", plannedFor: "2026-10-30", targets: { [big]: 5 } });
    expect(other.code).toBe("RUN-20261030-01");
  });

  it("pressing Save twice still makes one run", async () => {
    const { db, big } = await setUp();
    const a = await createRun(db, { idempotencyKey: "same-key", plannedFor: "2026-10-29", targets: { [big]: 10 } });
    const again = await createRun(db, { idempotencyKey: "same-key", plannedFor: "2026-10-29", targets: { [big]: 10 } });
    expect(again.id).toBe(a.id);
    expect(await db.select().from(t.productionRuns)).toHaveLength(1);
  });

  it("older codes stay as they are and are never given again", async () => {
    const { db, big } = await setUp();
    await db.insert(t.productionRuns).values([
      { code: "RUN-20261029-A3F9", plannedFor: "2026-10-29" },
      { code: "RUN-20261029-02", plannedFor: "2026-10-29" },
    ]);
    const a = await createRun(db, { idempotencyKey: "k1", plannedFor: "2026-10-29", targets: { [big]: 10 } });
    // Two codes with this date exist, so it starts at 03.
    expect(a.code).toBe("RUN-20261029-03");
    await db.insert(t.productionRuns).values({ code: "RUN-20261029-04", plannedFor: "2026-10-29" });
    const b = await createRun(db, { idempotencyKey: "k2", plannedFor: "2026-10-29", targets: { [big]: 10 } });
    expect(b.code).toBe("RUN-20261029-05");
    const [old] = await db.select().from(t.productionRuns).where(eq(t.productionRuns.code, "RUN-20261029-A3F9"));
    expect(old).toBeDefined();
  });

  it("two sales orders on the same day both save", async () => {
    const { db, big } = await setUp();
    const line = [{ productId: big, jars: 1 }];
    const a = await createSalesOrder(db, { idempotencyKey: "9f3c-a", destination: "Market", orderedOn: "2026-10-29", lines: line });
    const b = await createSalesOrder(db, { idempotencyKey: "9f3c-b", destination: "Shop", orderedOn: "2026-10-29", lines: line });
    expect([a.order.code, b.order.code]).toEqual(["SO-20261029-01", "SO-20261029-02"]);
  });

  it("numbering starts again after deleting all activity", async () => {
    const { db, big } = await setUp();
    await createRun(db, { idempotencyKey: "k1", plannedFor: "2026-10-29", targets: { [big]: 10 } });
    await wipeDatabase(db, ["activity"]);
    const a = await createRun(db, { idempotencyKey: "k2", plannedFor: "2026-10-29", targets: { [big]: 10 } });
    expect(a.code).toBe("RUN-20261029-01");
  });
});
