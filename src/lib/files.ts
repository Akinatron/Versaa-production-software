import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/*
 * Where uploaded paperwork (delivery notes, invoices) is kept. For now that
 * is a folder on the machine running the app: UPLOADS_DIR, or "uploads" next
 * to the app. Only this file knows that, so moving to cloud storage later
 * means changing these three functions.
 */

function root() {
  return path.resolve(process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads"));
}

function full(key: string) {
  const r = root();
  const p = path.resolve(r, key);
  if (!p.startsWith(r + path.sep)) throw new Error("Bad file key");
  return p;
}

/** Store bytes and return the key to find them again. */
export async function putFile(data: Uint8Array, ext: string): Promise<string> {
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}${ext}`;
  const p = full(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data, { flag: "wx" });
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  return readFile(full(key));
}

/** Only used to clean up a file whose record could not be saved. */
export async function dropFile(key: string) {
  await rm(full(key), { force: true });
}
