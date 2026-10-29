import { SHELF_UNITS, SHELF_UNIT_KEYS, type ShelfLife } from "@/domain/shelf-life";
import { setItemShelfLifeAction } from "../settings/actions";

/** A one-line form to change an item's shelf life (number + unit). Empty clears it. */
export function ShelfLifeForm({
  itemId,
  value,
  back,
  label,
  quietUnset = false,
}: {
  itemId: string;
  value: ShelfLife | null;
  back: string;
  label: string;
  quietUnset?: boolean;
}) {
  return (
    <>
      <form action={setItemShelfLifeAction} className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="back" value={back} />
        <input
          name="shelfLife"
          type="number"
          min={1}
          max={3650}
          step={1}
          defaultValue={value?.value ?? ""}
          placeholder="—"
          aria-label={`${label}: number`}
          style={{ width: 70 }}
        />
        <select name="shelfLifeUnit" defaultValue={value?.unit ?? "months"} aria-label={`${label}: unit`}>
          {SHELF_UNIT_KEYS.map((k) => (
            <option key={k} value={k}>
              {SHELF_UNITS[k].many}
            </option>
          ))}
        </select>
        <button type="submit" className="secondary sm">
          Save
        </button>
      </form>
    </>
  );
}
