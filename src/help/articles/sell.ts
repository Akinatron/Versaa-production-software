import type { Article } from "../types";

export const sell: Article[] = [
  {
    slug: "outbound",
    area: "sell",
    stage: "sell",
    title: "Outbound",
    summary: "Every jar that leaves stock: sales orders to deliver, jars available, and the history of exits.",
    go: { href: "/outbound", label: "Open Outbound" },
    keywords: ["sales", "sell", "jars out", "outflow", "to deliver", "jars available"],
    more: [
      {
        table: {
          head: ["Tab", "Shows"],
          rows: [
            ["**To deliver**", 'Pending sales orders, with **Deliver** and **Cancel**. An order stock can\'t cover says "not enough jars in stock".'],
            ["**Jars available**", "Each product: in stock, promised to orders, and free."],
            ["**History**", "Every stock exit, filtered by reason. Open a code to trace the jars back."],
          ],
        },
      },
      "**New sales order** takes an order to deliver later; **Record a stock exit** records jars leaving now. **Customers** (top right) keeps the customer list.",
      { h: "Reasons jars leave" },
      {
        table: {
          head: ["Reason", "Use it for"],
          rows: [
            ["Sale", "Jars sold to a customer. The only reason that counts as sales."],
            ["Own use", "Jars the team uses itself: cooking, staff, the office."],
            ["Test", "Jars opened for tests and trials: quality checks, shelf-life, new recipes."],
            ["Sample / gift", "Jars given away for free: tastings, samples for shops, gifts."],
            ["Waste / loss", "Jars thrown away: broken, spoiled or failed a check. A note saying why is required."],
          ],
        },
      },
      "All of them take jars out of stock and stay traceable. Only sales count in the sales reports.",
    ],
    related: ["sales-orders", "deliver-order", "stock-exit", "customers"],
  },
  {
    slug: "sales-orders",
    area: "sell",
    stage: "sell",
    title: "Take a sales order",
    summary: "Record what a customer ordered; the jars are held for them until you deliver.",
    go: { href: "/outbound/orders/new", label: "New sales order" },
    keywords: ["customer order", "sales order", "reserve jars", "promised", "deliver by"],
    steps: [
      "Open [Outbound](/outbound) → **New sales order**.",
      "Choose the **Customer**, or write a **destination**, or both (one is required). **Add a customer** if they are new.",
      "Optionally add the **Customer reference** and **Deliver by** date. **Order date** is required.",
      "Add each product with its jars and, if you like, the price per jar.",
      "Press **Save order**.",
    ],
    changes: [
      "The jars are **promised** to the order: they stay on the shelf, but other orders and sales see them as not free.",
      "Stock only goes down when you deliver the order.",
      "The order shows on Today under **Coming up** (to deliver), and in Plan → **From sales orders**.",
    ],
    more: [
      "Not enough jars? Plan production for the orders with [Plan production → From sales orders](help:plan-production).",
      "While it waits, **Correct this order** changes the customer, dates, products, jars or prices (set jars to 0 to drop a line), with a reason. **Cancel this order** frees the promised jars; it can be restored.",
    ],
    related: ["deliver-order", "plan-production", "customers"],
  },
  {
    slug: "deliver-order",
    area: "sell",
    stage: "sell",
    title: "Deliver a sales order",
    summary: "Take the jars out of stock from the right lots and record the sale.",
    keywords: ["deliver", "ship", "dispatch", "send jars", "fulfil order", "which lot"],
    steps: [
      "In [Outbound](/outbound) → **To deliver**, press **Deliver** on the order.",
      "Set the **Delivery date**.",
      "For each product, choose where the jars come from: **Earliest best-before first (recommended)** shows which lots it will take, or **I'll choose the lots** and enter jars per lot (they must add up to the product's jars in the order; with the same product on several lines, the lots fill the lines in order).",
      "Press **Deliver now** and confirm.",
    ],
    changes: [
      "The jars leave stock from those lots and a **Sale** is recorded with the customer and prices. The order becomes **Delivered**.",
      "The delivery has its own page (**Trace this delivery**) linking the jars back to their batches and ingredient lots.",
    ],
    mistakes: [
      {
        problem: '"Not enough in stock: … jars short".',
        fix: "Pack more, or correct the order to what you can deliver now and take a new order for the rest.",
      },
      {
        problem: "I delivered the wrong lot or number.",
        fix: "Open the delivery from [Outbound → History](/outbound?show=history), delete it with a reason (the order goes back to waiting) and deliver again.",
      },
    ],
    related: ["sales-orders", "stock-exit", "trace"],
  },
  {
    slug: "stock-exit",
    area: "sell",
    stage: "sell",
    title: "Record a stock exit",
    summary: "Jars leaving now: a sale handed over on the spot, own use, a test, a sample or waste.",
    go: { href: "/outbound/new", label: "Record a stock exit" },
    keywords: ["sale now", "sample", "gift", "waste", "own use", "test", "write off jars", "outflow", "correct exit", "delete exit"],
    steps: [
      "Open [Outbound](/outbound) → **Record a stock exit** (also on Today).",
      "Answer **Why are the jars leaving?** by choosing a reason.",
      "For a **Sale**: if it is one of the pending orders, press it there and deliver it. Otherwise fill the customer or destination, reference, date and note.",
      "Add each product, the jars and, optionally, the lot (by default **Earliest best-before first**) and, for sales, the price per jar.",
      "Press the record button.",
    ],
    changes: [
      "The jars leave stock from those lots straight away. A **Sale** can only take free jars: jars promised to sales orders are kept for them. Waste, samples, tests and own use only need the jars to be there, even promised ones (broken is broken); the app then tells you which sales orders are now short.",
      "Sizes no longer in use still appear, marked **(not in use)**, while they have jars in stock.",
      "Each exit gets a code: `OUT-` sales, `SMP-` samples, `INT-` own use, `TST-` tests, `WST-` waste, then the date and a number.",
    ],
    more: [
      { h: "Correcting an exit" },
      "Open it from [Outbound → History](/outbound?show=history). **Correct the details** changes the date, customer, destination or reference, with a reason. To change the jars or lots, delete it with a reason (the jars go back into stock) and record it again. A deleted exit can be restored if the jars are still there.",
      { note: "Selling later? Take a [sales order](help:sales-orders) instead: it holds the jars and stock goes down on delivery." },
    ],
    related: ["outbound", "deliver-order", "correct-stock", "trace"],
  },
  {
    slug: "customers",
    area: "sell",
    stage: "sell",
    title: "Customers",
    summary: "The people and shops you sell to, with their orders and the last jars sent.",
    go: { href: "/outbound/customers", label: "Open Customers" },
    keywords: ["client", "customer list", "shop", "add customer"],
    steps: ["Open [Outbound](/outbound) → **Customers**.", "Under **Add a customer**, enter the **Name** (required), contact and notes, and save."],
    more: [
      "**All customers** shows each one with their contact, orders and the date jars were last sent.",
      "Coming from an order form, you go back to it after adding the customer.",
      "A sale or order can also go to a free-text destination instead of a customer.",
    ],
    related: ["sales-orders", "stock-exit"],
  },
  {
    slug: "reports",
    area: "sell",
    title: "Reports and downloads",
    summary: "Sales, other exits, production, rejects and plan vs actual for any period, plus spreadsheet downloads.",
    go: { href: "/reports", label: "Open Reports" },
    keywords: ["report", "figures", "revenue", "csv", "excel", "export", "download", "rejects", "plan vs actual"],
    steps: ["Open [Reports](/reports), set **From** and **To (inclusive)**, and update."],
    more: [
      {
        ul: [
          "**Sales**: jars sold by sauce and size, revenue from recorded prices (never called profit) and jars sold without a price.",
          "**Other stock exits (not sales)**: per reason and product.",
          "**Production**: batches closed with litres from jars, filled, rejected and accepted; and **Jars by size** with the measured reject rate.",
          "**Plan vs actual**: for each run closed in the period, the forecast frozen at confirmation against what was recorded.",
        ],
      },
      { h: "Downloads" },
      "Each table comes as **Excel** or **CSV**, for **Everything** or **this period**. Use **Excel**: it opens the same in any Excel, Numbers or Google Sheets, whatever the computer's language, with real numbers and dates, a header that stays visible and filters. **CSV** is plain text (commas, decimal point) for other tools; a Spanish Excel puts each of its rows in one column.",
      {
        ul: [
          "**Stock movements**: the full ledger, every quantity in or out with item, lot, reason and document.",
          "**Lots**: every lot with its origin and what is left.",
          "**Outbound (all stock exits)**: every jar that left stock with reason, date, customer, product, lot, batch and price.",
          "**Batches**: every batch with recipe version, dates, litres and jars.",
        ],
      },
    ],
    related: ["close-batch", "outbound", "yields"],
  },
];
