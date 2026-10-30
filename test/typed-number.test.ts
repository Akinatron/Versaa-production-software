import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { createSalesOrder, updateSalesOrder } from "@/db/sales";
import { loadPlanCatalog } from "@/db/planning";
import { numberText, typedNumber, wholeNumber } from "@/domain/typed-number";
import { freshDb, testDbUrl } from "./helpers";

/*
 * Number fields are text boxes, so "12,5" arrives as typed whatever language
 * Windows is in (a browser number field turned it into 125 in English).
 */

describe("numbers typed in a form", () => {
  it("reads a comma or a point", () => {
    expect(numberText("7,5")).toBe("7.5");
    expect(numberText(" 12 ")).toBe("12");
    expect(numberText("")).toBe("");
    expect(numberText("1.250,5")).toBeNull();
    expect(numberText("abc")).toBeNull();
    expect(typedNumber("12,5")).toBe(12.5);
    expect(typedNumber("0.25")).toBe(0.25);
    expect(typedNumber("")).toBeNaN();
    expect(typedNumber("7 kg")).toBeNaN();
  });

  it("reads whole numbers, and never a thousands separator", () => {
    expect(wholeNumber("12")).toBe(12);
    expect(wholeNumber(" 40 ")).toBe(40);
    expect(wholeNumber("12,0")).toBe(12);
    expect(wholeNumber("12.00")).toBe(12);
    expect(wholeNumber("12,5")).toBeNaN();
    expect(wholeNumber("1.000")).toBeNaN();
    expect(wholeNumber("1,000")).toBeNaN();
    expect(wholeNumber("")).toBeNaN();
    expect(wholeNumber("ten")).toBeNaN();
  });

  it("no page uses a browser number field (it drops the comma in English)", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".tsx")) files.push(p);
      }
    };
    walk("src/app");
    const offenders = files.filter((f) => /type=["{]?["']?number/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

const suite = testDbUrl ? describe : describe.skip;

suite("a sales order price typed with a comma", () => {
  it("is saved as a number and written in the history, not an error page", async () => {
    const db = await freshDb();
    dbs.push(db);
    const catalog = await loadPlanCatalog(db);
    const product = catalog.products[0]!;
    const { order } = await createSalesOrder(db, { idempotencyKey: "so-comma", destination: "Shop", lines: [{ productId: product.id, jars: 2, unitPrice: "6,5" }] });
    await updateSalesOrder(db, {
      salesOrderId: order.id,
      reason: "New price",
      destination: "Shop",
      orderedOn: order.orderedOn,
      lines: [{ productId: product.id, jars: 2, unitPrice: "7,25" }],
    });
    const lines = await db.select().from(t.salesOrderLines);
    expect(lines.map((l) => l.unitPrice)).toEqual(["7.25"]);
  });
});
