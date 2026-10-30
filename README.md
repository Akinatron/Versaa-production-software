# Versaa Production Software

Operations app for Versaa: production planning, purchasing, inventory, production, packaging, traceability and outbound (sales and every other stock exit).

## What works now

The app is for one person on one computer: there are no accounts, no sign-in and no roles. It opens straight on Today.

- **Home** (`/`): what needs attention (missing figures, shortages for confirmed runs, late deliveries, batches waiting on something, orders that stock can't cover), upcoming runs, open batches, purchases on the way, jars available and sales this month.
- **Plan** (`/plan`): sellable jars per sauce and size, or batches per sauce with a % split across sizes. Both give the same plan: litres, batches, surplus, ingredients, packaging, stock coverage and what to buy. Planning never changes stock.
- **Runs** (`/runs`): save a plan, then confirm it. Confirming freezes the forecast, reserves the stock it needs and creates the run's batches. A run is worked in four steps: 1. the run (what it makes, its batches, its orders and its budget), 2. stock vs need, 3. order what's missing (one draft order per supplier, favourite preselected, rounded up to whole packs), 4. receive the deliveries. The budget shows "To buy" and "Total cost" for ingredients and packaging at the favourite supplier's price.
- **Batches** (`/batches`): every batch in one list, filtered by **To cook**, **To pack** and **Closed**. Opening a batch lands on the step it is waiting on; each batch has three steps under `/batches/<id>`:
  1. **Cook** (`/cook`): every planned quantity is filled in; change what differs (0 if not used) and press **Record** once. Ingredients come from the earliest best-before lot, or split by hand between lots. Recording again corrects stock by the difference. A warning shows before leaving with unsaved changes. Once every ingredient is in, the batch moves straight on to Pack.
  2. **Pack** (`/pack`): record packaging sessions (filled, rejected, accepted per size) and edit or delete them, also after the batch is closed; stock moves by the difference, and a session whose jars have already left stock can't be lowered or deleted. One table per batch shows each size with its finished lot, best-before and jars in stock. "Finished packing: close batch" leads to the last step.
  3. **Close** (`/close`): the batch summary: ingredients used, jars and litres (always jars filled × ml, rejects included), the batch's real cost at the price of the lots it used, incidents, closing, and plan vs actual.
  The old Production and Packaging addresses still work and lead here.
- **Suppliers** (`/suppliers`) and item cards (`/items/…`): which suppliers sell each ingredient and packaging item, in favourite order, with the price per pack as they sell it (e.g. 12 € per 25 kg sack). The link is one record shown on both cards; changing a price keeps the old one with its date.
- **Shelf life and best-before**: each product (Settings → Sauces, sizes & products) and, optionally, each ingredient (Settings → Ingredients) can have a shelf life in days, weeks or months. When packing, the best-before of the new lot of jars is filled in with the packing date plus the shelf life (it can be changed for that lot); an ingredient delivered without a best-before gets the delivery date plus its shelf life. Today lists lots in stock that are past or within 30 days of their best-before.
- **Jar labels**: every lot of jars (one batch in one size) has one code, so all its jars share the same label: product, lot code, best-before and a Code 128 barcode of the lot code. "Print labels" on the lot page or under Jars packed opens an A4 sheet of 40 labels (52.5 × 29.7 mm, Apli 1285 style), filled with one label per jar in stock, with "Start at position" for a partly used sheet, or a single label on its own page. Print at 100% with no margins.
- **Orders** and **Deliveries**: orders start as drafts and "Mark as sent" stores the date they went out. An order can be for a run or a plain restock. Deliveries record, per line, what was accepted (becomes a lot with its supplier batch and best-before) and what was refused, plus damage notes, an optional time and a note. Refused goods count as not received; close the order by hand if they won't be replaced. Each order can be turned into a message for the supplier (with or without prices): copy it, open it in email or WhatsApp when the supplier contact has an email or phone, or print it / save it as a PDF. The app never sends it by itself.
- **Paperwork**: a photo (straight from the phone camera) or PDF of the supplier's delivery note goes with each delivery, added while recording it or later from Deliveries, the order or the lot. The invoice goes with the order, since one invoice can cover several deliveries. Both show on the lot, the order, the supplier card and in the backward trace of a batch. Only JPG, PNG, WEBP, HEIC and PDF files are accepted (checked from the file's contents), up to 20 MB each. Removing a file only hides it; the record and the file are kept.
- **Stock** (`/stock`): ingredients, packaging and finished jars, per lot with origin and full history. Opening count, count corrections and write-offs (always with a reason).
- **Outbound** (`/outbound`, formerly Sales): every jar that leaves stock. "Record a stock exit" starts by choosing the reason: Sale, Own use, Test, Sample / gift or Waste / loss. Sales keep customer, price and order (sales orders reserve jars; delivering takes them out once, from specific batch lots). The other reasons only ask for product, lot, jars, date and note. All of them take jars out of stock and stay traceable; only sales count in the sales reports. Old `/sales` links redirect.
- **Trace** (`/trace`): search any lot, batch, delivery note or supplier batch. Forward: where an ingredient lot went, which jars are still in stock and who received the rest (recall summary). Backward: from a sale or jar lot to the batch, its ingredient lots and suppliers.
- **Reports** (`/reports`): sales by sauce and size for a period (revenue only from recorded prices, never called profit), other outflows, production and rejects, plan vs actual per run, and CSV downloads (movements, lots, sales, batches).
- **History** (`/history`, under Keep): every create, change, delete and restore in the app, newest first, with when, what changed (before → after) and why. Filter by area (Production, Packaging, Purchasing, Sales, Stock, Settings), kind of action, dates or a code (B-…, PO-…, a lot). Each record's own page has a **History** section at the bottom with its changes and those of what hangs from it (a run shows its batches' changes; switch to "Only this run" to hide them), and an "Edited" mark under the title.
- **Correcting, deleting and restoring**: batches (ingredients, date, note, incidents, not made), packaging sessions, runs (cancel, restore a discarded draft), purchase orders (correct quantities and prices also after sending, cancel, restore), deliveries (own page `/deliveries/<id>`: correct, delete, restore), lots (supplier batch, best-before), sales orders (correct while waiting, cancel, restore), sales and other outflows (correct details, delete, restore), stock counts and write-offs (`/stock/adjustments/<id>`: delete, restore) and paperwork files (remove, put back). Every correction, delete and restore asks for a reason; it goes in the history. Nothing is ever really deleted: it is marked deleted, its stock effect is reversed with new movements, and it can be restored. There is no time limit.
- **Help** (`/help`, bottom of the side menu): a searchable help with a **Start here** list that ticks itself off from the data, the main path Plan → Buy → Receive → Cook → Pack → Close → Sell, one guide per job (steps, what it changes, common mistakes), common questions and a glossary. A **?** at the top right of every screen opens that screen's guide. **Download manual (.md)** gives the same content as one Markdown file to hand to an AI assistant; ticking "Include my recipes and settings" adds this app's recipes, products, items and prices. The text lives in `src/help/` and a test fails if a screen has no guide.
- **Settings** (`/settings`): recipes and packaging lists edited as new versions (old batches keep the version they used), ingredients and packaging items, sauces, sizes and products, yields and reject rates, suppliers.

Anything that can't be worked out yet is shown as **unknown**, never as 0. Once batches are closed, the planner uses their litres per batch (from the jars filled) and reject rates instead of estimates.

## Rules built into the data

- Stock is the sum of an append-only ledger (`movements`). The database refuses edits or deletes; corrections are new movements, linked to the history entry that caused them (`movements.change_id`).
- The history (`change_log`, `change_log_links`) is written in the same transaction as the change and is append-only too. Each entry is linked to every record it touches, and stores names and codes as they were that day.
- Every quantity lives in a lot, for traceability from supplier to customer.
- Recipes and packaging lists are versioned; a batch keeps the version it used.
- Every recording action carries an idempotency key, so a retry or double click can't post twice.
- kg, L and jars are never converted into each other.

## Starting data

`data/catalog-v1.json` holds the recipes, 25 ingredients, 20 packaging items and 9 products exactly as provided by Pablo on 17 Oct 2026. No measured yields or prices exist yet and none are invented. Litres per batch starts at Pablo's rough estimate of about 30 L per 30 kg batch for each sauce, labelled as an estimate; `pnpm db:seed` adds it only for sauces with no figure yet, and a newer figure entered in Settings replaces it.

## Running it

Requires Node 24, pnpm 12 and PostgreSQL 18 (the same version the desktop app runs inside PGlite). The exact versions live in one place each: `.nvmrc` (Node) and `packageManager` in `package.json` (pnpm, which switches to that version by itself). GitHub reads the same two.

```sh
pnpm install
export DATABASE_URL=postgres://user:pass@localhost/versaa
pnpm db:migrate     # create or update tables (run again after every update)
pnpm db:seed        # load the starting catalog (safe to repeat)
pnpm dev            # http://localhost:3000
```

`pnpm dev` and `pnpm start` only answer on this computer (127.0.0.1). Other devices on the same Wi-Fi can't open the app, because it has no sign-in. The app also turns away any request that doesn't come in as `localhost` or `127.0.0.1` (`src/proxy.ts`), so a web page can't reach it by pointing its own name at this computer.

Uploaded delivery notes and invoices are saved in an `uploads` folder next to the app (set `UPLOADS_DIR` to keep them elsewhere). That folder is not in git; back it up together with the database.

## Developer mode

At the bottom of Settings you can turn on **Developer mode** (off by default; it stays on until "Back to normal mode"). It adds:

- **Check for updates** (desktop app, see below).
- **Mock data**: the app switches to a separate test database with four test suppliers and an example of every stage. The real database is not touched, and the test database is thrown away when it is turned off or the server restarts. In the web version it is a second database on the same PostgreSQL server, named after yours with `_mock` (`versaa_mock`), so the `DATABASE_URL` user must be allowed to create databases. In the desktop app it lives in memory.
- **Delete database**: delete activity, suppliers, recipes, items and/or sauces & products, with what depends on them. The desktop app saves a backup first.

Build or run with `VERSAA_DEVTOOLS=0` to leave developer mode out.

Tests: `pnpm test` needs `TEST_DATABASE_URL` pointing at an empty PostgreSQL database, which is wiped on each run; without it the run stops with a message. To run only the tests that need no database, use `SKIP_DB_TESTS=1 pnpm test`.

## Desktop app

The same app also runs as a normal program for Windows (the main target) and Mac, opened with a double click, with no Terminal, browser or database to install. Its data stays on that computer only, and it is separate from the `pnpm dev` database.

Build it from this folder (needs Node 24 and pnpm 12, like the web version; the desktop part installs its own tools with npm):

```sh
pnpm desktop:win    # on a Windows PC: builds the installer in desktop/dist (Versaa Setup ….exe)
pnpm desktop:mac    # on a Mac: builds Versaa.app and copies it into /Applications
```

On Windows, run the installer from `desktop/dist`; it lets you choose the folder. It has not been tested on a Windows PC yet. On a Mac, open **Versaa** from Applications or Launchpad. The first start takes a few seconds longer while it creates the database; then it opens on Today. To update, build again after pulling and install the new copy over the old one: the data is kept, and migrations run by themselves when it opens.

While the app is in development, the Mac app can also update itself from GitHub (Settings → Developer mode → Check for updates). On Windows that button only says to install the new version by hand. See [desktop/UPDATER.md](desktop/UPDATER.md), which also says how to build it without the updater or remove it.

The app isn't signed. On Windows, SmartScreen may warn the first time: choose **More info**, then **Run anyway**. On a Mac, a copy built on the same Mac opens normally; one brought from another Mac (the zip in `desktop/dist`) is blocked the first time: right-click it, choose **Open**, then **Open** again (or allow it in System Settings → Privacy & Security).

What it keeps, in the data folder (File → Show Data Folder): `%APPDATA%\Versaa\data` on Windows, `~/Library/Application Support/Versaa/data` on a Mac.

- `database`: the database. It is PostgreSQL running inside the app ([PGlite](https://pglite.dev)), so the code, migrations and rules are the same as the web version.
- `uploads`: delivery notes and invoices.
- `backups`: copies of the database, named by kind and time. `versaa-auto-…` is made every time the app opens; the newest 10 are kept, plus the newest of each day of the last 30 days. `versaa-manual-…` (File → Back Up Database Now) and `versaa-before-delete-…` (made just before "Delete database", with the uploads next to it in `uploads-before-delete-…`, the last 3 kept) are never removed by the app: delete them yourself when you no longer need them. A copy is written under a temporary name and only gets its real name once it is complete. To go back to one, quit Versaa, rename `database` to `database-old`, create an empty `database` folder and unpack the backup into it (`tar -xzf <backup>.tar.gz -C database`; `tar` comes with Windows 10 and 11).
- `versaa.log`: what happened at start-up, for when something goes wrong.

How it works: `desktop/` is an [Electron](https://www.electronjs.org) shell. On start it opens the database and serves it on a private local port, runs the migrations and, until it has been loaded once, the starting catalog (like `pnpm db:migrate` and `pnpm db:seed`; a first start cut short loads it on the next one), starts the Next.js server (built with `NEXT_OUTPUT=standalone`) on another local port and shows it in a window. Nothing listens outside the computer. The built-in database takes one connection at a time, so the app uses a pool of one there (`DATABASE_POOL_MAX=1`). `pnpm desktop:dev` runs it without packaging.

## Changing the database

Migrations live in `drizzle/` and run in order (`pnpm db:migrate`, and by themselves when the desktop app opens). A migration that has run is never edited; every change is a new one:

1. Change `src/db/schema.ts`.
2. Run `pnpm drizzle-kit generate --name <what_it_does>`. It compares the schema with the latest snapshot in `drizzle/meta/` and writes the next `drizzle/00NN_<name>.sql`, its journal entry and a new snapshot.
3. Read the SQL. Add by hand what Drizzle doesn't write (triggers, filling a new column for existing rows), keeping it safe to run on a database that already has data.
4. `pnpm db:migrate`, then `pnpm test`. `test/migration-snapshot.test.ts` fails if `schema.ts` changed without a new snapshot.

Commit the SQL, `drizzle/meta/_journal.json` and the new snapshot together, so the next `generate` starts from the right place. A migration that only has hand-written SQL (no schema change) can be made with `pnpm drizzle-kit generate --custom --name <name>`.

## Stack

Next.js 16 (TypeScript), PostgreSQL 18 with Drizzle ORM, Vitest. Desktop: Electron with PGlite. Hosting on AWS comes later.
