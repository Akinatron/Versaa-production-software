import { describe, expect, it } from "vitest";
import { contactChannels, lineQuantity, orderMessage, orderTotal, whatsappHref } from "@/domain/order-message";

const lines = [
  {
    name: "Tomato",
    supplierCode: "TM-25",
    quantity: "100",
    unit: "kg" as const,
    packQty: "25",
    packs: 4,
    packName: "sack",
    unitPrice: "0.5",
    packPrice: "12.5",
  },
  { name: "Lids 70 mm", quantity: "500", unit: "unit" as const, unitPrice: "0.08" },
];

describe("order message", () => {
  it("writes the order in Spanish with packs, codes and the wanted date", () => {
    const text = orderMessage({ lang: "es", supplierName: "Huerta Sur", code: "PO-0007", date: "2026-10-27", expectedOn: "2026-11-03", lines });
    expect(text).toContain("Hola Huerta Sur,");
    expect(text).toContain("Os paso nuestro pedido PO-0007:");
    expect(text).toContain("- Tomato (ref. TM-25): 4 sack × 25 kg (100 kg)");
    expect(text).toContain("- Lids 70 mm: 500 uds");
    expect(text).toContain("Lo necesitaríamos para el 3 de noviembre de 2026.");
    expect(text).not.toContain("€");
  });
  it("adds prices and a total only when asked", () => {
    const text = orderMessage({ lang: "en", supplierName: "X", code: "PO-1", date: "2026-10-27", lines, withPrices: true });
    expect(text).toContain("4 sack × 25 kg (100 kg) · 12.50 € each");
    expect(text).toContain("Approximate total: 90.00 €");
  });
  it("leaves out lines set to zero and has no total when a price is missing", () => {
    const text = orderMessage({
      lang: "en",
      supplierName: "X",
      code: "PO-1",
      date: "2026-10-27",
      lines: [...lines, { name: "Salt", quantity: "0", unit: "kg" }],
    });
    expect(text).not.toContain("Salt");
    expect(orderTotal([...lines, { name: "Salt", quantity: "1", unit: "kg" }])).toBeNull();
  });
  it("names packs generically when the supplier gave no pack name", () => {
    expect(lineQuantity({ name: "Oil", quantity: "20", unit: "L", packQty: "5", packs: 4 }, "es")).toBe("4 paquetes × 5 L (20 L)");
  });
});

describe("supplier contact", () => {
  it("finds an email and a phone in free text", () => {
    expect(contactChannels("Ana · ana@huerta.es · 612 34 56 78")).toEqual({ email: "ana@huerta.es", phone: "34612345678" });
    expect(contactChannels("+44 7700 900123")).toEqual({ email: null, phone: "447700900123" });
    expect(contactChannels("0034 612345678").phone).toBe("34612345678");
    expect(contactChannels("call Ana")).toEqual({ email: null, phone: null });
    expect(contactChannels(null)).toEqual({ email: null, phone: null });
  });
  it("builds a WhatsApp link with the text", () => {
    expect(whatsappHref("34612345678", "Hola\nPedido")).toBe("https://wa.me/34612345678?text=Hola%0APedido");
  });
});
