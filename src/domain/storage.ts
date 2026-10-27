/** Where something is kept. Set as a default on each ingredient and product; each lot can differ. */
export const STORAGE = {
  fridge: { label: "Fridge", hint: "0–5 °C" },
  freezer: { label: "Freezer", hint: "−18 °C" },
  room: { label: "Room temperature", hint: "dry, out of the fridge" },
} as const;

export type Storage = keyof typeof STORAGE;
export const STORAGE_KEYS = Object.keys(STORAGE) as Storage[];

export function isStorage(v: unknown): v is Storage {
  return typeof v === "string" && v in STORAGE;
}

export function storageLabel(v: string | null | undefined): string {
  return isStorage(v) ? STORAGE[v].label : "Not set";
}

/** Read a form value: "" means not set; anything else must be a known place. */
export function parseStorage(v: string | null | undefined): Storage | null | "invalid" {
  if (v == null || v === "") return null;
  return isStorage(v) ? v : "invalid";
}
