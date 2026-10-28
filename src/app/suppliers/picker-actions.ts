"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import * as t from "@/db/schema";
import { addSupplier, OperationError } from "@/db/operations";
import { addItem } from "@/db/catalog";
import { isBoughtKind } from "@/domain/item-kinds";
import { UNITS, type UnitCode } from "@/domain/quantity";
import { isStorage } from "@/domain/storage";
import { asUser } from "../components/flash";

/*
 * "Create …" from the search boxes on the supplier and item cards. Called
 * from the page itself, so they answer with the new record (or the reason it
 * wasn't made) instead of going to another page.
 */

type Created = { ok: true; id: string; label: string; hint?: string; group?: string } | { ok: false; error: string };

async function run(fn: () => Promise<Created>): Promise<Created> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof OperationError) return { ok: false, error: e.message };
    throw e;
  }
}

function refresh() {
  revalidatePath("/settings", "layout");
  revalidatePath("/suppliers", "layout");
  revalidatePath("/items", "layout");
  revalidatePath("/stock", "layout");
}

/** A new ingredient, packaging or other item. Everything is chosen by the person: nothing is assumed. */
export async function createItemFromPicker(input: { kind: string; name: string; stockUnit: string; storage: string | null }): Promise<Created> {
  return run(async () => {
    const kind = input.kind;
    if (!isBoughtKind(kind)) throw new OperationError("Choose what it is: Ingredient, Packaging or Other.");
    if (!(input.stockUnit in UNITS)) throw new OperationError("Choose how it is counted.");
    if (kind === "ingredient" && !isStorage(input.storage)) throw new OperationError("Choose where it is kept.");
    const item = await asUser(() =>
      addItem(db(), { kind, name: input.name, stockUnit: input.stockUnit, storage: kind === "ingredient" ? input.storage : null }),
    );
    refresh();
    return {
      ok: true,
      id: item.id,
      label: item.name,
      hint: UNITS[item.stockUnit as UnitCode].label,
      group: kind === "ingredient" ? "Ingredients" : kind === "packaging" ? "Packaging" : "Other",
    };
  });
}

/** A new supplier with only its name; the rest is filled in on its card. */
export async function createSupplierFromPicker(name: string): Promise<Created> {
  return run(async () => {
    const [dup] = await db()
      .select()
      .from(t.suppliers)
      .where(sql`lower(${t.suppliers.name}) = lower(${name.trim()})`);
    if (dup) throw new OperationError(`${dup.name} already exists${dup.active ? "" : " (marked as not in use)"}.`);
    const s = await asUser(() => addSupplier(db(), { name }));
    refresh();
    return { ok: true, id: s.id, label: s.name };
  });
}
