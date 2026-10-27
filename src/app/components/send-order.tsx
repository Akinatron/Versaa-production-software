"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { contactChannels, mailtoHref, orderMessage, whatsappHref, type OrderLang, type OrderMessageInput } from "@/domain/order-message";

type Props = {
  poId: string;
  supplierId: string;
  contact: string | null;
  order: Omit<OrderMessageInput, "lang" | "withPrices">;
};

const LANGS: { code: OrderLang; label: string }[] = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
];

const langKey = (supplierId: string) => `versaa.orderLang.${supplierId}`;

/**
 * The order as a message for the supplier: copy it into an email or
 * WhatsApp, open it there directly, or print it / save it as a PDF.
 * Nothing is sent by the app.
 */
export function SendOrder({ poId, supplierId, contact, order }: Props) {
  const [lang, setLang] = useState<OrderLang>("es");
  const [withPrices, setWithPrices] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  // Each supplier keeps the language last used with it (this browser only).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(langKey(supplierId));
      if (saved === "es" || saved === "en") setLang(saved);
    } catch {}
  }, [supplierId]);
  const pickLang = (l: OrderLang) => {
    setLang(l);
    try {
      localStorage.setItem(langKey(supplierId), l);
    } catch {}
  };

  const text = useMemo(() => orderMessage({ ...order, lang, withPrices }), [order, lang, withPrices]);
  const { email, phone } = contactChannels(contact);
  const subject = lang === "es" ? `Pedido ${order.code}` : `Order ${order.code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      box.current?.select();
      document.execCommand("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="send-order">
      <div className="row" style={{ alignItems: "center", gap: 10 }}>
        <div className="tabs" role="group" aria-label="Language" style={{ margin: 0 }}>
          {LANGS.map((l) => (
            <button key={l.code} type="button" className={lang === l.code ? "on" : undefined} aria-pressed={lang === l.code} onClick={() => pickLang(l.code)}>
              {l.label}
            </button>
          ))}
        </div>
        <label className="small" style={{ display: "inline-flex", gap: 6, alignItems: "center", margin: 0 }}>
          <input type="checkbox" checked={withPrices} onChange={(e) => setWithPrices(e.target.checked)} />
          Include prices
        </label>
      </div>
      <textarea
        ref={box}
        readOnly
        value={text}
        rows={Math.min(18, text.split("\n").length + 1)}
        aria-label="Order text"
        style={{ marginTop: 10, fontFamily: "inherit" }}
      />
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button type="button" className="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy text"}
        </button>
        {email && (
          <a className="btn secondary" href={mailtoHref(email, subject, text)} target="_blank" rel="noreferrer">
            Open in email
          </a>
        )}
        {phone && (
          <a className="btn secondary" href={whatsappHref(phone, text)} target="_blank" rel="noreferrer">
            Open in WhatsApp
          </a>
        )}
        <a className="btn secondary" href={`/orders/${poId}/print?lang=${lang}${withPrices ? "&prices=1" : ""}`} target="_blank" rel="noreferrer">
          Print or save as PDF
        </a>
      </div>
      {!email && !phone && (
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          Add an email or phone number to the supplier&apos;s contact to open the order straight in email or WhatsApp.
        </p>
      )}
    </div>
  );
}
