/** A sauce name with its colour dot. `chip` adds a soft tinted background for headers. */
export function SauceName({ name, color, chip }: { name: string; color?: string | null; chip?: boolean }) {
  return <span className={`sauce sc-${color ?? "slate"}${chip ? " chip" : ""}`}>{name}</span>;
}
