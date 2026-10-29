import { redirect } from "next/navigation";
import { OperationError } from "@/db/operations";

/** Show the result of the last action (passed back in the URL). */
export function Flash({ params }: { params: Record<string, string | undefined> }) {
  if (params.error) return <ul className="issues"><li className="bad">{params.error}</li></ul>;
  if (params.ok) return <ul className="issues"><li className="ok">{params.ok}</li></ul>;
  return null;
}

/** Run an action; on a business-rule error, go back to `path` and show it. */
export async function attempt<T>(path: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof OperationError) {
      const sep = path.includes("?") ? "&" : "?";
      redirect(`${path}${sep}error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
}

export const withOk = (path: string, msg: string) => `${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`;

/**
 * Run the action of a form that keeps what was typed (GuardedForm): a
 * business-rule error comes back as a message instead of reloading the page.
 * Success redirects as usual.
 */
export async function keepInput(fn: () => Promise<void>): Promise<{ error: string } | undefined> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof OperationError) return { error: e.message };
    throw e;
  }
  return undefined;
}
