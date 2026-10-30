import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keepInput } from "@/app/components/keep-input";
import { OperationError } from "@/db/operations";

describe("forms that keep what was typed", () => {
  it("hands a business-rule error back to the form", async () => {
    const r = await keepInput(async () => {
      throw new OperationError("Enter at least one quantity received or refused.");
    });
    expect(r).toEqual({ error: "Enter at least one quantity received or refused." });
  });

  it("returns nothing when the action went through", async () => {
    expect(await keepInput(async () => {})).toBeUndefined();
  });

  it("lets other errors (and redirects) through", async () => {
    await expect(
      keepInput(async () => {
        throw new Error("NEXT_REDIRECT");
      }),
    ).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("long forms keep what was typed and warn before leaving", () => {
  // Each of these used to reload empty after an error, with no unsaved-changes warning.
  const forms: [string, string][] = [
    ["src/app/orders/new/page.tsx", "saveOrder"],
    ["src/app/settings/recipes/[sauceId]/page.tsx", "saveRecipe"],
    ["src/app/settings/packaging/[productId]/page.tsx", "savePackaging"],
    ["src/app/runs/[id]/page.tsx", "editDraft"],
    ["src/app/components/order-planner.tsx", "action"],
  ];
  it.each(forms)("%s uses GuardedForm", (file, action) => {
    const text = readFileSync(file, "utf8");
    expect(text).toContain(`<GuardedForm action={${action}}`);
    expect(text).not.toMatch(new RegExp(`<form action=\\{${action}\\}`));
  });
});
