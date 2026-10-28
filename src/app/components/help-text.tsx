import Link from "next/link";
import { linkHref, parseInline } from "@/help/inline";
import { STAGES, type Block, type StageKey } from "@/help/types";

/** One line of help text, with its bold, code and links. */
export function HelpInline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((p, i) =>
        p.t === "b" ? (
          <strong key={i}>{p.v}</strong>
        ) : p.t === "code" ? (
          <code key={i}>{p.v}</code>
        ) : p.t === "link" ? (
          <Link key={i} href={linkHref(p.href)}>
            {p.v}
          </Link>
        ) : (
          <span key={i}>{p.v}</span>
        ),
      )}
    </>
  );
}

export function HelpBlock({ block }: { block: Block }) {
  if (typeof block === "string")
    return (
      <p>
        <HelpInline text={block} />
      </p>
    );
  if ("h" in block) return <h3>{block.h}</h3>;
  if ("ul" in block)
    return (
      <ul className="help-list">
        {block.ul.map((x, i) => (
          <li key={i}>
            <HelpInline text={x} />
          </li>
        ))}
      </ul>
    );
  if ("ol" in block) return <HelpSteps steps={block.ol} />;
  if ("note" in block)
    return (
      <p className="help-note">
        <HelpInline text={block.note} />
      </p>
    );
  if ("flow" in block) return <FlowStrip labels={block.flow} />;
  return (
    <div className="card scroll help-table">
      <table>
        <thead>
          <tr>
            {block.table.head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.table.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>
                  <HelpInline text={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HelpSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="help-steps">
      {steps.map((s, i) => (
        <li key={i}>
          <span className="n" aria-hidden="true">
            {i + 1}
          </span>
          <div>
            <HelpInline text={s} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Where the work goes, left to right. On an article, its own stage stands out. */
export function FlowStrip({ labels, current, links }: { labels?: string[]; current?: StageKey; links?: Partial<Record<StageKey, string>> }) {
  const items = labels ? labels.map((label) => ({ key: label.toLowerCase(), label })) : STAGES.map((s) => ({ key: s.key as string, label: s.label as string }));
  return (
    <ol className="help-flow" aria-label="The main path of the work">
      {items.map((s) => {
        const href = links?.[s.key as StageKey];
        const here = s.key === current;
        return (
          <li key={s.key} className={here ? "here" : undefined} aria-current={here ? "step" : undefined}>
            {href ? <Link href={href}>{s.label}</Link> : <span>{s.label}</span>}
          </li>
        );
      })}
    </ol>
  );
}
