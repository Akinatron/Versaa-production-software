import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { BUSINESS_TIME_ZONE } from "@/domain/dates";

export type DB = ReturnType<typeof createDb>;

/**
 * Postgres notices go to the log, except the routine ones that migrations,
 * tests and "Delete database" print by the hundred ("…, skipping", "drop
 * cascades to…") and would hide the ones worth reading.
 */
const ROUTINE_NOTICE = [
  /, skipping$/,
  /^(drop|truncate) cascades to /,
  // Made by an early migration; Postgres keeps the name cut to 63 characters, which works.
  /^identifier "packaging_session_lines_packaging_version_id_packaging_versions_id_fk" will be truncated/,
];

export const routineNotice = (message: string) => ROUTINE_NOTICE.some((r) => r.test(message));

function showNotice(notice: { message?: string }) {
  if (!routineNotice(notice.message ?? "")) console.log("Database notice:", notice.message);
}

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  // The desktop app's built-in database takes one connection at a time (DATABASE_POOL_MAX=1).
  // Days in SQL (`::date`, `now()`) follow the business's time zone, like the app.
  // The desktop database ignores this and sets it itself (desktop/src/database.ts).
  const sql = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX) || 5, connection: { TimeZone: BUSINESS_TIME_ZONE }, onnotice: showNotice });
  return drizzle(sql, { schema });
}

/** The mock database while developer mode shows test data (see src/db/mock.ts). */
export interface MockDatabase {
  db: DB;
  url: string;
  /** Where files uploaded while viewing mock data go; thrown away with it. */
  uploadsDir: string;
  startedAt: Date;
}

// Kept on globalThis so dev-mode reloads and separate route bundles share one pool.
const g = globalThis as unknown as { __versaaDb?: DB; __versaaMock?: MockDatabase | null };

/** The real database, whatever the app is showing. App settings always use it. */
export function realDb(): DB {
  g.__versaaDb ??= createDb();
  return g.__versaaDb;
}

/**
 * The database the app is showing: the real one, or the mock one while
 * "Mock data" is on. One connection pool each per server process.
 */
export function db(): DB {
  return g.__versaaMock?.db ?? realDb();
}

export const activeMock = (): MockDatabase | null => g.__versaaMock ?? null;
export function setActiveMock(m: MockDatabase | null) {
  g.__versaaMock = m;
}
