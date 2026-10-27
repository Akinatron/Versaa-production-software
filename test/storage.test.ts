import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { addItem, setItemStorage } from "@/db/catalog";
import { recordOpeningCount } from "@/db/operations";
import { recordReceipt, updateLot } from "@/db/purchasing";
import { keptIn, storageByItem } from "@/db/storage";
import { parseStorage, storageLabel } from "@/domain/storage";
import { freshDb, testDbUrl } from "./helpers";

describe("storage values (no database)", () => {
  it("reads form values", () => {
    expect(parseStorage("")).toBeNull();
    expect(parseStorage("freezer")).toBe("freezer");
    expect(parseStorage("cellar")).toBe("invalid");
    expect(storageLabel("room")).toBe("Room temperature");
    expect(storageLabel(null)).toBe("Not set");
  });
});

const suite = testDbUrl ? describe : describe.skip;

suite("storage on items and lots", () => {
  let db: DB;
  const ids: Record<string, string> = {};
  const lotOf = async (itemId: string, code?: string) =>
    await db
      .select()
      .from(t.lots)
      .where(code ? and(eq(t.lots.itemId, itemId), eq(t.lots.code, code)) : eq(t.lots.itemId, itemId));

  beforeAll(async () => {
    db = await freshDb();
    for (const i of await db.select().from(t.items)) ids[i.code] = i.id;
  });
  afterAll(async () => {
    await db.$client.end();
  });

  it("starts as not set, and old lots take the default when it is first chosen", async () => {
    const onions = ids["ing-onions"]!;
    expect((await db.select().from(t.items).where(eq(t.items.id, onions)))[0]!.storage).toBeNull();
    await recordOpeningCount(db, { idempotencyKey: "open", countedOn: "2026-10-17", lines: [{ itemId: onions, quantity: "10" }] });
    expect((await lotOf(onions))[0]!.storage).toBeNull();
    await setItemStorage(db, onions, "room");
    expect((await lotOf(onions)).map((l) => l.storage)).toEqual(["room"]);
  });

  it("new lots take the card's default unless the delivery says otherwise", async () => {
    const onions = ids["ing-onions"]!;
    const garlic = ids["ing-garlic"] ?? (await addItem(db, { kind: "ingredient", name: "Garlic test", stockUnit: "kg", storage: "fridge" })).id;
    await setItemStorage(db, garlic, "fridge");
    await recordReceipt(db, {
      idempotencyKey: "rx-st",
      receivedOn: "2026-10-20",
      lines: [
        { itemId: onions, quantity: "5" },
        { itemId: garlic, quantity: "2", storage: "freezer" },
      ],
    });
    const [onionLot] = (await lotOf(onions)).filter((l) => l.code.startsWith("RCV"));
    const [garlicLot] = (await lotOf(garlic)).filter((l) => l.code.startsWith("RCV"));
    expect(onionLot!.storage).toBe("room");
    expect(garlicLot!.storage).toBe("freezer");

    const s = await storageByItem(db);
    expect(keptIn(s.get(onions), "room")).toBe(true);
    expect(keptIn(s.get(garlic), "freezer")).toBe(true);
    expect(keptIn(s.get(garlic), "fridge")).toBe(false);
  });

  it("changing the default later leaves existing lots where they are", async () => {
    const onions = ids["ing-onions"]!;
    await setItemStorage(db, onions, "fridge");
    expect((await lotOf(onions)).every((l) => l.storage === "room")).toBe(true);
    const [log] = await db.select().from(t.changeLog).where(eq(t.changeLog.entityId, onions));
    expect(log).toBeTruthy();
  });

  it("a lot can be moved, with a reason, and it is logged", async () => {
    const onions = ids["ing-onions"]!;
    const [lot] = await lotOf(onions);
    await expect(updateLot(db, { lotId: lot!.id, reason: "", storage: "freezer" })).rejects.toThrow(/why/i);
    await updateLot(db, { lotId: lot!.id, reason: "froze the rest", storage: "freezer" });
    expect((await lotOf(onions, lot!.code))[0]!.storage).toBe("freezer");
    const logs = await db.select().from(t.changeLog).where(eq(t.changeLog.entityId, lot!.id));
    expect(logs.some((l) => l.summary.includes("Freezer"))).toBe(true);
  });

  it("refuses unknown places and packaging items", async () => {
    await expect(setItemStorage(db, ids["ing-onions"]!, "cellar")).rejects.toThrow(/Fridge/);
    const pkg = Object.entries(ids).find(([code]) => code.startsWith("pkg-"))![1];
    await expect(setItemStorage(db, pkg, "fridge")).rejects.toThrow(/Packaging/);
  });
});
