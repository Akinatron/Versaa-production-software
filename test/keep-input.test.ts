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
