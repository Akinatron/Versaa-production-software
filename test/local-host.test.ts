import { describe, expect, it } from "vitest";
import { isLocalHost } from "../src/lib/local-host";

describe("isLocalHost", () => {
  it("accepts this computer on any port", () => {
    for (const host of ["localhost", "localhost:3000", "127.0.0.1:51234", "LOCALHOST:3000", "[::1]:3000"]) expect(isLocalHost(host)).toBe(true);
  });
  it("turns away any other name", () => {
    for (const host of [null, undefined, "", "evil.example:3000", "192.168.1.20:3000", "localhost.evil.example", "127.0.0.1.nip.io:3000", "0.0.0.0:3000"])
      expect(isLocalHost(host)).toBe(false);
  });
});
