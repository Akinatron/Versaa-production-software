# Versaa Production Software

Operations app for Versaa: production planning, purchasing, inventory, production, packaging, traceability and sales.

## What works now

- **Plan production** (`/plan`): enter target sellable jars per sauce and size and see the litres needed, batches, expected surplus, jars to fill, ingredients, packaging, stock coverage and what to buy. Planning never changes stock.
- **Settings** (`/settings`): recipes and packaging per jar (from the starting catalog), yield estimates per sauce and reject allowances per product.

Anything that can't be worked out yet (no yield figure, no stock count) is shown as **unknown**, never as 0.

## Rules built into the data

- Stock is the sum of an append-only ledger (`movements`). The database refuses edits or deletes; corrections are new movements.
- Every quantity lives in a lot, for traceability from supplier to customer.
- Recipes and packaging lists are versioned; a batch keeps the version it used.
- Every recording action carries an idempotency key, so a retry or double click can't post twice.
- kg, L and jars are never converted into each other.

## Starting data

`data/catalog-v1.json` holds the recipes, 25 ingredients, 20 packaging items and 9 products exactly as provided by Pablo on 17 Oct 2026. No yield or price data exists yet and none is invented.

## Running it

Requires Node 22, pnpm and PostgreSQL 16.

```sh
pnpm install
export DATABASE_URL=postgres://user:pass@localhost/versaa
pnpm db:migrate     # create tables
pnpm db:seed        # load the starting catalog (safe to repeat)
pnpm dev            # http://localhost:3000
```

Tests: `pnpm test` runs the planner rules. Set `TEST_DATABASE_URL` to an empty database to also run the database tests; that database is wiped on each run.

## Stack

Next.js 15 (TypeScript), PostgreSQL with Drizzle ORM, Vitest. Planned hosting: AWS Amplify + Amazon RDS for PostgreSQL + Cognito login.
