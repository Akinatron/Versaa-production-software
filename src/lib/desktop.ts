/*
 * Talking to the desktop app's shell (desktop/src/main.ts) from the server. The
 * shell owns the built-in database, so backups and the mock database are made
 * there. It listens on a private local port and passes its address and a
 * secret in VERSAA_DESKTOP_CONTROL / VERSAA_DESKTOP_TOKEN; in a browser setup
 * (pnpm dev) these are not set.
 */

export const isDesktop = () => !!process.env.VERSAA_DESKTOP_CONTROL;

export async function desktopRequest<T>(path: string): Promise<T> {
  const base = process.env.VERSAA_DESKTOP_CONTROL;
  if (!base) throw new Error("Not running inside the desktop app.");
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { authorization: `Bearer ${process.env.VERSAA_DESKTOP_TOKEN ?? ""}` } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || `The desktop app answered ${res.status}.`);
  return body;
}
