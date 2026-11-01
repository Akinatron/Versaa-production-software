import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { planProduction, type PlanInput, type StockPosition } from "@/domain/planner";
import { seedPlanCatalog, loadSeedCatalog } from "@/domain/seed-catalog";
import { convert } from "@/domain/quantity";

const D = (v: Decimal.Value) => new Decimal(v);

function input(overrides: Partial<PlanInput> & { litres?: Record<string, string> } = {}): PlanInput {
  const cat = seedPlanCatalog();
  if (overrides.litres) {
    for (const s of cat.sauces) {
      const l = overrides.litres[s.id];
      if (l) s.yield = { litresPerBatch: D(l), source: "estimate" };
    }
  }
  return { ...cat, stock: {}, targets: {}, ...overrides };
}

const req = (r: ReturnType<typeof planProduction>, id: string) => r.requirements.find((x) => x.itemId === id)!;

describe("seed catalog", () => {
  it("matches what Pablo gave: 23 ingredients, 20 packaging items, 9 products, 12/14/10 lines", () => {
    const c = loadSeedCatalog();
    expect(c.items.filter((i) => i.kind === "ingredient")).toHaveLength(23);
    expect(c.items.filter((i) => i.kind === "packaging")).toHaveLength(20);
    expect(c.products).toHaveLength(9);
    expect(c.sauces.map((s) => s.lines.length)).toEqual([12, 14, 10]);
  });

  it("keeps recipe quantities exactly as recorded", () => {
    const tikka = loadSeedCatalog().sauces.find((s) => s.code === "indiase-tikka-masala")!;
    const cumin = tikka.lines.find((l) => l.itemCode === "ing-ground-cumin")!;
    expect(cumin.quantity.toString()).toBe("55.7");
    expect(cumin.unit).toBe("g");
  });
});

describe("units", () => {
  it("converts inside a dimension and refuses kg ↔ L", () => {
    expect(convert("467", "g", "kg").toString()).toBe("0.467");
    expect(() => convert("30", "kg", "L")).toThrow();
  });
});

describe("planProduction", () => {
  it("works out batches from litres per batch and reports the surplus", () => {
    // 40 jars of 950 ml, each filled with 750 ml = 30 L of Tikka. With an estimate of 25 L/batch → 2 batches, 20 L surplus.
    const r = planProduction(input({ litres: { "indiase-tikka-masala": "25" }, targets: { "indiase-tikka-masala-950": 40 } }));
    const s = r.sauces[0]!;
    expect(s.litresNeeded.toString()).toBe("30");
    expect(s.batches).toBe(2);
    expect(s.surplusLitres!.toString()).toBe("20");
    expect(r.issues.some((i) => i.message.includes("estimate"))).toBe(true);
  });

  it("scales the recipe by batches and converts g to kg", () => {
    const r = planProduction(input({ litres: { "indiase-tikka-masala": "25" }, targets: { "indiase-tikka-masala-950": 40 } }));
    expect(req(r, "ing-onions").required!.toString()).toBe("11.708");
    expect(req(r, "ing-ground-cumin").required!.toString()).toBe("0.1114");
    expect(req(r, "ing-sunflower-oil").unit).toBe("L");
    expect(req(r, "ing-sunflower-oil").required!.toString()).toBe("2.888");
  });

  it("adds shared ingredients across sauces into one line", () => {
    const r = planProduction(
      input({
        litres: { "indiase-tikka-masala": "25", "italiaanse-bolognese": "25", "liberiaanse-kip": "25" },
        targets: { "indiase-tikka-masala-450": 10, "italiaanse-bolognese-450": 10, "liberiaanse-kip-250": 10 },
      }),
    );
    // One batch each: 5.854 + 4.337 + 7 kg onions.
    const onions = req(r, "ing-onions");
    expect(onions.required!.toString()).toBe("17.191");
    expect(onions.contributions).toHaveLength(3);
    expect(r.requirements.filter((x) => x.itemId === "ing-onions")).toHaveLength(1);
  });

  it("without a yield figure, ingredients are unknown (not 0) but packaging is still worked out", () => {
    const r = planProduction(input({ targets: { "italiaanse-bolognese-950": 12 } }));
    expect(r.sauces[0]!.batches).toBeNull();
    expect(req(r, "ing-minced-beef").required).toBeNull();
    expect(req(r, "ing-minced-beef").status).toBe("unknown");
    expect(req(r, "pkg-950-ml-container").required!.toString()).toBe("12");
    expect(r.issues.some((i) => i.level === "blocker" && i.message.includes("litres-per-batch"))).toBe(true);
  });

  it("shares the small lid between 450 ml and 250 ml jars and keeps lid labels per sauce", () => {
    const r = planProduction(
      input({ targets: { "indiase-tikka-masala-450": 30, "indiase-tikka-masala-250": 20, "liberiaanse-kip-250": 5 } }),
    );
    expect(req(r, "pkg-small-lid").required!.toString()).toBe("55");
    expect(req(r, "pkg-tikka-lid-label-small").required!.toString()).toBe("50");
    expect(req(r, "pkg-liberian-lid-label-small").required!.toString()).toBe("5");
    expect(r.requirements.find((x) => x.itemId === "pkg-large-lid")).toBeUndefined();
  });

  it("adds jars for expected rejects on top of the sellable target", () => {
    const cat = input({ targets: { "liberiaanse-kip-950": 95 } });
    cat.products.find((p) => p.id === "liberiaanse-kip-950")!.reject = { rate: D("0.05"), source: "estimate" };
    const r = planProduction(cat);
    expect(r.products[0]!.jarsToFill).toBe(100);
    expect(req(r, "pkg-liberian-bottle-label-950").required!.toString()).toBe("100");
  });

  it("warns when the reject rate is unknown instead of silently assuming none", () => {
    const r = planProduction(input({ targets: { "liberiaanse-kip-950": 10 } }));
    expect(r.issues.some((i) => i.message.includes("reject rate unknown"))).toBe(true);
  });

  it("does not offer stock reserved by earlier runs, and counts open orders", () => {
    const stock: Record<string, StockPosition> = {
      "pkg-950-ml-container": { onHand: D(100), reservedEarlier: D(70), onOrder: D(5) },
    };
    const r = planProduction(input({ stock, targets: { "indiase-tikka-masala-950": 50 } }));
    const c = req(r, "pkg-950-ml-container");
    expect(c.available!.toString()).toBe("30");
    expect(c.toBuy!.toString()).toBe("15");
    expect(c.status).toBe("short");
  });

  it("an item never counted has unknown coverage, not zero stock", () => {
    const r = planProduction(input({ targets: { "indiase-tikka-masala-950": 1 } }));
    const c = req(r, "pkg-large-lid");
    expect(c.onHand).toBeNull();
    expect(c.toBuy).toBeNull();
    expect(c.status).toBe("unknown");
  });

  it("a product is only packable when every component is in stock", () => {
    const enough = { onHand: D(10), reservedEarlier: D(0), onOrder: D(0) };
    const stock: Record<string, StockPosition> = {
      "pkg-250-ml-container": enough,
      "pkg-small-lid": enough,
      "pkg-tikka-bottle-label-250": enough,
      "pkg-tikka-lid-label-small": { onHand: D(3), reservedEarlier: D(0), onOrder: D(20) },
    };
    const r = planProduction(input({ stock, targets: { "indiase-tikka-masala-250": 10 } }));
    expect(r.products[0]!.packable).toBe(false);
    expect(req(r, "pkg-tikka-lid-label-small").status).toBe("covered"); // covered once the order arrives
  });

  it("rejects targets that are not whole, non-negative jar counts", () => {
    const r = planProduction(input({ targets: { "indiase-tikka-masala-250": 2.5 } }));
    expect(r.issues[0]!.level).toBe("blocker");
    expect(r.requirements).toHaveLength(0);
  });
});
