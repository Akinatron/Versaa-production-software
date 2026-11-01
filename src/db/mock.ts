import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { activeMock, createDb, realDb, setActiveMock } from "./client";
import { seedCatalog } from "./seed";
import { loadMockData } from "./mock-data";
import { desktopRequest, isDesktop } from "@/lib/desktop";

/*
 * "Mock data" (developer mode): the app switches to a separate test database,
 * filled with the starting catalog and an example of every stage. The real
 * database is never touched. Everything done while it is on is thrown away
 * when it is turned off, and turning it on again starts from the same data.
 *
 * Where the test database lives:
 * - Desktop app: an in-memory database the app's shell starts on request.
 * - Browser setup (pnpm dev): a database next to the real one on the same
 *   PostgreSQL server, named after it with "_mock" (versaa → versaa_mock).
 *   It is dropped and made again each time.
 *
 * It stays on until turned off or until the app (the server) restarts.
 */

const mockUploadsDir = () => path.join(os.tmpdir(), "versaa-mock-uploads");

/** The browser setup's mock database: the real URL with "_mock" after the database name. */
export function mockUrlFor(realUrl: string) {
  const u = new URL(realUrl);
  const name = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  const mockName = `${name}_mock`;
  u.pathname = `/${encodeURIComponent(mockName)}`;
  return { url: u.toString(), name: mockName };
}

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function makeEmptyDatabase(): Promise<string> {
  if (isDesktop()) return (await desktopRequest<{ url: string }>("/mock/start")).url;
  const real = process.env.DATABASE_URL;
  if (!real) throw new Error("DATABASE_URL is not set");
  const { url, name } = mockUrlFor(real);
  const admin = realDb();
  await admin.execute(sql`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${name} and pid <> pg_backend_pid()`);
  await admin.execute(sql.raw(`drop database if exists ${quoteIdent(name)}`));
  await admin.execute(sql.raw(`create database ${quoteIdent(name)}`));
  return url;
}

async function dropDatabase(url: string) {
  if (isDesktop()) {
    await desktopRequest("/mock/stop");
    return;
  }
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!name.endsWith("_mock")) return; // never anything else
  const admin = realDb();
  await admin.execute(sql`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${name} and pid <> pg_backend_pid()`);
  await admin.execute(sql.raw(`drop database if exists ${quoteIdent(name)}`));
}

/** Switch the app to a fresh mock database. */
export async function startMock() {
  if (activeMock()) await stopMock();
  const url = await makeEmptyDatabase();
  const mock = createDb(url);
  try {
    await migrate(mock, { migrationsFolder: process.env.MIGRATIONS_DIR || "./drizzle" });
    await seedCatalog(mock, { suppliers: false });
    await rm(mockUploadsDir(), { recursive: true, force: true });
    await mkdir(mockUploadsDir(), { recursive: true });
    setActiveMock({ db: mock, url, uploadsDir: mockUploadsDir(), startedAt: new Date() });
    await loadMockData(mock);
  } catch (e) {
    setActiveMock(null);
    await mock.$client.end().catch(() => {});
    await dropDatabase(url).catch(() => {});
    throw e;
  }
}

/** Back to the real database. The mock database and its files are thrown away. */
export async function stopMock() {
  const m = activeMock();
  if (!m) return;
  setActiveMock(null);
  await m.db.$client.end().catch(() => {});
  await dropDatabase(m.url).catch(() => {});
  await rm(m.uploadsDir, { recursive: true, force: true }).catch(() => {});
}
