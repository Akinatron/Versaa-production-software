# Versaa design notes

The app is a work tool used daily on laptops, tablets and phones. It should feel calm, plain and quick: the work is the content, not the interface.

## Principles
- **One clear next step per screen.** Pages lead with what needs doing (Today's "To do", a batch's next step, Outbound's "To deliver"), not with tables.
- **Step-by-step over walls of inputs.** Runs and batches are numbered steps; forms ask the first question first (for example "Why are the jars leaving?").
- **Hide what is rarely needed.** Planning notes, covered items, price editing, cancel actions and history sit in collapsible sections.
- **Every list has an empty state** that says what will appear and how to start.

## System (src/app/globals.css)
- Colour: a dark basil-green side menu on a neutral work surface. Green is the action colour; tomato red only marks the brand, the active menu item and urgent counts. Status uses five tones: neutral, info, ok, warn, bad. Dark mode follows the device and uses plain neutral greys (no colour tint) with softer accents.
- Sauce colours: each sauce has its own colour (chosen in Settings → Sauces), shown only as a small dot before the sauce or product name, and as a soft chip in the batch header. It identifies the sauce; it never means a status.
- Type: the system font, one tight scale. Numbers in tables use tabular figures.
- Components: `PageHeader` (back link, title, status, one-line lead, actions), `Steps`, `Empty`, `.stats`, `.worklist`, `.tabs`, `.choices`, `.linklist`, `.savebar` (sticky save on long forms), `.issues`.
- Dates read as "22 Oct" (`fmtDate`) or "in 3 days" (`relDate`); stored dates stay ISO.
- The side menu shows counts of waiting work (batches to cook or pack, draft orders, deliveries on the way, orders to deliver).
- Motion (`components/motion.tsx` + the motion block in globals.css): only to explain. Pages rise in, the step bar and tab pill slide from the previous one, notices drop in, a pressed button shows a spinner until the server answers. 120–300 ms, ease-out, no bounce. Reduced motion keeps fades only.
- Trace diagram (`TraceFlow`): the lot trace opens with supplier → lot → batch → jar lots → destinations, drawn column by column; pointing at a box lights its path.

## Avoid
Coloured side borders on cards, gradients, emoji or arrow characters as icons, kicker labels above headings, modals, and more than one primary button per screen.
Big-number "hero" stat tiles: key facts sit on one quiet line (`.stats`). Explanatory subtitles on pages people use every day: the title and the content say enough. Long lists inside table cells: fold them (`OrderItems`) and keep the full detail on the record's own page.
