# Versaa design notes

The app is a work tool used daily on laptops, tablets and phones. It should feel calm, plain and quick: the work is the content, not the interface.

## Principles
- **One clear next step per screen.** Pages lead with what needs doing (Today's "To do", a batch's next step, Outbound's "To deliver"), not with tables.
- **Step-by-step over walls of inputs.** Runs and batches are numbered steps; forms ask the first question first (for example "Why are the jars leaving?").
- **Hide what is rarely needed.** Planning notes, covered items, price editing, cancel actions and history sit in collapsible sections.
- **Every list has an empty state** that says what will appear and how to start.

## System (src/app/globals.css)
- Colour: a dark basil-green side menu on a neutral work surface. Green is the action colour; tomato red only marks the brand, the active menu item and urgent counts. Status uses five tones: neutral, info, ok, warn, bad. Dark mode follows the device.
- Type: the system font, one tight scale. Numbers in tables use tabular figures.
- Components: `PageHeader` (back link, title, status, one-line lead, actions), `Steps`, `Empty`, `.stats`, `.worklist`, `.tabs`, `.choices`, `.linklist`, `.savebar` (sticky save on long forms), `.issues`.
- Dates read as "22 Oct" (`fmtDate`) or "in 3 days" (`relDate`); stored dates stay ISO.
- The side menu shows counts of waiting work (batches to cook or pack, draft orders, deliveries on the way, orders to deliver).

## Avoid
Coloured side borders on cards, gradients, emoji or arrow characters as icons, kicker labels above headings, modals, and more than one primary button per screen.
Big-number "hero" stat tiles: key facts sit on one quiet line (`.stats`). Explanatory subtitles on pages people use every day: the title and the content say enough. Long lists inside table cells: fold them (`OrderItems`) and keep the full detail on the record's own page.
