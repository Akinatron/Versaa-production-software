import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/db/client";

const db = createDb();
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
await db.$client.end();
