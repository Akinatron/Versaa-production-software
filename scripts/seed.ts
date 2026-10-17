import { createDb } from "../src/db/client";
import { seedCatalog, seedYieldEstimates } from "../src/db/seed";

const db = createDb();
await seedCatalog(db);
console.log("Starting catalog loaded.");
const { added } = await seedYieldEstimates(db);
if (added > 0) console.log(`Added ${added} litres-per-batch estimate(s).`);
await db.$client.end();
