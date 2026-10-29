import { describe, expect, it } from "vitest";
import { routineNotice } from "@/db/client";

/* Routine database notices stay out of the log, so the ones worth reading stand out. */

describe("database notices", () => {
  it("hides the routine ones and keeps the rest", () => {
    expect(routineNotice('relation "lots" already exists, skipping')).toBe(true);
    expect(routineNotice("drop cascades to 56 other objects")).toBe(true);
    expect(routineNotice('truncate cascades to table "movements"')).toBe(true);
    expect(
      routineNotice(
        'identifier "packaging_session_lines_packaging_version_id_packaging_versions_id_fk" will be truncated to "packaging_session_lines_packaging_version_id_packaging_versions"',
      ),
    ).toBe(true);
    expect(routineNotice('identifier "some_new_constraint_name_that_is_far_too_long_for_postgres_to_keep_whole" will be truncated to "x"')).toBe(false);
    expect(routineNotice("something unexpected")).toBe(false);
  });
});
