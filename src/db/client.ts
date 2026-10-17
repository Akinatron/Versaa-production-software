import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = ReturnType<typeof createDb>;

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 5 });
  return drizzle(sql, { schema });
}

let shared: DB | undefined;
/** One connection pool per server process. */
export function db(): DB {
  shared ??= createDb();
  return shared;
}
