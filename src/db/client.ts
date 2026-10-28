import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = ReturnType<typeof createDb>;

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  // The desktop app's built-in database takes one connection at a time (DATABASE_POOL_MAX=1).
  const sql = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX) || 5 });
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

/** The real database, whatever the app is showing. Sign-in and app settings always use it. */
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
