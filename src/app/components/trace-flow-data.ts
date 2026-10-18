import { db } from "@/db/client";
import { traceBatch, traceForward, type LotSummary } from "@/db/trace";
import { OUTFLOW } from "./labels";
import { jars, lotQty, who } from "./trace-format";
import type { FlowColumn, FlowEdge, FlowNode } from "./trace-flow";

/** Where a lot came from, shown as the first node of the diagram. */
function originOf(lot: LotSummary): { id: string; label: string; sub?: string } {
  if (lot.code.startsWith("OPEN-")) return { id: "origin:opening", label: "Opening count" };
  if (lot.code.startsWith("COUNT-")) return { id: "origin:count", label: "Found in a stock count" };
  return lot.supplierName
    ? { id: `origin:${lot.supplierName}`, label: lot.supplierName, sub: "Supplier" }
    : { id: "origin:unknown", label: "Supplier not recorded" };
}

/**
 * The whole path of one lot as columns of nodes and the links between them:
 * supplier → ingredient lot → batch → jar lots → where the jars went.
 * A lot made here (jars, bulk sauce) is traced back through its batch.
 */
export async function lotFlow(lotId: string): Promise<{ columns: FlowColumn[]; edges: FlowEdge[] } | null> {
  const fw = await traceForward(db(), lotId);
  if (!fw) return null;
  const { lot, jarLots, destinations } = fw;
  const edges: FlowEdge[] = [];
  const origins = new Map<string, FlowNode>();
  const inputs: FlowNode[] = [];
  const batches: FlowNode[] = [];

  if (lot.batchId) {
    // Made here: go back through the batch to the ingredient lots and their suppliers.
    const b = await traceBatch(db(), lot.batchId);
    if (b) {
      const batchId = `batch:${b.batch.id}`;
      batches.push({ id: batchId, label: b.batch.code, sub: b.sauce.name, href: `/batches/${b.batch.id}` });
      const used = new Map<string, { lot: LotSummary; name: string }>();
      for (const u of b.ingredientUse) for (const s of u.sources) used.set(s.lot.id, { lot: s.lot, name: u.name });
      for (const { lot: l, name } of [...used.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        const o = originOf(l);
        if (!origins.has(o.id)) origins.set(o.id, o);
        inputs.push({ id: `lot:${l.id}`, label: name, sub: l.code, href: `/trace/lot/${l.id}` });
        edges.push({ from: o.id, to: `lot:${l.id}` }, { from: `lot:${l.id}`, to: batchId });
      }
    }
  } else {
    // Bought: one supplier, this lot, and the batches that used it.
    const o = originOf(lot);
    origins.set(o.id, o);
    inputs.push({ id: `lot:${lot.id}`, label: lot.itemName, sub: lot.code, focus: true });
    edges.push({ from: o.id, to: `lot:${lot.id}` });
    for (const b of fw.batches) {
      batches.push({ id: `batch:${b.batchId}`, label: b.code, sub: `${lotQty(b.quantity, lot.unit, lot.itemKind)} used`, href: `/batches/${b.batchId}` });
      edges.push({ from: `lot:${lot.id}`, to: `batch:${b.batchId}` });
    }
  }

  const jarNodes: FlowNode[] = jarLots.map((l) => {
    if (l.batchId) edges.push({ from: `batch:${l.batchId}`, to: `lot:${l.id}` });
    return {
      id: `lot:${l.id}`,
      label: l.itemName,
      sub: `${l.code} · ${jars(l.balance)} in stock`,
      href: l.id === lot.id ? undefined : `/trace/lot/${l.id}`,
      focus: l.id === lot.id,
    };
  });

  // Destinations, grouped by who received them; the link carries the jar count.
  const dest = new Map<string, FlowNode & { jars: number }>();
  for (const d of destinations) {
    const named = who(d.customer, d.destination);
    const label = named !== "—" ? named : d.type === "sale" ? "No destination recorded" : (OUTFLOW[d.type] ?? d.type);
    const id = `dest:${d.type}|${label}`;
    const cur = dest.get(id) ?? { id, label, sub: "", jars: 0 };
    cur.jars += d.jars;
    cur.sub = `${jars(cur.jars)}${d.type !== "sale" && label !== OUTFLOW[d.type] ? ` · ${OUTFLOW[d.type] ?? d.type}` : ""}`;
    dest.set(id, cur);
    if (!edges.some((e) => e.from === `lot:${d.lotId}` && e.to === id)) edges.push({ from: `lot:${d.lotId}`, to: id });
  }

  const columns: FlowColumn[] = [
    { key: "origin", title: "Supplier", nodes: [...origins.values()] },
    { key: "inputs", title: lot.batchId ? "Ingredient lots" : "This lot", nodes: inputs },
    { key: "batches", title: "Batch", nodes: batches, empty: "Not used in a batch yet" },
    { key: "jars", title: "Jar lots", nodes: jarNodes, empty: "No jars packed yet" },
    { key: "out", title: "Where the jars went", nodes: [...dest.values()].map(({ jars: _, ...n }) => n), empty: "No jars out yet" },
  ];
  return { columns, edges };
}
