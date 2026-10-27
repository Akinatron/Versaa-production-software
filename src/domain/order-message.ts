import Decimal from "decimal.js";
import { money } from "./pricing";
import { formatQty, type UnitCode } from "./quantity";

/**
 * The text of a purchase order as sent to a supplier: pasted into an email
 * or WhatsApp, or printed. The app never sends it by itself.
 */

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
  supplierName: string;
  code: string;
  /** ISO date the order is dated (sent date, or today for a draft). */
  date: string;
  expectedOn?: string | null;
  reference?: string | null;
  lines: OrderMessageLine[];
  withPrices?: boolean;
  /** Who signs it. */
  from?: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "3 November 2026". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
}

/** Quantity as the supplier sells it: "4 sacks × 25 kg (100 kg)" or "100 kg". */
export function lineQuantity(l: OrderMessageLine): string {
  const total = formatQty(new Decimal(l.quantity), l.unit);
  if (l.packQty && l.packs !== null && l.packs !== undefined) {
    const size = formatQty(new Decimal(l.packQty), l.unit);
    return `${l.packs} ${l.packName?.trim() || "packs"} × ${size} (${total})`;
  }
  return total;
}

/** "12.50 € each" for a pack, "3.20 €/kg" per stock unit. */
export function linePrice(l: OrderMessageLine): string | null {
  if (l.packQty && l.packPrice) return `${money(new Decimal(l.packPrice))} each`;
  if (l.unitPrice) return `${money(new Decimal(l.unitPrice))}/${l.unit}`;
  return null;
}

/** Total of the lines, or null when any line has no price. */
export function orderTotal(lines: OrderMessageLine[]): Decimal | null {
  if (lines.some((l) => !l.unitPrice)) return null;
  return lines.reduce((s, l) => s.plus(new Decimal(l.quantity).mul(l.unitPrice!)), new Decimal(0));
}

export function orderMessage(o: OrderMessageInput): string {
  const out: string[] = [`Hello ${o.supplierName},`, "", `Here is our order ${o.code}:`, ""];
  for (const l of o.lines) {
    if (new Decimal(l.quantity).lte(0)) continue;
    let row = `- ${l.name}${l.supplierCode ? ` (code ${l.supplierCode})` : ""}: ${lineQuantity(l)}`;
    if (o.withPrices) {
      const p = linePrice(l);
      if (p) row += ` · ${p}`;
    }
    out.push(row);
  }
  if (o.withPrices) {
    const total = orderTotal(o.lines);
    if (total) out.push("", `Approximate total: ${money(total)}`);
  }
  const extra: string[] = [];
  if (o.expectedOn) extra.push(`We would need it by ${longDate(o.expectedOn)}.`);
  if (o.reference) extra.push(`Your reference: ${o.reference}`);
  if (extra.length) out.push("", ...extra);
  out.push("", "Could you confirm you received it and the delivery date? Thank you.", "", o.from ?? "Versaa");
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
