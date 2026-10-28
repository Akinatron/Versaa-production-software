import { eq } from "drizzle-orm";
import type { DB } from "./client";
import * as t from "./schema";

/** Read one app setting, or `fallback` when it was never set. */
export async function getSetting<T>(db: DB, key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(t.appSettings).where(eq(t.appSettings.key, key));
  return row ? (row.value as T) : fallback;
}

export async function setSetting(db: DB, key: string, value: unknown) {
  await db
    .insert(t.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: t.appSettings.key, set: { value, updatedAt: new Date() } });
}
