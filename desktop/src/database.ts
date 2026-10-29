import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDb } from "../../src/db/client";
import { loadStartingCatalogOnce } from "../../src/db/seed";

export type Database = {
  pg: PGlite;
  url: string;
  /**
   * Apply migrations, like `pnpm db:migrate`. Until the starting catalog
   * (`pnpm db:seed`) has been loaded once, it is loaded, and only then marked
   * as loaded. So a first start that was cut short loads it next time, and
   * what was deleted later in developer mode stays deleted.
   */
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
        await refuseNewerDatabase(db.$client, opts.migrationsDir);
        await migrate(db, { migrationsFolder: opts.migrationsDir });
        opts.log("migrations applied");
        const { loaded, added } = await loadStartingCatalogOnce(db);
        if (loaded) opts.log("starting catalog loaded", added > 0 ? `(with ${added} yield estimate(s))` : "");
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

/**
 * An empty database in memory, served the same way, for developer mode's
 * "Mock data". The app migrates and fills it; it disappears when stopped or
 * when the app quits, and never touches the real database.
 */
export async function startMemoryDatabase(log: (...p: unknown[]) => void): Promise<{ url: string; stop(): Promise<void> }> {
  const pg = await PGlite.create();
  const socket = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 0, maxConnections: 1 });
  const listening = new Promise<number>((resolve) =>
    socket.addEventListener("listening", (e) => resolve((e as CustomEvent<{ port: number }>).detail.port), { once: true }),
  );
  await socket.start();
  const port = await listening;
  log("mock database ready on port", port);
  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    async stop() {
      await socket.stop();
      await pg.close();
      log("mock database closed");
    },
  };
}

/**
 * An older copy of the app must not open a database that a newer copy has
 * already migrated: its code would not match the tables. Stop with a clear
 * message instead (the backups folder has copies from before each update).
 */
async function refuseNewerDatabase(sql: ReturnType<typeof createDb>["$client"], migrationsDir: string) {
  const journal = JSON.parse(readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8")) as { entries: unknown[] };
  const [table] = await sql<{ exists: boolean }[]>`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
  if (!table?.exists) return;
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`;
  const n = row?.n ?? 0;
  if (n > journal.entries.length) {
    throw new Error(
      `This database was already updated by a newer version of Versaa (${n} database changes; this copy knows ${journal.entries.length}). Open the newer Versaa.app instead.`,
    );
  }
}
