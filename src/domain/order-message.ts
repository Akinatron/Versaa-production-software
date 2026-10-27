import Decimal from "decimal.js";
import { money } from "./pricing";
import { formatQty, type UnitCode } from "./quantity";

/**
 * The text of a purchase order as sent to a supplier: pasted into an email
 * or WhatsApp, or printed. The app never sends it by itself.
 */

export type OrderLang = "es" | "en";

export interface OrderMessageLine {
  name: string;
  /** The supplier's own code for the item, when known. */
  supplierCode?: string | null;
  /** Ordered quantity in the item's stock unit. */
  quantity: Decimal.Value;
  unit: UnitCode;
  /** When bought in packs: pack size (in the stock unit) and number of packs. */
  packQty?: Decimal.Value | null;
  packs?: number | null;
  /** e.g. "sack", "box". */
  packName?: string | null;
  /** Price per stock unit. */
  unitPrice?: Decimal.Value | null;
  packPrice?: Decimal.Value | null;
}

export interface OrderMessageInput {
  lang: OrderLang;
  supplierName: string;
  code: string;
  /** ISO date the order is dated (sent date, or today for a draft). */
  date: string;
  expectedOn?: string | null;
  reference?: string | null;
  note?: string | null;
  lines: OrderMessageLine[];
  withPrices?: boolean;
  /** Who signs it. */
  from?: string;
}

const WORDS = {
  es: {
    hello: (s: string) => `Hola ${s},`,
    intro: (code: string) => `Os paso nuestro pedido ${code}:`,
    by: (d: string) => `Lo necesitaríamos para el ${d}.`,
    ref: (r: string) => `Vuestra referencia: ${r}`,
    total: "Total aproximado",
    thanks: "¿Nos confirmáis la recepción y la fecha de entrega? Gracias.",
    code: "ref.",
    each: "c/u",
    pack: "paquetes",
  },
  en: {
    hello: (s: string) => `Hello ${s},`,
    intro: (code: string) => `Here is our order ${code}:`,
    by: (d: string) => `We would need it by ${d}.`,
    ref: (r: string) => `Your reference: ${r}`,
    total: "Approximate total",
    thanks: "Could you confirm you received it and the delivery date? Thank you.",
    code: "code",
    each: "each",
    pack: "packs",
  },
} as const;

const MONTHS = {
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

/** "3 de noviembre de 2026" / "3 November 2026". */
export function longDate(iso: string, lang: OrderLang): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const month = MONTHS[lang][m! - 1];
  return lang === "es" ? `${d} de ${month} de ${y}` : `${d} ${month} ${y}`;
}

/** Quantity as the supplier sells it: "4 sacks × 25 kg (100 kg)" or "100 kg". */
export function lineQuantity(l: OrderMessageLine, lang: OrderLang): string {
  const qty = (v: Decimal.Value) => {
    const s = formatQty(new Decimal(v), l.unit);
    return lang === "es" && l.unit === "unit" ? s.replace(/ units$/, " uds") : s;
  };
  const total = qty(l.quantity);
  if (l.packQty && l.packs !== null && l.packs !== undefined) {
    const size = qty(l.packQty);
    const name = l.packName?.trim() || WORDS[lang].pack;
    return `${l.packs} ${name} × ${size} (${total})`;
  }
  return total;
}

function linePrice(l: OrderMessageLine, lang: OrderLang): string | null {
  if (l.packQty && l.packPrice) return `${money(new Decimal(l.packPrice))} ${WORDS[lang].each}`;
  if (l.unitPrice) return `${money(new Decimal(l.unitPrice))}/${l.unit === "unit" ? (lang === "es" ? "ud" : "unit") : l.unit}`;
  return null;
}

/** Total of the lines, or null when any line has no price. */
export function orderTotal(lines: OrderMessageLine[]): Decimal | null {
  if (lines.some((l) => !l.unitPrice)) return null;
  return lines.reduce((s, l) => s.plus(new Decimal(l.quantity).mul(l.unitPrice!)), new Decimal(0));
}

export function orderMessage(o: OrderMessageInput): string {
  const w = WORDS[o.lang];
  const out: string[] = [w.hello(o.supplierName), "", w.intro(o.code), ""];
  for (const l of o.lines) {
    if (new Decimal(l.quantity).lte(0)) continue;
    let row = `- ${l.name}${l.supplierCode ? ` (${w.code} ${l.supplierCode})` : ""}: ${lineQuantity(l, o.lang)}`;
    if (o.withPrices) {
      const p = linePrice(l, o.lang);
      if (p) row += ` · ${p}`;
    }
    out.push(row);
  }
  if (o.withPrices) {
    const total = orderTotal(o.lines);
    if (total) out.push("", `${w.total}: ${money(total)}`);
  }
  const extra: string[] = [];
  if (o.expectedOn) extra.push(w.by(longDate(o.expectedOn, o.lang)));
  if (o.reference) extra.push(w.ref(o.reference));
  if (o.note?.trim()) extra.push(o.note.trim());
  if (extra.length) out.push("", ...extra);
  out.push("", w.thanks, "", o.from ?? "Versaa");
  return out.join("\n");
}

/**
 * Pulls an email address and a phone number out of a supplier's free-text
 * contact field, for "Open in email" and "Open in WhatsApp".
 */
export function contactChannels(contact: string | null | undefined): { email: string | null; phone: string | null } {
  const text = contact ?? "";
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  let phone: string | null = null;
  for (const m of text.matchAll(/\+?\d[\d\s().-]{7,}\d/g)) {
    const plus = m[0].trim().startsWith("+");
    let digits = m[0].replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (!plus && digits.length === 9) digits = `34${digits}`; // Spanish number without prefix
    if (digits.length >= 10 && digits.length <= 15) {
      phone = digits;
      break;
    }
  }
  return { email, phone };
}

export function mailtoHref(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function whatsappHref(phone: string, body: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
}
