import { createDb } from "../src/db/client";
import { seedCatalog } from "../src/db/seed";

const db = createDb();
await seedCatalog(db);
console.log("Starting catalog loaded.");
await db.$client.end();
