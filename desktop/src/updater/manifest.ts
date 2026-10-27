/**
 * The small file (update.json) published with every build on GitHub, and the
 * rules for comparing it with the running copy. No Electron here, so it can
 * be tested on its own.
 */
import type { BuildInfo } from "./build-info";

export type Manifest = {
  number: number;
  commit: string;
  commitTime: string;
  builtAt: string;
  /** File name of the zipped Versaa.app in the same release. */
  zip: string;
  sha256: string;
  size: number;
  arch: string;
  /** Recent changes on main, newest first. */
  notes: { time: string; text: string }[];
};

export function parseManifest(raw: unknown): Manifest {
  const m = raw as Partial<Manifest> | null;
  const ok =
    m &&
    typeof m.number === "number" &&
    typeof m.commit === "string" &&
    /^[0-9a-f]{7,40}$/.test(m.commit) &&
    typeof m.commitTime === "string" &&
    !Number.isNaN(Date.parse(m.commitTime)) &&
    typeof m.zip === "string" &&
    /^[\w.-]+\.zip$/.test(m.zip) &&
    typeof m.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(m.sha256) &&
    typeof m.arch === "string";
  if (!ok) throw new Error("The published update description is not valid.");
  return {
    number: m.number!,
    commit: m.commit!,
    commitTime: m.commitTime!,
    builtAt: typeof m.builtAt === "string" ? m.builtAt : m.commitTime!,
    zip: m.zip!,
    sha256: m.sha256!,
    size: typeof m.size === "number" ? m.size : 0,
    arch: m.arch!,
    notes: Array.isArray(m.notes) ? m.notes.filter((n) => n && typeof n.text === "string" && typeof n.time === "string") : [],
  };
}

/** A published build is an update when it comes from a different, later commit of main. */
export function isNewer(latest: Pick<Manifest, "commit" | "commitTime">, current: Pick<BuildInfo, "commit" | "commitTime">): boolean {
  if (latest.commit === current.commit) return false;
  const a = Date.parse(latest.commitTime);
  const b = Date.parse(current.commitTime);
  if (Number.isNaN(b)) return true;
  return a > b;
}

/** What changed since the running copy, oldest last, at most `max`. */
export function notesSince(notes: Manifest["notes"], current: Pick<BuildInfo, "commitTime">, max = 12): string[] {
  const since = Date.parse(current.commitTime);
  return notes
    .filter((n) => Number.isNaN(since) || Date.parse(n.time) > since)
    .slice(0, max)
    .map((n) => n.text);
}
