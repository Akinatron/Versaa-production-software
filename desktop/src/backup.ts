import type { PGlite } from "@electric-sql/pglite";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Save a full copy of the database as a .tar.gz in `dir` and keep only the
 * newest `keep` copies. To restore one, quit Versaa, move the "database"
 * folder aside and unpack the copy into a new "database" folder.
 */
export async function backupDatabase(pg: PGlite, dir: string, { keep = 10 } = {}): Promise<string> {
  await mkdir(dir, { recursive: true });
  const dump = await pg.dumpDataDir("gzip");
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const file = path.join(dir, `versaa-${stamp}.tar.gz`);
  await writeFile(file, Buffer.from(await dump.arrayBuffer()));
  const old = (await readdir(dir)).filter((f) => /^versaa-.*\.tar\.gz$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - keep))) await rm(path.join(dir, f), { force: true });
  return file;
}
