/**
 * The app has no sign-in, so it must only answer to this computer. Binding to
 * 127.0.0.1 keeps other devices out; this check also turns away a web page that
 * points its own name at this computer ("DNS rebinding") to read or use the app.
 */
const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True when a request's Host header names this computer (any port). */
export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const name = host.trim().toLowerCase().replace(/:\d+$/, "");
  return LOCAL_NAMES.has(name);
}
