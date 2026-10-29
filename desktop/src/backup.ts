import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Copies of the database, as .tar.gz files named by kind and time:
 * - auto: made every time the app opens. Only these are ever cleaned up: the
 *   newest 10 are kept, plus the newest of each day of the last 30 days.
 * - manual: File → Back Up Database Now. Kept until you delete them.
 * - before-delete: made just before "Delete database". Kept until you delete them.
 * - before-update: made by the updater in its own folder.
 * Copies from before kinds existed (versaa-<time>.tar.gz) are never removed.
 *
 * To restore one, quit Versaa, move the "database" folder aside and unpack
 * the copy into a new "database" folder.
 */
export type BackupKind = "auto" | "manual" | "before-delete" | "before-update";

const NAME = /^versaa-(auto|manual|before-delete|before-update)-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{3})(?:-\d+)?\.tar\.gz$/;
const KEEP_NEWEST = 10;
const KEEP_DAYS = 30;

/** "2026-10-28T17:02:19.123Z" → "2026-10-28-17-02-19-123". */
const stampOf = (d: Date) => d.toISOString().replace(/[:T.]/g, "-").slice(0, 23);

/** The part of PGlite a backup needs. */
type Dumpable = { dumpDataDir(compression?: "gzip"): Promise<Blob> };

export async function backupDatabase(pg: Dumpable, dir: string, opts: { kind?: BackupKind; now?: Date } = {}): Promise<string> {
  const kind = opts.kind ?? "auto";
  const now = opts.now ?? new Date();
  await mkdir(dir, { recursive: true });
  await removeStalePartials(dir, now);
  const dump = await pg.dumpDataDir("gzip");
  // Never the same name twice, even for two copies in the same millisecond.
  const base = `versaa-${kind}-${stampOf(now)}`;
  let file = path.join(dir, `${base}.tar.gz`);
  for (let n = 2; existsSync(file); n++) file = path.join(dir, `${base}-${n}.tar.gz`);
  // Written under another name first: a copy cut short (battery, crash) never looks finished.
  const partial = `${file}.partial`;
  await writeFile(partial, Buffer.from(await dump.arrayBuffer()));
  await rename(partial, file);
  if (kind === "auto") {
    for (const f of autoCopiesToRemove(await readdir(dir), now)) await rm(path.join(dir, f), { force: true });
  }
  return file;
}

/**
 * Which automatic copies to remove: all but the newest 10 and the newest
 * copy of each day (UTC) of the last 30 days. Other kinds and other files
 * are never listed.
 */
export function autoCopiesToRemove(files: string[], now: Date): string[] {
  const autos = files
    .map((f) => ({ f, m: NAME.exec(f) }))
    .filter((x): x is { f: string; m: RegExpExecArray } => !!x.m && x.m[1] === "auto")
    .map(({ f, m }) => ({ f, day: `${m[2]}-${m[3]}-${m[4]}`, key: m.slice(2, 9).join("") + f }))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
  const keep = new Set(autos.slice(0, KEEP_NEWEST).map((a) => a.f));
  const oldest = new Date(now);
  oldest.setUTCDate(oldest.getUTCDate() - (KEEP_DAYS - 1));
  const fromDay = oldest.toISOString().slice(0, 10);
  const seenDays = new Set<string>();
  for (const a of autos) {
    if (a.day < fromDay || seenDays.has(a.day)) continue;
    seenDays.add(a.day);
    keep.add(a.f);
  }
  return autos.filter((a) => !keep.has(a.f)).map((a) => a.f);
}

/** Leftovers of copies that were cut short more than an hour ago. */
async function removeStalePartials(dir: string, now: Date) {
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".partial")) continue;
    const p = path.join(dir, f);
    const s = await stat(p).catch(() => null);
    if (s && now.getTime() - s.mtimeMs > 60 * 60 * 1000) await rm(p, { force: true });
  }
}
