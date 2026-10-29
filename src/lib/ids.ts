import { notFound } from "next/navigation";

/** A database id (uuid). */
export const isId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * An id taken from the address. One that can't be an id (an old or mistyped
 * link) shows "Page not found" instead of a database error.
 */
export function idOrNotFound(id: string) {
  if (!isId(id)) notFound();
  return id;
}
