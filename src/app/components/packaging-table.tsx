import Link from "next/link";
import type { traceBatch } from "@/db/trace";
import { ExpandGroup, expandCss } from "./expand-group";

type Trace = NonNullable<Awaited<ReturnType<typeof traceBatch>>>;

/**
 * Packaging of one batch in one table: a row per size with the batch totals,
 * its finished lot, best-before and jars in stock now; open it to see each
 * packaging session of that size.
 */
export function PackagingTable({ tr, editHref }: { tr: Trace; editHref?: (sessionId: string) => string }) {
  const sizes = tr.jarsBySize.filter((s) => s.filled > 0 || s.rejected > 0);
  if (sizes.length === 0) return <p className="muted" style={{ margin: 0 }}>Nothing packed yet.</p>;
  return (
    <>
      <style>{expandCss}</style>
      <table>
        <thead>
          <tr>
            <th>Size / session</th>
            <th className="num">Filled</th>
            <th className="num">Rejected</th>
            <th className="num">Accepted</th>
            <th>Finished lot</th>
            <th>Best before</th>
            <th className="num">In stock now</th>
          </tr>
        </thead>
        {sizes.map((s) => {
          const lot = s.accepted > 0 ? tr.jarLots.find((l) => l.itemId === s.itemId) : undefined;
          const sessions = tr.sessions
            .flatMap((x) => x.lines.filter((l) => l.product.id === s.productId && (l.line.filled > 0 || l.line.rejected > 0)).map((l) => ({ session: x, line: l.line })))
            .sort((a, b) => a.session.packedOn.localeCompare(b.session.packedOn));
          return (
            <ExpandGroup
              key={s.productId}
              cells={[
                { content: s.name },
                { content: s.filled, num: true },
                { content: s.rejected, num: true },
                { content: s.accepted, num: true },
                { content: lot ? <Link href={`/stock/${lot.itemId}`}>{lot.code}</Link> : "—" },
                { content: lot ? (lot.bestBefore ?? "not recorded") : "—" },
                { content: lot ? `${lot.balance.toString()} jars` : "—", num: true },
              ]}
            >
              {sessions.map(({ session, line }) => (
                <tr key={line.id} className="exp-child">
                  <td>
                    {session.packedOn}
                    {session.note ? ` · ${session.note}` : ""}
                    {editHref && (
                      <>
                        {" "}
                        · <Link href={editHref(session.id)}>Edit or delete</Link>
                      </>
                    )}
                  </td>
                  <td className="num">{line.filled}</td>
                  <td className="num">{line.rejected}</td>
                  <td className="num">{line.accepted}</td>
                  <td />
                  <td />
                  <td />
                </tr>
              ))}
            </ExpandGroup>
          );
        })}
      </table>
      <p className="small muted" style={{ marginBottom: 0 }}>
        Accepted is what was packed and stays as it was. In stock now goes down as jars leave stock (sales, samples, corrections). Open a size (▸) to see each
        packaging session.
      </p>
    </>
  );
}
