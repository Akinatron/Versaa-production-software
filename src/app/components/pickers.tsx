"use client";

/*
 * The two search boxes of the supplier ↔ item cards: pick an item on a
 * supplier's card, or a supplier on an item's card, and create one in place
 * when it doesn't exist yet.
 */
import { useState, useTransition } from "react";
import { SearchPicker, type PickOption } from "./search-picker";
import { createItemFromPicker, createSupplierFromPicker } from "../suppliers/picker-actions";

type Kind = "ingredient" | "packaging" | "other";
type Unit = "kg" | "g" | "L" | "ml" | "unit";

const KINDS: { key: Kind; label: string }[] = [
  { key: "ingredient", label: "Ingredient" },
  { key: "packaging", label: "Packaging" },
  { key: "other", label: "Other" },
];
const UNIT_LABEL: Record<Unit, string> = { kg: "kg", g: "g", L: "L", ml: "ml", unit: "units" };
// Packaging is always counted in pieces; ingredients by weight or volume; other items any way.
const UNITS_FOR: Record<Kind, Unit[]> = { ingredient: ["kg", "g", "L", "ml"], packaging: ["unit"], other: ["kg", "g", "L", "ml", "unit"] };
const PLACES = [
  { key: "fridge", label: "Fridge", phrase: "in the fridge" },
  { key: "freezer", label: "Freezer", phrase: "in the freezer" },
  { key: "room", label: "Room temperature", phrase: "at room temperature" },
] as const;

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="choice-row" role="radiogroup" aria-label={label}>
      <span className="choice-label">{label}</span>
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} className="choice-chip" onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NewItem({ initialName, done }: { initialName: string; done: (created: PickOption | null) => void }) {
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState<Kind | null>(null);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [place, setPlace] = useState<(typeof PLACES)[number]["key"] | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const units = kind ? UNITS_FOR[kind] : [];
  const ready = name.trim() !== "" && kind !== null && unit !== null && units.includes(unit) && (kind !== "ingredient" || place !== null);
  const what = kind === "ingredient" ? "ingredient" : kind === "packaging" ? "packaging item" : kind === "other" ? "other item" : "item";
  const summary = [
    `New ${what} ${name.trim() || "…"}`,
    unit && units.includes(unit) ? `counted in ${UNIT_LABEL[unit]}` : null,
    kind === "ingredient" && place ? `kept ${PLACES.find((p) => p.key === place)!.phrase}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  function pickKind(k: Kind) {
    setKind(k);
    // The only way to count packaging: choosing it is choosing units.
    setUnit(UNITS_FOR[k].length === 1 ? UNITS_FOR[k][0]! : unit && UNITS_FOR[k].includes(unit) ? unit : null);
  }

  function create() {
    setError(undefined);
    start(async () => {
      const r = await createItemFromPicker({ kind: kind!, name, stockUnit: unit!, storage: kind === "ingredient" ? place : null });
      if (r.ok) done({ id: r.id, label: r.label, hint: r.hint, group: r.group });
      else setError(r.error);
    });
  }

  return (
    <div className="new-record" role="group" aria-label="New item">
      <strong>New item</strong>
      <div>
        <label htmlFor="new-item-name">Name</label>
        <input
          id="new-item-name"
          type="text"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // Enter here must not send the supplier form around this box.
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (ready && !pending) create();
          }}
          style={{ maxWidth: 320 }}
        />
      </div>
      <Choice label="What is it?" options={KINDS} value={kind} onChange={pickKind} />
      {kind && <Choice label="Counted in" options={units.map((u) => ({ key: u, label: UNIT_LABEL[u] }))} value={unit} onChange={setUnit} />}
      {kind === "packaging" && <p className="small muted">Packaging is always counted in units (pieces).</p>}
      {kind === "ingredient" && <Choice label="Kept in" options={PLACES.map((p) => ({ key: p.key, label: p.label }))} value={place} onChange={setPlace} />}
      <p className="new-record-summary">{summary}.</p>
      {error && <p className="small text-bad">{error}</p>}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" onClick={create} disabled={!ready || pending} className={pending ? "is-pending" : undefined}>
          Create and select
        </button>
        <button type="button" className="secondary" onClick={() => done(null)} disabled={pending}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function NewSupplier({ initialName, done }: { initialName: string; done: (created: PickOption | null) => void }) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  function create() {
    setError(undefined);
    start(async () => {
      const r = await createSupplierFromPicker(name);
      if (r.ok) done({ id: r.id, label: r.label });
      else setError(r.error);
    });
  }
  return (
    <div className="new-record" role="group" aria-label="New supplier">
      <strong>New supplier</strong>
      <div>
        <label htmlFor="new-supplier-name">Name</label>
        <input
          id="new-supplier-name"
          type="text"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (name.trim() && !pending) create();
          }}
          style={{ maxWidth: 320 }}
        />
      </div>
      <p className="small muted">Contact details and notes can be added on the supplier&apos;s page afterwards.</p>
      {error && <p className="small text-bad">{error}</p>}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" onClick={create} disabled={!name.trim() || pending} className={pending ? "is-pending" : undefined}>
          Create and select
        </button>
        <button type="button" className="secondary" onClick={() => done(null)} disabled={pending}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** On a supplier's card: find the item it sells, or create it. */
export function ItemPicker({ items }: { items: PickOption[] }) {
  return (
    <SearchPicker
      name="itemId"
      label="Item (required)"
      options={items}
      placeholder="Type to search…"
      createLabel={(t) => `Create "${t}"`}
      renderCreate={(t, done) => <NewItem initialName={t} done={done} />}
    />
  );
}

/** On an item's card: find the supplier that sells it, or create it. */
export function SupplierPicker({ suppliers }: { suppliers: PickOption[] }) {
  return (
    <SearchPicker
      name="supplierId"
      label="Supplier (required)"
      options={suppliers}
      placeholder="Type to search…"
      createLabel={(t) => `Create supplier "${t}"`}
      renderCreate={(t, done) => <NewSupplier initialName={t} done={done} />}
    />
  );
}
