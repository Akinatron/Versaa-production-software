import { redirect } from "next/navigation";
import { OperationError } from "@/db/operations";
import { withActor } from "@/db/changes";
import { can, currentUser, type Role } from "@/lib/session";

/** Show the result of the last action (passed back in the URL). */
export function Flash({ params }: { params: Record<string, string | undefined> }) {
  if (params.error) return <ul className="issues"><li className="bad">{params.error}</li></ul>;
  if (params.ok) return <ul className="issues"><li className="ok">{params.ok}</li></ul>;
  return null;
}

/**
 * Run an action as the signed-in person: what it records goes in the history
 * under their name, and an account that may only view is stopped here. On a
 * business-rule error, go back to `path` and show it.
 */
export async function attempt<T>(path: string, fn: () => Promise<T>, opts: { role?: Role } = {}): Promise<T> {
  const me = await currentUser();
  const back = (msg: string): never => {
    const sep = path.includes("?") ? "&" : "?";
    redirect(`${path}${sep}error=${encodeURIComponent(msg)}`);
  };
  if (me && !can(me.role, opts.role ?? "editor")) {
    back(opts.role === "admin" ? "Only an admin can do this." : "Your account can only view. Ask an admin to make you an editor.");
  }
  try {
    return await withActor(me ? { id: me.id, name: me.name, role: me.role } : null, fn);
  } catch (e) {
    if (e instanceof OperationError) back(e.message);
    throw e;
  }
}

export const withOk = (path: string, msg: string) => `${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`;
