import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, MAX_FILES, MAX_REQUEST, MAX_TOTAL_BYTES, uploadProblem } from "@/domain/uploads";
import { litresFromJars } from "@/domain/quantity";
import { isOnTheWay, isPoDone, PO_DONE, PO_ON_THE_WAY, PO_OPEN, PO_STATUS_NAME } from "@/domain/status";
import { MOVEMENT, OUTFLOW } from "@/app/components/labels";

/* Values used in several places come from one place, so they can't drift apart. */

describe("one source for shared values", () => {
  it("upload limits: the form and the server say the same, and the total counts too", () => {
    expect(uploadProblem([{ name: "a.jpg", size: MAX_FILE_BYTES + 1 }])).toMatch(/over 20 MB/);
    expect(uploadProblem(Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ name: `${i}.jpg`, size: 1 })))).toMatch(/at most 10 files/);
    expect(uploadProblem([1, 2, 3].map((i) => ({ name: `${i}.pdf`, size: 18 * 1024 * 1024 })))).toMatch(/more than 50 MB/);
    expect(uploadProblem([{ name: "ok.pdf", size: 1000 }])).toBe("");
    // The server lets through a bit more than the files, for the rest of the form.
    expect(Number.parseInt(MAX_REQUEST) * 1024 * 1024).toBeGreaterThan(MAX_TOTAL_BYTES);
  });

  it("order statuses: every status is in exactly one group", () => {
    const all = Object.keys(PO_STATUS_NAME).sort();
    expect([...PO_OPEN, ...PO_DONE].sort()).toEqual(all);
    for (const s of PO_ON_THE_WAY) expect(isOnTheWay(s) && !isPoDone(s)).toBe(true);
    expect(isOnTheWay("draft")).toBe(false);
  });

  it("litres from jars and outflow names", () => {
    expect(litresFromJars(10, 700).toString()).toBe("7");
    expect(litresFromJars(3, 250).toString()).toBe("0.75");
    for (const [type, name] of Object.entries(OUTFLOW)) expect(MOVEMENT[type]).toBe(name);
  });
});
