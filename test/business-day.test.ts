import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, dayOf, daysBetween, localMoment, today } from "@/domain/dates";
import { daysFromToday } from "@/app/components/ui/format";
import { endOfDay } from "@/db/ledger";

/*
 * "Today" and the day of a moment follow the business's time zone
 * (Europe/Amsterdam by default), so the day changes at local midnight.
 */

afterEach(() => vi.useRealTimers());

describe("today", () => {
  it("is already the new day just after local midnight", () => {
    vi.useFakeTimers();
    // 00:30 in Spain/Amsterdam in winter is 23:30 the day before in London.
    vi.setSystemTime(new Date("2026-10-29T00:30:00+01:00"));
    expect(today()).toBe("2026-10-29");
    expect(daysFromToday("2026-10-29")).toBe(0);
    expect(daysFromToday("2026-10-30")).toBe(1);
  });

  it("also in summer time", () => {
    vi.useFakeTimers();
    // 00:45 on 1 June is 22:45 on 31 May in UTC: Reports must open on June.
    vi.setSystemTime(new Date("2027-06-01T00:45:00+02:00"));
    expect(today()).toBe("2027-06-01");
  });
});

describe("days and times", () => {
  it("gives the local day of a moment", () => {
    expect(dayOf(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
    expect(dayOf(new Date("2026-07-01T21:30:00Z"))).toBe("2026-07-01");
  });

  it("adds days across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("stores a typed local time as that local time", () => {
    expect(localMoment("2026-01-15", "10:30").toISOString()).toBe("2026-01-15T09:30:00.000Z");
    expect(localMoment("2026-07-15", "10:30").toISOString()).toBe("2026-07-15T08:30:00.000Z");
    // The night summer time starts (29 March 2026): 03:30 is already +02:00.
    expect(localMoment("2026-03-29", "03:30").toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("ends a day at local midnight", () => {
    expect(endOfDay("2026-10-23").toISOString()).toBe("2026-10-23T22:00:00.000Z");
    expect(endOfDay("2026-11-23").toISOString()).toBe("2026-11-23T23:00:00.000Z");
  });
});
