import { describe, it, expect } from "vitest";
import { mockUrlFor } from "@/db/mock";

describe("the browser setup's mock database", () => {
  it("is the real database's name with _mock, on the same server", () => {
    expect(mockUrlFor("postgres://user:pass@localhost:5432/versaa")).toEqual({ url: "postgres://user:pass@localhost:5432/versaa_mock", name: "versaa_mock" });
    expect(mockUrlFor("postgres://localhost/versaa?sslmode=disable").url).toBe("postgres://localhost/versaa_mock?sslmode=disable");
  });
});
