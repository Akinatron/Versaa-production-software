import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = ReturnType<typeof createDb>;

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 5 });
  return drizzle(sql, { schema });
}

// Kept on globalThis so dev-mode reloads and separate route bundles share one pool.
const g = globalThis as unknown as { __versaaDb?: DB };
/** One connection pool per server process. */
export function db(): DB {
  g.__versaaDb ??= createDb();
  return g.__versaaDb;
}
