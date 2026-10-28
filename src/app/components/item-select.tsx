import { UNITS, type UnitCode } from "@/domain/quantity";

export interface ItemOption {
  id: string;
  name: string;
  kind: string;
  stockUnit: UnitCode;
}

/** Item dropdown grouped into ingredients, packaging and other items, with the stock unit shown. */
export function ItemSelect({ name, items, defaultValue }: { name: string; items: ItemOption[]; defaultValue?: string }) {
  const groups = [
    ["Ingredients", items.filter((i) => i.kind === "ingredient")],
    ["Packaging", items.filter((i) => i.kind === "packaging")],
    ["Other", items.filter((i) => i.kind === "other")],
  ] as const;
  return (
    <select name={name} defaultValue={defaultValue ?? ""} aria-label="Item">
      <option value="">—</option>
      {groups.map(([label, list]) => (
        <optgroup key={label} label={label}>
          {[...list]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({UNITS[i.stockUnit].label})
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Collect numbered form rows (field_0, field_1, …) into objects. */
export function rows(form: FormData, fields: string[]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (let i = 0; i < 200; i++) {
    if (!form.has(`${fields[0]}_${i}`)) break;
    out.push(Object.fromEntries(fields.map((f) => [f, String(form.get(`${f}_${i}`) ?? "").trim()])));
  }
  return out;
}
