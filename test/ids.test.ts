import { describe, expect, it } from "vitest";
import { isId } from "@/lib/ids";

/* An address with something that can't be an id shows "Page not found", not a database error. */

describe("ids in addresses", () => {
  it("knows an id from anything else", () => {
    expect(isId("3f2b8c1e-9a4d-4e7f-8b2a-1c0d9e8f7a6b")).toBe(true);
    for (const bad of [
      "",
      "123",
      "new",
      "3f2b8c1e-9a4d-4e7f-8b2a-1c0d9e8f7a6",
      "------------------------------------",
      "3f2b8c1e-9a4d-4e7f-8b2a-1c0d9e8f7a6b/x",
    ])
      expect(isId(bad), bad).toBe(false);
  });
});
