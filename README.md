# Versaa Production Software

Operations app for Versaa: production planning, purchasing, inventory, production, packaging, traceability and outbound (sales and every other stock exit).

## What works now

Everyone signs in with their own email and password. The first time the app opens with no accounts it asks you to create one; that person adds the rest of the team under **Team** (click your name, top right).

- **Home** (`/`): what needs attention (missing figures, shortages for confirmed runs, late deliveries, batches waiting on something, orders that stock can't cover), upcoming runs, open batches, purchases on the way, jars available and sales this month.
- **Plan** (`/plan`): sellable jars per sauce and size, or batches per sauce with a % split across sizes. Both give the same plan: litres, batches, surplus, ingredients, packaging, stock coverage and what to buy. Planning never changes stock.
- **Runs** (`/runs`): save a plan, then confirm it. Confirming freezes the forecast, reserves the stock it needs and creates the run's batches. A run is worked in four steps: 1. the run (what it makes, its batches, its orders and its budget), 2. stock vs need, 3. order what's missing (one draft order per supplier, favourite preselected, rounded up to whole packs), 4. receive the deliveries. The budget shows "To buy" and "Total cost" for ingredients and packaging at the favourite supplier's price.
- **Batches** (`/batches`): the batch record for the kitchen. Ingredients used per line (pending vs recorded, which lots), measured output (L and/or kg), packaging sessions (filled, rejected, accepted per size), packaging materials used, incidents, closing, and plan vs actual.
- **Suppliers** (`/suppliers`) and item cards (`/items/…`): which suppliers sell each ingredient and packaging item, in favourite order, with the price per pack as they sell it (e.g. 12 € per 25 kg sack). The link is one record shown on both cards; changing a price keeps the old one with its date.
- **Orders** and **Deliveries**: orders start as drafts and "Mark as sent" stores the date they went out. An order can be for a run or a plain restock. Deliveries record, per line, what was accepted (becomes a lot with its supplier batch and best-before) and what was refused, plus damage notes, an optional time and a note. Refused goods count as not received; close the order by hand if they won't be replaced.
- **Stock** (`/stock`): ingredients, packaging, bulk sauce awaiting packaging and finished jars, per lot with origin and full history. Opening count, count corrections and write-offs (always with a reason).
- **Outbound** (`/outbound`, formerly Sales): every jar that leaves stock. "Record a stock exit" starts by choosing the reason: Sale, Own use, Test, Sample / gift or Waste / loss. Sales keep customer, price and order (sales orders reserve jars; delivering takes them out once, from specific batch lots). The other reasons only ask for product, lot, jars, date and note. All of them take jars out of stock and stay traceable; only sales count in the sales reports. Old `/sales` links redirect.
- **Trace** (`/trace`): search any lot, batch, delivery note or supplier batch. Forward: where an ingredient lot went, which jars are still in stock and who received the rest (recall summary). Backward: from a sale or jar lot to the batch, its ingredient lots and suppliers.
- **Reports** (`/reports`): sales by sauce and size for a period (revenue only from recorded prices, never called profit), other outflows, production and rejects, plan vs actual per run, and CSV downloads (movements, lots, sales, batches).
- **Settings** (`/settings`): recipes and packaging lists edited as new versions (old batches keep the version they used), ingredients and packaging items, sauces, sizes and products, yields and reject rates, suppliers.

Anything that can't be worked out yet is shown as **unknown**, never as 0. Once batches are closed, the planner uses their measured litres per batch and reject rates instead of estimates.

## Rules built into the data

- Stock is the sum of an append-only ledger (`movements`). The database refuses edits or deletes; corrections are new movements.
- Every quantity lives in a lot, for traceability from supplier to customer.
- Recipes and packaging lists are versioned; a batch keeps the version it used.
- Every recording action carries an idempotency key, so a retry or double click can't post twice.
- kg, L and jars are never converted into each other.

## Starting data

`data/catalog-v1.json` holds the recipes, 25 ingredients, 20 packaging items and 9 products exactly as provided by Pablo on 17 Oct 2026. No measured yields or prices exist yet and none are invented. Litres per batch starts at Pablo's rough estimate of about 30 L per 30 kg batch for each sauce, labelled as an estimate; `pnpm db:seed` adds it only for sauces with no figure yet, and a newer figure entered in Settings replaces it.

## Running it

Requires Node 22, pnpm and PostgreSQL 16.

```sh
pnpm install
export DATABASE_URL=postgres://user:pass@localhost/versaa
pnpm db:migrate     # create or update tables (run again after every update)
pnpm db:seed        # load the starting catalog (safe to repeat)
pnpm dev            # http://localhost:3000, then create the first account
```

Tests: `pnpm test` runs the planner rules. Set `TEST_DATABASE_URL` to an empty database to also run the database tests; that database is wiped on each run.

## Stack

Next.js 15 (TypeScript), PostgreSQL with Drizzle ORM, Vitest. Hosting on AWS comes later.
