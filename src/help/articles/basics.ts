import type { Article } from "../types";

export const basics: Article[] = [
  {
    slug: "statuses",
    area: "basics",
    title: "Every status, in one place",
    summary: "What each status of a run, batch, order, delivery and sales order means, and what moves it on.",
    keywords: ["status", "state", "lifecycle", "draft", "confirmed", "closed", "cancelled", "badge"],
    more: [
      { h: "Run" },
      {
        table: {
          head: ["Status", "Moves on when"],
          rows: [
            ["Draft", "You press **Confirm run**, or **Discard** it."],
            ["Confirmed", "The first ingredients are recorded on one of its batches, or you **Cancel run**."],
            ["In production", "Every batch is closed or marked as not made."],
            ["Done", "Final."],
            ["Cancelled", "A discarded draft can be restored; a cancelled confirmed run can't."],
          ],
        },
      },
      { h: "Batch" },
      {
        table: {
          head: ["Status", "Moves on when"],
          rows: [
            ["To cook", "Ingredients are recorded (Cooking), or it is marked as not made."],
            ["Cooking", "Every ingredient line is recorded (To pack)."],
            ["To pack", "The first packaging session is saved (Packing)."],
            ["Packing", "You press **Close batch**."],
            ["Closed", "Final. Ingredients and packaging can still be corrected with a reason."],
            ["Not made", "**Restore batch** brings it back while its run is open."],
          ],
        },
      },
      { h: "Purchase order" },
      {
        table: {
          head: ["Status", "Moves on when"],
          rows: [
            ["Draft, not sent", "You press **Mark as sent**, or cancel it."],
            ["Sent", "A delivery is recorded (Partly received or Received), or you cancel it."],
            ["Partly received", "The rest arrives (Received) or you **Close order**."],
            ["Received", "Final."],
            ["Closed (not all arrived)", "Final."],
            ["Cancelled", "**Restore order** brings it back as a draft or sent."],
          ],
        },
      },
      { h: "Sales order" },
      {
        table: {
          head: ["Status", "Moves on when"],
          rows: [
            ["To deliver", "You deliver it (Delivered) or cancel it."],
            ["Delivered", "Deleting its delivery puts it back to To deliver."],
            ["Cancelled", "It can be restored, and its jars are promised again."],
          ],
        },
      },
      { h: "Recipes and packaging lists" },
      "**Draft (not used yet)** → **Active** (used by new plans and batches) → **Retired** (replaced by a newer version, kept for the batches that used it).",
    ],
    related: ["runs", "batches", "orders", "sales-orders"],
  },
  {
    slug: "codes",
    area: "basics",
    title: "Codes and what they mean",
    summary: "How to read the codes the app gives runs, batches, lots, orders and stock exits.",
    keywords: ["code", "lot code", "batch code", "numbering", "reference", "RUN", "PO", "RCV", "OPEN", "SO", "OUT"],
    more: [
      "Dates inside codes are written YYYYMMDD. The number at the end counts up within that day, so two codes are never the same. Older runs and sales orders keep the codes they were given, which end in four letters (`RUN-20261029-A3F9`). Any code can be typed into [Trace](/trace) or the [History](/history) filter.",
      {
        table: {
          head: ["Code", "Is", "Example"],
          rows: [
            ["RUN-date-NN", "A production run, by its production date.", "`RUN-20261105-01`"],
            ["Prefix-date-NN", "A batch: the sauce's prefix, the run's production date and a number.", "`BOL-20261105-01`"],
            ["Batch code-size", "A lot of finished jars: one batch in one jar size (ml).", "`BOL-20261105-01-500`"],
            ["PO-date-NN", "A purchase order.", "`PO-20261101-01`"],
            ["RCV-date-NNN", "A lot received in a delivery.", "`RCV-20261103-002`"],
            ["OPEN-date-NNN", "A lot from the opening stock count.", "`OPEN-20261020-014`"],
            ["COUNT-date-NNN", "A lot of stock found during a count correction.", "`COUNT-20261130-001`"],
            ["SO-date-NN", "A sales order, by the day it was ordered.", "`SO-20261110-02`"],
            ["OUT / SMP / INT / TST / WST-date-NNN", "A stock exit: sale, sample, own use, test, waste.", "`OUT-20261112-003`"],
          ],
        },
      },
    ],
    related: ["trace", "statuses"],
  },
  {
    slug: "corrections",
    area: "basics",
    title: "Correct, delete and restore",
    summary: "How mistakes are fixed without losing what happened: a reason every time, and nothing really deleted.",
    keywords: ["mistake", "undo", "edit", "delete", "restore", "reason", "fix", "wrong"],
    more: [
      "Almost everything can be corrected after it is saved: batches, packaging sessions, runs, purchase orders, deliveries, lots, sales orders, stock exits, stock counts and write-offs, and paperwork files.",
      {
        ul: [
          "**A reason is asked every time** you correct, delete or restore. It goes in the [History](/history). It is optional only on drafts.",
          '**Nothing is really deleted.** It is marked deleted (struck through, under "Deleted …"), its stock effect is reversed with new movements, and it can be restored. There is no time limit.',
          "**Stock moves by the difference.** Changing 10 kg to 8 kg puts 2 kg back; it doesn't erase the first record.",
          "**Some fixes are refused** when they would break stock: you can't delete a delivery whose goods were already used, or lower a packaging session whose jars have already left.",
        ],
      },
      { h: "Where each fix lives" },
      {
        table: {
          head: ["What", "Where"],
          rows: [
            ["Ingredients used", "The batch's **Cook** step: change and press **Record** again."],
            ["Jars packed", "The batch's **Pack** step: open the session under **Jars packed**."],
            ["Cooking date or note, incidents", "The batch's **Close** step."],
            ["A draft run", "**Edit** on the run."],
            ["A purchase order", "**Correct this order** on the order page."],
            ["A delivery", "**Correct this delivery** or **Delete this delivery** on its page."],
            ["A lot's best-before, supplier batch or storage", "The lot page in [Trace](/trace)."],
            ["A sales order", "**Correct this order** on the order page, while it waits."],
            ["A stock exit or sale", "Its page from [Outbound → History](/outbound?show=history)."],
            ["A stock number", "[Correct or write off](/stock/adjust)."],
          ],
        },
      },
    ],
    related: ["history", "correct-stock", "correct-delivery"],
  },
  {
    slug: "units",
    area: "basics",
    title: "Units, unknowns and rounding",
    summary: "kg, L and jars, why some figures say unknown, and how quantities are rounded.",
    keywords: ["unit", "kg", "litres", "grams", "unknown", "rounding", "not counted", "estimate"],
    more: [
      "Every item has one stock unit: kg, g, L, ml or units. Packaging is always in units, finished jars are counted in jars.",
      "A recipe can use g for a kg item, or ml for an L item, but mass, volume and jars are never converted into each other. A 30 kg batch is never assumed to make 30 L.",
      "**Unknown** means the app can't work something out yet, for example an item never counted or a sauce without litres per batch. It is never shown as 0, so you don't buy or plan on a false number.",
      "Rounding: batches round up to whole batches; jars to fill round up; jar targets from batches round down; items counted in units round up; orders round up to whole packs of the chosen supplier.",
      "**Estimate** marks a figure you entered by hand; **measured** marks one worked out from recorded batches.",
      "Numbers can be typed with a comma or a point in every number box, whatever language Windows is in: `7,5` and `7.5` are the same. Don't use a thousands separator (write `1250`, not `1.250`). Jars, packs, ml and days are whole numbers, so `1.000` or `1,000` there is refused rather than read as 1. Something that isn't a number is refused with a message on the form, and what you typed stays.",
      "Days follow the time in the Netherlands (Europe/Amsterdam): a new day starts at local midnight, also for **Today** and for dates filled in by the app.",
    ],
    related: ["plan-math", "yields", "opening-count"],
  },
];
