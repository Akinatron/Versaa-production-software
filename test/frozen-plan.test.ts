import { afterAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { confirmRun, createRun, planForRun, recordOpeningCount } from "@/db/operations";
import { loadPlanCatalog } from "@/db/planning";
import { freezePlan, frozenPlan, thawPlan } from "@/db/frozen-plan";
import type { PlanResult } from "@/domain/planner";
import { freshDb, testDbUrl } from "./helpers";

/* A run's frozen plan is read back as numbers, not as the text it is saved as. */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

describe("frozen plan", () => {
  it("comes back with numbers that add up", () => {
    const plan: PlanResult = {
      issues: [],
      products: [{ productId: "p", name: "Jar", targetJars: 10, rejectRate: new Decimal("0.02"), rejectSource: "estimate", jarsToFill: 11, packable: true }],
      sauces: [
        {
          sauceId: "s",
          name: "Kip",
          litresNeeded: new Decimal("7.7"),
          litresPerBatch: new Decimal(30),
          yieldSource: "estimate",
          batches: 1,
          surplusLitres: null,
          recipeVersionNo: 1,
        },
      ],
      requirements: [
        {
          itemId: "i",
          name: "Onions",
          kind: "ingredient",
          unit: "kg",
          required: new Decimal("10"),
          contributions: [{ from: "Kip", quantity: new Decimal("10") }],
          onHand: null,
          reservedEarlier: new Decimal(0),
          available: null,
          onOrder: new Decimal("5"),
          toBuy: null,
          status: "unknown",
        },
      ],
    };
    const saved = freezePlan(plan) as { requirements: { onOrder: unknown }[] };
    expect(saved.requirements[0]!.onOrder).toBe("5");
    const back = thawPlan(saved);
    const r = back.requirements[0]!;
    expect(r.required!.plus(r.onOrder).toString()).toBe("15");
    expect(r.onHand).toBeNull();
    expect(r.stillToUse).toBeUndefined();
    expect(back.sauces[0]!.litresNeeded.plus(1).toString()).toBe("8.7");
    expect(back.sauces[0]!.surplusLitres).toBeNull();
    expect(back.products[0]!.rejectRate!.mul(100).toString()).toBe("2");
  });

  it.skipIf(!testDbUrl)("is the plan of the day the run was confirmed", async () => {
    const db = await freshDb();
    dbs.push(db);
    const ids: Record<string, string> = {};
    for (const p of await db.select().from(t.products)) ids[p.name] = p.id;
    for (const s of await db.select().from(t.sauces)) ids[s.code] = s.id;
    await db.insert(t.yieldFigures).values({ sauceId: ids["liberiaanse-kip"]!, litresPerBatch: "30", source: "estimate" });
    const kip = (await loadPlanCatalog(db)).sauces.find((s) => s.id === ids["liberiaanse-kip"])!;
    await recordOpeningCount(db, {
      idempotencyKey: "open",
      countedOn: "2026-10-17",
      lines: kip.recipe!.lines.map((l) => ({ itemId: l.itemId, quantity: "1000" })),
    });
    const run = await createRun(db, { idempotencyKey: "run", plannedFor: "2026-10-20", targets: { [ids["Liberiaanse Kip 950 ml"]!]: 60 } });
    expect(await frozenPlan(db, run.id)).toBeNull();
    const before = await planForRun(db, run.id);
    await confirmRun(db, run.id);
    const frozen = (await frozenPlan(db, run.id))!;
    expect(frozen.sauces[0]!.litresNeeded).toBeInstanceOf(Decimal);
    expect(frozen.sauces[0]!.litresNeeded.toString()).toBe(before.sauces[0]!.litresNeeded.toString());
    const onions = frozen.requirements.find((r) => r.name === "Onions")!;
    expect(onions.required!.eq(before.requirements.find((r) => r.name === "Onions")!.required!)).toBe(true);
    const [snap] = await db.select().from(t.forecastSnapshots).where(eq(t.forecastSnapshots.runId, run.id));
    expect(typeof (snap!.data as { sauces: { litresNeeded: unknown }[] }).sauces[0]!.litresNeeded).toBe("string");
  });
});
