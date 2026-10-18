import { describe, it, expect } from "vitest";
import { demandFromOrders } from "@/domain/demand";

describe("plan from sales orders", () => {
  const lines = [
    { orderId: "a", productId: "p1", jars: 40, deliverBy: "2026-10-20" },
    { orderId: "a", productId: "p2", jars: 10, deliverBy: "2026-10-20" },
    { orderId: "b", productId: "p1", jars: 30, deliverBy: "2026-11-15" },
    { orderId: "c", productId: "p1", jars: 5, deliverBy: null },
  ];

  it("subtracts stock and jars coming from runs, never below zero", () => {
    const r = demandFromOrders({ lines, inStock: { p1: 20, p2: 15 }, inRuns: { p1: 10 }, until: null });
    expect(r.lines.find((l) => l.productId === "p1")).toMatchObject({ ordered: 75, inStock: 20, inRuns: 10, toMake: 45 });
    expect(r.lines.find((l) => l.productId === "p2")!.toMake).toBe(0);
    expect(r.targets).toEqual({ p1: 45 });
    expect(r.ordersCounted).toBe(3);
    expect(r.ordersLater).toBe(0);
  });

  it("leaves out orders due after the date, but keeps orders with no date", () => {
    const r = demandFromOrders({ lines, inStock: {}, inRuns: {}, until: "2026-10-31" });
    expect(r.targets).toEqual({ p1: 45, p2: 10 });
    expect(r.ordersCounted).toBe(2);
    expect(r.ordersLater).toBe(1);
  });

  it("proposes nothing when stock covers everything", () => {
    const r = demandFromOrders({ lines, inStock: { p1: 100, p2: 100 }, inRuns: {}, until: null });
    expect(r.targets).toEqual({});
  });
});
