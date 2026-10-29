import { describe, expect, it } from "vitest";
import { inSentence, PO_STATUS_NAME, RUN_STATUS_NAME, SALES_STATUS_NAME } from "@/domain/status";
import { unitWord } from "@/domain/quantity";

describe("messages use the words shown on screen", () => {
  it("names statuses as the badges do", () => {
    expect(inSentence(RUN_STATUS_NAME, "in_progress")).toBe("in production");
    expect(inSentence(RUN_STATUS_NAME, "closed")).toBe("done");
    expect(inSentence(PO_STATUS_NAME, "closed")).toBe("closed (not all arrived)");
    expect(inSentence(SALES_STATUS_NAME, "delivered")).toBe("delivered");
    // Never an internal word, even for a status without a name.
    expect(inSentence(RUN_STATUS_NAME, "some_new_state")).toBe("some new state");
  });

  it("writes units as people read them", () => {
    expect(unitWord("unit")).toBe("units");
    expect(unitWord("kg")).toBe("kg");
  });
});
