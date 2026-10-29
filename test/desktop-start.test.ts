import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb, type DB } from "@/db/client";
import * as t from "@/db/schema";
import { CATALOG_LOADED, loadStartingCatalogOnce } from "@/db/seed";
import { getSetting } from "@/db/app-settings";
import { autoCopiesToRemove, backupDatabase } from "../desktop/src/backup";
import { testDbUrl } from "./helpers";

/*
 * Desktop app: the starting catalog is loaded until it is marked as loaded,
 * and backups made by hand or before "Delete database" are never cleaned up.
 */

const dbs: DB[] = [];
afterAll(async () => {
  for (const db of dbs) await db.$client.end();
});

/** A migrated database with nothing in it, like a first start cut short before the catalog. */
async function emptyDb() {
  const db = createDb(testDbUrl);
  dbs.push(db);
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

describe.skipIf(!testDbUrl)("starting catalog on the desktop", () => {
  it("is loaded on the next start when the first one was cut short, and only once", async () => {
    const db = await emptyDb();
    expect(await db.select().from(t.sauces)).toEqual([]);
    expect(await getSetting(db, CATALOG_LOADED, false)).toBe(false);

    const first = await loadStartingCatalogOnce(db);
    expect(first.loaded).toBe(true);
    expect((await db.select().from(t.sauces)).length).toBeGreaterThan(0);
    expect(await getSetting(db, CATALOG_LOADED, false)).toBe(true);

    // Deleted later (developer mode): it stays deleted.
    await db.execute(sql`truncate sauces, items cascade`);
    expect((await loadStartingCatalogOnce(db)).loaded).toBe(false);
    expect(await db.select().from(t.sauces)).toEqual([]);
  });
});

const day = (iso: string) => new Date(iso);
const name = (kind: string, iso: string) => `versaa-${kind}-${iso.replace(/[:T.]/g, "-").slice(0, 23)}.tar.gz`;

describe("which automatic backups are removed", () => {
  it("keeps the newest 10 and one per day of the last 30 days, and never touches other kinds", () => {
    const now = day("2026-11-30T12:00:00.000Z");
    const files: string[] = [];
    // 3 starts a day for 60 days.
    for (let d = 0; d < 60; d++) {
      for (const h of ["08", "12", "18"]) {
        const date = new Date(Date.UTC(2026, 9, 2 + d));
        files.push(name("auto", `${date.toISOString().slice(0, 10)}T${h}:00:00.000Z`));
      }
    }
    files.push(name("manual", "2026-10-03T09:00:00.000Z"), name("before-delete", "2026-10-04T09:00:00.000Z"), "versaa-2026-10-05-09-00-00.tar.gz", "notes.txt");
    const removed = new Set(autoCopiesToRemove(files, now));
    const kept = files.filter((f) => !removed.has(f));
    expect([...removed].every((f) => f.startsWith("versaa-auto-"))).toBe(true);
    const keptAutos = kept.filter((f) => f.startsWith("versaa-auto-"));
    // Newest 10 (the last 3⅓ days) plus one per day for the other days of the last 30.
    const days = new Set(keptAutos.map((f) => f.slice(12, 22)));
    expect(days.size).toBe(30);
    expect([...days].sort()[0]).toBe("2026-11-01");
    expect(keptAutos.length).toBe(10 + 30 - 4);
    expect(kept).toContain(name("manual", "2026-10-03T09:00:00.000Z"));
    expect(kept).toContain(name("before-delete", "2026-10-04T09:00:00.000Z"));
    expect(kept).toContain("versaa-2026-10-05-09-00-00.tar.gz");
  });
});

describe("making backups", () => {
  const fakePg = { dumpDataDir: async () => new Blob([new Uint8Array([1, 2, 3])]) } as never;

  it("keeps a manual copy and the one before deleting, whatever the number of starts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "versaa-backups-"));
    try {
      const manual = await backupDatabase(fakePg, dir, { kind: "manual", now: day("2026-10-01T10:00:00.000Z") });
      const beforeDelete = await backupDatabase(fakePg, dir, { kind: "before-delete", now: day("2026-10-01T10:05:00.000Z") });
      for (let i = 0; i < 40; i++) await backupDatabase(fakePg, dir, { kind: "auto", now: new Date(Date.UTC(2026, 9, 1, 11) + i * 6 * 3600 * 1000) });
      const files = await readdir(dir);
      expect(files).toContain(path.basename(manual));
      expect(files).toContain(path.basename(beforeDelete));
      expect(files.filter((f) => f.startsWith("versaa-auto-")).length).toBeLessThanOrEqual(10 + 30);
      expect(files.some((f) => f.endsWith(".partial"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("never gives two copies the same name, and clears old leftovers of a copy cut short", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "versaa-backups-"));
    try {
      const leftover = path.join(dir, "versaa-auto-2026-10-01-00-00-00-000.tar.gz.partial");
      await writeFile(leftover, "half");
      await utimes(leftover, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));
      const now = day("2026-10-01T10:00:00.000Z");
      const a = await backupDatabase(fakePg, dir, { kind: "manual", now });
      const b = await backupDatabase(fakePg, dir, { kind: "manual", now });
      expect(a).not.toBe(b);
      const files = await readdir(dir);
      expect(files.filter((f) => f.startsWith("versaa-manual-")).length).toBe(2);
      expect(files).not.toContain(path.basename(leftover));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
