import type { Article } from "../types";

export const keep: Article[] = [
  {
    slug: "stock",
    area: "keep",
    title: "Read the stock",
    summary: "How much of everything you have, what is reserved or promised, and what is free.",
    go: { href: "/stock", label: "Open Stock" },
    keywords: ["inventory", "stock levels", "reserved", "free", "on order", "finished jars", "promised"],
    more: [
      "[Stock](/stock) has four tabs: **Ingredients**, **Packaging**, **Other** and **Finished jars**. Ingredients and jars can also be filtered by where they are kept: **Anywhere**, **Fridge**, **Freezer**, **Room temperature** or **Not set**.",
      {
        table: {
          head: ["Column", "Means"],
          rows: [
            ["In stock", "What is physically there, the sum of all its lots. **not counted** if the item was never counted."],
            ["Reserved for runs", "Held by confirmed runs that haven't used it yet."],
            ["Free", "In stock minus reserved: what a new plan can count on."],
            ["On order", "In orders already sent and not yet received."],
            ["Promised to orders", "(jars) Held for pending sales orders, still on the shelf."],
            ["Batch lots", "(jars) How many lots of that product still have jars."],
          ],
        },
      },
      "Press an item to open its card with every lot and every movement. See [The item card](help:item-card).",
      "**Correct or write off** at the top leads to stock corrections. See [Correct stock](help:correct-stock).",
    ],
    related: ["item-card", "opening-count", "correct-stock", "storage"],
  },
  {
    slug: "item-card",
    area: "keep",
    title: "The item card",
    summary: "One page per item: stock and lots, every movement, suppliers and prices, and its details.",
    keywords: ["item page", "lots", "movements", "ledger", "retire item", "rename item"],
    more: [
      "Open it from [Stock](/stock), from [Settings → Items](/settings/items) or from any link on an item name.",
      {
        ul: [
          "Top line: **in stock now**, lots with stock, where it is **kept**, and its favourite supplier with the price.",
          "**Order** opens a new purchase order for this item with its favourite supplier.",
          "**Item details**: storage place and shelf life (ingredients), **Rename**, and **Retire** / **Bring back**.",
          "**Stock** tab: **Lots with stock** (where each came from, date, best-before, kept in, left), empty lots, and **Stock movements**: every in and out with date, what happened, lot and change.",
          "**Suppliers** tab: every supplier that sells it in favourite order, with price, price history and **Add supplier**.",
          "**History** at the bottom: every change made to the item.",
        ],
      },
      "A retired item leaves lists and new recipes; its stock and history stay. An item still used by an active recipe or packaging list can't be retired: make a new version without it first.",
    ],
    related: ["stock", "suppliers", "items", "trace"],
  },
  {
    slug: "opening-count",
    area: "keep",
    title: "Opening stock count",
    summary: "The first count of each item, so the app knows what you have.",
    go: { href: "/stock/count", label: "Record an opening count" },
    keywords: ["initial stock", "first count", "inventory count", "not counted", "unknown stock"],
    steps: [
      "Open [Stock](/stock) → **Record an opening count**. Only items never counted are listed.",
      "Set **Counted on**.",
      "Enter the quantity of each item you counted, in its unit. Enter **0** if you have none; leave it empty if you haven't counted it yet.",
      "Add the **Best before** if you know it.",
      "Press **Save count**.",
    ],
    changes: [
      "Each counted line becomes its own lot (code like `OPEN-20261105-001`), traceable like a delivery.",
      "Items left empty stay **not counted** and their stock stays unknown in plans.",
    ],
    mistakes: [
      {
        problem: "I typed a wrong opening count.",
        fix: "Counts can't be edited afterwards. Fix it with a [count correction](help:correct-stock), so the history stays visible.",
      },
    ],
    related: ["correct-stock", "stock", "set-up"],
  },
  {
    slug: "correct-stock",
    area: "keep",
    title: "Correct stock: recount or write off",
    summary: "Fix the stock of an item after a recount, or take stock out of a lot that was thrown away, used or given.",
    go: { href: "/stock/adjust", label: "Correct or write off" },
    keywords: ["count correction", "recount", "write-off", "waste", "breakage", "adjustment", "found stock", "monthly count"],
    more: [
      { h: "Count correction" },
      {
        ol: [
          "Open [Stock](/stock) → **Correct or write off** → **Count correction**.",
          "Choose the **Item you counted**. Its lots with stock are listed with what the system says.",
          "Enter what you **Counted** in each lot. Found some without a lot? Use **Found stock without a lot** (with a best-before if known).",
          'Fill **Counted on** and **Reason** (for example "monthly count") and press **Save count**.',
        ],
      },
      "Only the differences are recorded. The original numbers and the correction both stay in the history. Found stock becomes a lot with a code like `COUNT-20261105-001`.",
      { h: "Write-off" },
      {
        ol: [
          "Open **Correct or write off** → **Write-off**.",
          "Choose the **Lot**, the **Quantity**, **What happened** (Waste, Internal use or Sample), the **Date** and the **Reason**.",
          "Press **Write off**. You can't write off more than the lot has left.",
        ],
      },
      { note: "For finished jars, don't use a write-off: use [Outbound → Record a stock exit](help:stock-exit), so the trace shows where the jars went." },
      { h: "Undoing a correction" },
      "Each correction has its own page (from the item's movements or the [History](/history)). There you can delete it with a reason, which reverses its stock, and restore it later. It is refused if the stock it would need is no longer there.",
    ],
    related: ["opening-count", "stock", "stock-exit", "corrections"],
  },
  {
    slug: "storage",
    area: "keep",
    title: "Where things are kept",
    summary: "Fridge, Freezer or Room temperature for each ingredient, each product's jars and each lot.",
    keywords: ["storage", "fridge", "freezer", "room temperature", "kept in", "cold"],
    more: [
      "Each ingredient has a default storage place on its card and in [Settings → Items](/settings/items). Each product has one for its filled jars in [Settings → Sauces, sizes & products](/settings/catalog). Packaging and other items have none.",
      "New lots take the default. A single lot can differ: choose it in **Kept in** when recording a delivery, or later on the lot page (**Move it or correct the best-before**).",
      "In [Stock](/stock) you can filter ingredients and jars by place, and the Pack step shows where each size is kept.",
    ],
    related: ["stock", "record-delivery", "sauces-sizes-products"],
  },
  {
    slug: "shelf-life",
    area: "keep",
    title: "Shelf life, best-before and expiry alerts",
    summary: "How best-before dates are filled in, and how Today warns you before they pass.",
    keywords: ["best before", "expiry", "expiration", "shelf life", "caducidad", "use first", "FEFO"],
    more: [
      { h: "Shelf life" },
      "Set it in days, weeks or months: for each product in [Settings → Sauces, sizes & products](/settings/catalog) (column **Shelf life (from packing)**), and optionally for each ingredient in [Settings → Items](/settings/items) or on its card.",
      { h: "Best-before" },
      {
        ul: [
          "Jars: when packing, the best-before is filled in as the packing date plus the product's shelf life. It can be changed for that lot.",
          "Ingredients: an ingredient delivered without a best-before gets the delivery date plus its shelf life.",
          "Any lot's best-before can be corrected later from its page in [Trace](/trace).",
        ],
      },
      { h: "Use the oldest first" },
      "When ingredients are recorded on a batch and when jars are delivered, the lot with the earliest best-before is used first unless you choose another lot.",
      { h: "Expiry alerts" },
      "[Today](/) lists every lot of ingredients or jars in stock that is past its best-before (red) or within 30 days of it (amber), with what is left and **Open lot**.",
    ],
    related: ["today", "pack-batch", "jar-labels", "sauces-sizes-products"],
  },
  {
    slug: "trace",
    area: "keep",
    title: "Trace a lot and handle a recall",
    summary: "Follow any lot forward to the customers and backward to the suppliers.",
    go: { href: "/trace", label: "Open Trace" },
    keywords: ["traceability", "recall", "lot", "forward", "backward", "where did it go", "supplier batch", "barcode", "scan"],
    steps: [
      "Open [Trace](/trace) and type a lot, batch or order code, a supplier batch number or an item name (a barcode scanner reading a jar label types the lot code for you). Press **Search**.",
      "Open the lot you want.",
    ],
    more: [
      { h: "What the lot page shows" },
      {
        ul: [
          "A diagram from supplier → lot → batch → jar lots → destinations. Point at a box to light up its path.",
          "Where it came from, received or made on, best-before, where it is kept and what is still in stock, plus its delivery note and invoice.",
          "**Recall summary**: the batches that used it, what is unused in stock, jars still in stock, sauce not yet in jars, and jars already out with who received them.",
          "**Forward: where it went**: batches that used it, jar lots made, and every destination with date, type, customer and jars.",
          "**Backward: what went into it**: for jars, the batch, its ingredient lots (with supplier and supplier batch) and the packaging lots.",
        ],
      },
      "From a stock exit (an outflow), the page shows the jars that left and traces them back to their batch and ingredient lots.",
      { h: "If a supplier warns about a bad lot" },
      {
        ol: [
          "Search the supplier batch number in [Trace](/trace).",
          "Open the lot and read the **Recall summary**.",
          "Stop using what is still in stock (write it off or set it aside) and contact the customers listed under jars already out.",
        ],
      },
      "Traceability is per lot (one batch in one size), not per single jar.",
    ],
    related: ["jar-labels", "record-delivery", "cook-batch", "stock-exit"],
  },
  {
    slug: "history",
    area: "keep",
    title: "History of changes",
    summary: "Every create, change, delete and restore in the app, with when, what changed and why.",
    go: { href: "/history", label: "Open History" },
    keywords: ["audit", "log", "who changed", "changes", "undo", "edited"],
    more: [
      "[History](/history) lists every change, newest first: what was done, before → after, and the reason.",
      "Filter by area (Production, Packaging, Purchasing, Sales, Stock, Settings), by **What** (created, changed, deleted, restored, steps such as confirm or close), by dates, or by a **Code** such as a batch, order or lot code.",
      "Each record's own page has a **History** section at the bottom with its changes and those of what hangs from it (a run shows its batches' changes too). An **Edited** mark under a title means it was changed after it was made; press it to jump to the history.",
    ],
    related: ["corrections", "statuses"],
  },
];
