import { OperationError } from "@/db/operations";

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
