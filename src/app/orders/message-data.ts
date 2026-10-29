import type { DB } from "@/db/client";
import type { OrderView } from "@/db/purchasing";
import { supplierNaming } from "@/db/suppliers";
import type { OrderMessageInput } from "@/domain/order-message";
import type { UnitCode } from "@/domain/quantity";
import { today } from "@/domain/dates";

/** An order's lines and dates, ready to turn into the supplier's message or printout. */
export async function orderMessageData(d: DB, order: OrderView): Promise<Omit<OrderMessageInput, "withPrices">> {
  const { po, supplier, lines } = order;
  const naming = await supplierNaming(
    d,
    supplier.id,
    lines.map((l) => l.item.id),
  );
  return {
    supplierName: supplier.name,
    code: po.code,
    date: po.orderedOn ?? today(),
    expectedOn: po.expectedOn,
    reference: po.reference,
    lines: lines.map((l) => ({
      name: l.item.name,
      supplierCode: naming.get(l.item.id)?.code ?? null,
      quantity: l.line.quantity,
      unit: l.item.stockUnit as UnitCode,
      packQty: l.line.packQty,
      packs: l.line.packs,
      packName: naming.get(l.item.id)?.packName ?? null,
      unitPrice: l.line.unitPrice,
      packPrice: l.line.packPrice,
    })),
  };
}
