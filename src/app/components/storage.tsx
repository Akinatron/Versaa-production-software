import { STORAGE, STORAGE_KEYS, isStorage } from "@/domain/storage";
import { setItemStorageAction } from "../settings/actions";

/** Where something is kept, as a small label. "Not set" shows as a warning so it gets filled in. */
export function StorageBadge({ value, quietUnset = false }: { value: string | null | undefined; quietUnset?: boolean }) {
  if (!isStorage(value)) return quietUnset ? <span className="muted">Not set</span> : <span className="badge warn">Storage not set</span>;
  return <span className={`badge ${value === "room" ? "neutral" : "info"}`}>{STORAGE[value].label}</span>;
}

/** The options of a storage select. `unset` adds a "Not set" choice. */
export function StorageOptions({ unset = true }: { unset?: boolean }) {
  return (
    <>
      {unset && <option value="">Not set</option>}
      {STORAGE_KEYS.map((k) => (
        <option key={k} value={k}>
          {STORAGE[k].label}
        </option>
      ))}
    </>
  );
}

/** A one-line form to change an item's default storage. */
export function ItemStorageForm({ itemId, value, back, label }: { itemId: string; value: string | null; back: string; label: string }) {
  return <ItemStorageSelect itemId={itemId} value={value} back={back} label={label} />;
}

function ItemStorageSelect({ itemId, value, back, label }: { itemId: string; value: string | null; back: string; label: string }) {
  return (
    <form action={setItemStorageAction} className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="back" value={back} />
      <select name="storage" defaultValue={value ?? ""} aria-label={label} style={{ minWidth: 150 }}>
        <StorageOptions />
      </select>
      <button type="submit" className="secondary sm">
        Save
      </button>
    </form>
  );
}
