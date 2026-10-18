/**
 * The items of an order, folded: "16 items" with the first names as a hint.
 * Open it to see every line; the full detail lives on the order's own page.
 */
export function OrderItems({ lines }: { lines: { id: string; text: string; note?: string | null }[] }) {
  if (lines.length === 0) return <span className="muted">No items</span>;
  const names = lines.slice(0, 2).map((l) => l.text.split(":")[0]);
  const hint = lines.length > 2 ? `${names.join(", ")} and ${lines.length - 2} more` : names.join(", ");
  return (
    <details className="items-fold">
      <summary>
        <span>{lines.length === 1 ? "1 item" : `${lines.length} items`}</span>
        <span className="muted">{hint}</span>
      </summary>
      <ul>
        {lines.map((l) => (
          <li key={l.id}>
            {l.text}
            {l.note && <span className="muted"> · {l.note}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
