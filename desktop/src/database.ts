import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../../src/db/client";
import { seedCatalog, seedYieldEstimates } from "../../src/db/seed";

export type Database = {
  pg: PGlite;
  url: string;
  /** Apply migrations and load the starting catalog, like `pnpm db:migrate` and `pnpm db:seed`. */
  prepare(): Promise<void>;
  stop(): Promise<void>;
};

/**
 * Open (or create) the database in `dataDir` and serve it on a private local
 * port with the normal PostgreSQL protocol, so the app talks to it exactly as
 * it talks to a PostgreSQL server.
 *
 * PGlite is a single session, so the server accepts one connection and every
 * client here uses a pool of one (DATABASE_POOL_MAX=1). That keeps each
 * transaction to itself.
 */
export async function startDatabase(opts: { dataDir: string; migrationsDir: string; log: (...p: unknown[]) => void }): Promise<Database> {
  process.env.DATABASE_POOL_MAX = "1";
  const pg = await PGlite.create(opts.dataDir);
  const socket = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 0, maxConnections: 1 });
  const listening = new Promise<number>((resolve) =>
    socket.addEventListener("listening", (e) => resolve((e as CustomEvent<{ port: number }>).detail.port), { once: true }),
  );
  await socket.start();
  const port = await listening;
  const url = `postgres://postgres@127.0.0.1:${port}/postgres`;
  opts.log("database ready on port", port);

  return {
    pg,
    url,
    async prepare() {
      const db = createDb(url);
      try {
        await migrate(db, { migrationsFolder: opts.migrationsDir });
        opts.log("migrations applied");
        await seedCatalog(db);
        const { added } = await seedYieldEstimates(db);
        opts.log("starting catalog checked", added > 0 ? `(added ${added} yield estimate(s))` : "");
      } finally {
        await db.$client.end();
      }
    },
    async stop() {
      await socket.stop();
      await pg.close();
      opts.log("database closed");
    },
  };
}
