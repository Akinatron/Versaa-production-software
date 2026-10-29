/**
 * Reading what a form sent, the same way in every server action.
 * Numbers are read in src/db (readNumber in src/db/base.ts), where the rules live.
 */

/** A text field, trimmed; "" when missing. */
export const str = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

/**
 * A page of this app to go back to ("/..."), or the fallback. Never another
 * site: "//host" and "/\host" are refused. `under` limits it to some sections.
 */
export function localPath(value: unknown, fallback: string, under?: string[]) {
  const s = String(value ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return fallback;
  if (under && !under.some((p) => s === p || s.startsWith(`${p}/`) || s.startsWith(`${p}?`))) return fallback;
  return s;
}

/** The form's "back" field as a page of this app, or the fallback. */
export const backOr = (form: FormData, fallback: string, under?: string[]) => localPath(form.get("back"), fallback, under);
