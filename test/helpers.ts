import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, type DB } from "@/db/client";
import { seedCatalog } from "@/db/seed";

export const testDbUrl = process.env.TEST_DATABASE_URL;

/** A fresh, migrated and seeded test database. Wipes everything first. */
export async function freshDb(): Promise<DB> {
  const db = createDb(testDbUrl);
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seedCatalog(db, { suppliers: false });
  return db;
}
