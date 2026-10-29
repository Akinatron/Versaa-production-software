import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "@/db/schema";

/*
 * The newest snapshot in drizzle/meta matches src/db/schema.ts, so
 * `drizzle-kit generate` writes only the next change, never tables that
 * already exist. If this fails, a schema change is missing its migration
 * (see "Changing the database" in the README).
 */

describe("migration snapshot", () => {
  it("matches the schema", async () => {
    const dir = path.join(process.cwd(), "drizzle", "meta");
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith("_snapshot.json"))
      .sort()
      .at(-1)!;
    const snapshot = JSON.parse(readFileSync(path.join(dir, latest), "utf8"));
    const now = generateDrizzleJson(schema, snapshot.id);
    expect(await generateMigration(snapshot, now)).toEqual([]);
  });
});
