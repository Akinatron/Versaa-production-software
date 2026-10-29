import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { recordOpeningCount } from "@/db/operations";
import { recordStockCount, recordWriteOff } from "@/db/adjustments";
import { endOfDay, lotBalance, lotBalanceAt } from "@/db/ledger";
import { today } from "@/db/base";
import { freshDb, testDbUrl } from "./helpers";

/* A count entered days after it was made is compared with the stock of that day, not of today. */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});
const bal = (db: DB, lotId: string) => lotBalance(db as never, lotId).then((d) => d.toString());

async function onionLot(kg: string) {
  const db = await freshDb();
  dbs.push(db);
  const [onion] = await db.select().from(t.items).where(eq(t.items.code, "ing-onions"));
  await recordOpeningCount(db, { idempotencyKey: "open", countedOn: "2026-10-17", lines: [{ itemId: onion!.id, quantity: kg }] });
  const [lot] = await db.select().from(t.lots).where(eq(t.lots.itemId, onion!.id));
  return { db, lot: lot! };
}

describe("end of day", () => {
  it("is midnight UTC of the next day", () => {
    expect(endOfDay("2026-10-24").toISOString()).toBe("2026-10-25T00:00:00.000Z");
    expect(endOfDay("2026-12-31").toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe.skipIf(!testDbUrl)("a count with a past date", () => {
  it("keeps what was recorded after the count day", async () => {
    const { db, lot } = await onionLot("12");
    // Counted 10 kg on Friday 24, but entered on Monday after 3 kg went on the 26th.
    await recordWriteOff(db, { idempotencyKey: "wo", type: "waste", reason: "rotten", occurredOn: "2026-10-26", lines: [{ lotId: lot.id, quantity: "3" }] });
    expect(await bal(db, lot.id)).toBe("9");
    expect((await lotBalanceAt(db as never, lot.id, "2026-10-24")).toString()).toBe("12");
    await recordStockCount(db, { idempotencyKey: "cnt", countedOn: "2026-10-24", reason: "Friday count", lines: [{ lotId: lot.id, counted: "10" }] });
    expect(await bal(db, lot.id)).toBe("7");
    expect((await lotBalanceAt(db as never, lot.id, "2026-10-24")).toString()).toBe("10");
  });

  it("a count dated today works as before", async () => {
    const { db, lot } = await onionLot("12");
    await recordStockCount(db, { idempotencyKey: "cnt", countedOn: today(), reason: "count", lines: [{ lotId: lot.id, counted: "11.5" }] });
    expect(await bal(db, lot.id)).toBe("11.5");
  });
});
