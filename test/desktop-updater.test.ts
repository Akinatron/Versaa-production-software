import { describe, expect, it } from "vitest";
import { isNewer, notesSince, parseManifest } from "../desktop/src/updater/manifest";

const good = {
  number: 14,
  commit: "a".repeat(40),
  commitTime: "2026-10-27T18:00:00Z",
  builtAt: "2026-10-27T18:20:00Z",
  zip: "Versaa-mac-arm64.zip",
  sha256: "b".repeat(64),
  size: 123,
  arch: "arm64",
  notes: [
    { time: "2026-10-27T18:00:00Z", text: "Check for updates (#17)" },
    { time: "2026-10-22T10:00:00Z", text: "Desktop app for Mac (#16)" },
  ],
};

describe("desktop updater manifest", () => {
  it("accepts a well-formed update.json and rejects a broken one", () => {
    expect(parseManifest(good).number).toBe(14);
    expect(() => parseManifest({ ...good, sha256: "nope" })).toThrow();
    expect(() => parseManifest({ ...good, zip: "../../evil.zip" })).toThrow();
    expect(() => parseManifest(null)).toThrow();
  });

  it("calls a build an update only when it is a later commit", () => {
    const current = { commit: "c".repeat(40), commitTime: "2026-10-22T10:00:00Z" };
    expect(isNewer(good, current)).toBe(true);
    expect(isNewer(good, { ...current, commit: good.commit })).toBe(false);
    expect(isNewer({ ...good, commitTime: "2026-10-01T00:00:00Z" }, current)).toBe(false);
  });

  it("lists only the changes since the running copy", () => {
    expect(notesSince(good.notes, { commitTime: "2026-10-22T10:00:00Z" })).toEqual(["Check for updates (#17)"]);
  });
});
