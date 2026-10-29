import type { Faq } from "./types";

export const FAQ: Faq[] = [
  {
    area: "make",
    q: "Why does the plan say I need to buy something I have in stock?",
    a: [
      "Part of that stock is probably still needed by a confirmed run that comes first. Look at the **Held by earlier runs** column: stock and orders go to earlier runs first, so they aren't counted again. Orders still in draft don't count as **on order** either; mark them as sent.",
    ],
    related: ["plan-math", "send-order"],
  },
  {
    area: "make",
    q: "How many batches do I need for a given number of jars?",
    a: [
      "Enter the jars in [Plan production](/plan) → **By jars** and press **Calculate**: the **Batches** table shows them. In short: jars to fill (with the reject allowance) × fill per jar gives litres, divided by the sauce's litres per batch and rounded up.",
    ],
    related: ["plan-math"],
  },
  {
    area: "make",
    q: "Can I change a run after confirming it?",
    a: [
      "No. A confirmed run's forecast is frozen so it can be compared with the real result. Before anything is recorded you can **Cancel run** and plan it again; once production has started, plan a second run for anything extra.",
    ],
    related: ["runs"],
  },
  {
    area: "make",
    q: "I cooked less (or more) than planned. What happens to the jars?",
    a: [
      "Nothing to fix by hand: record what you really used in **Cook** and what you really filled in **Pack**. The run's **Plan vs actual** shows the difference, and once the batch is closed its real litres feed the next plans.",
    ],
    related: ["cook-batch", "pack-batch", "close-batch"],
  },
  {
    area: "make",
    q: "It says there isn't enough stock when I record ingredients or jars.",
    a: [
      "Stock can't go below zero, so the app refuses to take what isn't recorded. Usually a delivery hasn't been recorded yet, or the count is off. Record the delivery, or fix the number with a [count correction](/stock/adjust), then record again. For ingredients you can also **Split between lots**.",
    ],
    related: ["record-delivery", "correct-stock"],
  },
  {
    area: "make",
    q: "I made a mistake in a closed batch. Can I fix it?",
    a: [
      "Yes. Ingredients can be corrected in **Cook**, packaging sessions in **Pack**, and the cooking date, note and incidents in **Close**. Each change asks for a reason and moves stock by the difference.",
    ],
    related: ["corrections"],
  },
  {
    area: "make",
    q: "A planned batch wasn't made. What do I do?",
    a: [
      "Open its **Close** step → **This batch wasn't made**, say why and press **Mark as not made**. It works while nothing is recorded on it, and frees its reserved stock.",
    ],
    related: ["close-batch"],
  },
  {
    area: "make",
    q: "Where do the litres per batch come from?",
    a: [
      "From your estimate in [Settings → Yields & rejects](/settings/yields) until the first batch of that sauce is closed. From then on, the average of closed batches is used automatically.",
    ],
    related: ["yields"],
  },
  {
    area: "make",
    q: "Why is the best-before empty when I pack?",
    a: ["The product has no shelf life set. Add it in [Settings → Sauces, sizes & products](/settings/catalog), or type the date by hand."],
    related: ["shelf-life"],
  },
  {
    area: "make",
    q: "The labels print in the wrong place on the sticker sheet.",
    a: ["Print at 100% (actual size) with no margins, and set **Start at position** if the sheet is partly used."],
    related: ["jar-labels"],
  },
  {
    area: "buy",
    q: "How do I send an order to a supplier?",
    a: [
      "Open the draft order: copy the text, open it in email or WhatsApp, or print it as a PDF. Then press **Mark as sent**. The app never sends anything on its own.",
    ],
    related: ["send-order"],
  },
  {
    area: "buy",
    q: "A delivery arrived incomplete or with damaged goods. How do I record it?",
    a: [
      "Record what you accepted, put the rest under **Refused** with the problem under **Damage / problem**. The order stays **Partly received** and keeps waiting. If the rest won't come, open the order and **Close this order**.",
    ],
    related: ["record-delivery", "orders"],
  },
  {
    area: "buy",
    q: "Goods arrived that I never ordered in the app.",
    a: ["Record the delivery with **No order / not listed**, choose the supplier and add the items. They become lots like any other delivery."],
    related: ["record-delivery"],
  },
  {
    area: "buy",
    q: "How do I change a supplier's price?",
    a: ["Press **Edit price** next to it, on the supplier's card or on the item's **Suppliers** tab. The old price stays in **Price history**."],
    related: ["suppliers"],
  },
  {
    area: "buy",
    q: "Where do delivery notes and invoices go?",
    a: ["The delivery note goes with its delivery (a photo or PDF), the invoice with its order. Both show on the lot, the order, the supplier and the trace."],
    related: ["paperwork"],
  },
  {
    area: "keep",
    q: 'Why does an item say "not counted"?',
    a: [
      "It has never been counted, so its stock is unknown and plans can't say whether it's covered. Count it in [Stock → Record an opening count](/stock/count).",
    ],
    related: ["opening-count"],
  },
  {
    area: "keep",
    q: "The stock on screen doesn't match the shelf.",
    a: ["Recount it with [Correct or write off → Count correction](/stock/adjust). Only the difference is recorded, with your reason."],
    related: ["correct-stock"],
  },
  {
    area: "keep",
    q: "How do I find which customers got jars made with a specific ingredient lot?",
    a: [
      "Search the lot (or its supplier batch number) in [Trace](/trace) and open it. The **Recall summary** and **Every destination** list each customer and how many jars.",
    ],
    related: ["trace"],
  },
  {
    area: "keep",
    q: "Why is a lot red on Today?",
    a: ["It is past its best-before. Amber means it reaches it within 30 days. Use or sell those lots first."],
    related: ["shelf-life"],
  },
  {
    area: "keep",
    q: "Can I see who changed something and why?",
    a: ["Yes: the **History** section at the bottom of each record, or [History](/history) for the whole app, with every change, its date and its reason."],
    related: ["history"],
  },
  {
    area: "sell",
    q: "What is the difference between a sales order and a stock exit?",
    a: [
      "A sales order is a promise: the jars are held for the customer and stock goes down when you deliver. A stock exit is jars leaving right now (a sale on the spot, a sample, own use, a test or waste).",
    ],
    related: ["sales-orders", "stock-exit"],
  },
  {
    area: "sell",
    q: "Why can't I sell jars that are on the shelf?",
    a: [
      "They are promised to a pending sales order. **Jars available** in Outbound shows in stock, promised and free. Deliver or correct that order, or pack more.",
    ],
    related: ["outbound"],
  },
  {
    area: "sell",
    q: "I gave away or broke some jars. How do I record it?",
    a: [
      "[Record a stock exit](/outbound/new) with **Sample / gift** or **Waste / loss** (waste needs a note saying why). It leaves stock and stays traceable, but doesn't count as a sale.",
    ],
    related: ["stock-exit"],
  },
  {
    area: "sell",
    q: "Are the report revenues my profit?",
    a: ["No. Revenue is jars sold × the prices recorded on them. Jars sold without a price are counted separately."],
    related: ["reports"],
  },
  {
    area: "settings",
    q: "How do I change a recipe without breaking old batches?",
    a: ["Press **Change recipe**: it makes a new version. Activate it when ready. Old batches keep the version they used; new plans use the new one."],
    related: ["recipes"],
  },
  {
    area: "settings",
    q: "How do I add a new sauce or jar size?",
    a: [
      "In [Settings → Sauces, sizes & products](/settings/catalog): add the sauce or size, then add the product (sauce × size). Give the sauce a recipe, the product a packaging list, and the sauce a litres-per-batch estimate before planning it.",
    ],
    related: ["sauces-sizes-products", "set-up"],
  },
  {
    area: "settings",
    q: "Can I try things without touching my real data?",
    a: ["Yes: turn on **Developer mode** at the bottom of Settings and press **Show mock data**. Nothing you do there is kept."],
    related: ["developer-mode"],
  },
  {
    area: "basics",
    q: "What do \"Page not found\" and \"Something went wrong\" mean?",
    a: [
      "**Page not found**: the address leads nowhere, for example an old link or something mistyped. Go **Back to Today**, or find the record in [History](/history).",
      "**Something went wrong**: the page failed in a way the app didn't expect. What was saved before is safe. Press **Try again**; if you had just pressed a button, check the page it was for before doing it again, because it may already be saved.",
    ],
    related: ["corrections"],
  },
];
