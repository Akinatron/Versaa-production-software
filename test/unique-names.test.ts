import { afterAll, describe, expect, it } from "vitest";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { addItem, addSauce, renameItem } from "@/db/catalog";
import { addSupplier } from "@/db/operations";
import { addCustomer } from "@/db/sales";
import { updateSupplier } from "@/db/suppliers";
import { freshDb, testDbUrl } from "./helpers";

/* Names that must stay unique (ignoring capitals), also with a double click, and one batch prefix per sauce. */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

async function setup() {
  const db = await freshDb();
  dbs.push(db);
  return db;
}

describe.skipIf(!testDbUrl)("unique names", () => {
  it("suppliers and customers: no repeats, and a double click creates one", async () => {
    const db = await setup();
    const both = await Promise.allSettled([addSupplier(db, { name: "Groente BV" }), addSupplier(db, { name: "Groente BV" })]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(t.suppliers)).toHaveLength(1);
    await expect(addSupplier(db, { name: "groente bv" })).rejects.toThrow(/already exists/);
    const other = await addSupplier(db, { name: "Potten NV" });
    await expect(updateSupplier(db, other.id, { name: "GROENTE BV" })).rejects.toThrow(/already exists/);

    await Promise.allSettled([addCustomer(db, { name: "De Kaai" }), addCustomer(db, { name: "De Kaai" })]);
    expect(await db.select().from(t.customers)).toHaveLength(1);
    await expect(addCustomer(db, { name: "de kaai" })).rejects.toThrow(/already exists/);
  });

  it("items can't be renamed to a name already in use", async () => {
    const db = await setup();
    const a = await addItem(db, { kind: "ingredient", name: "Red onion", stockUnit: "kg" });
    await addItem(db, { kind: "ingredient", name: "White onion", stockUnit: "kg" });
    await expect(renameItem(db, a.id, "white ONION")).rejects.toThrow(/already exists/);
    await renameItem(db, a.id, "Red onions");
  });

  it("each sauce has its own name and batch prefix", async () => {
    const db = await setup();
    await addSauce(db, { name: "Chili", batchPrefix: "CHI" });
    await expect(addSauce(db, { name: "chili" })).rejects.toThrow(/already exists/);
    await expect(addSauce(db, { name: "Chili Hot", batchPrefix: "chi" })).rejects.toThrow(/Chili already uses the batch prefix CHI/);
    await addSauce(db, { name: "Chili Hot", batchPrefix: "CHH" });
  });
});
