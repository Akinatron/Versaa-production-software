"use client";

import { useMemo, useRef, useState } from "react";
import { contactChannels, mailtoHref, orderMessage, whatsappHref, type OrderMessageInput } from "@/domain/order-message";

type Props = {
  poId: string;
  contact: string | null;
  order: Omit<OrderMessageInput, "withPrices">;
};

/**
 * The order as a message for the supplier: copy it into an email or
 * WhatsApp, open it there directly, or print it / save it as a PDF.
 * Nothing is sent by the app.
 */
export function SendOrder({ poId, contact, order }: Props) {
  const [withPrices, setWithPrices] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const text = useMemo(() => orderMessage({ ...order, withPrices }), [order, withPrices]);
  const { email, phone } = contactChannels(contact);
  const subject = `Order ${order.code}`;

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
        <a className="btn secondary" href={`/orders/${poId}/print${withPrices ? "?prices=1" : ""}`} target="_blank" rel="noreferrer">
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
