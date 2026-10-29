/**
 * Calendar days in the business's own time zone. Everything that needs
 * "today", or the day something happened, goes through here, so the day
 * changes at local midnight (not at midnight in London) and every screen
 * agrees on it.
 */

/** The business's time zone. `APP_TIME_ZONE` can change it; Europe/Amsterdam otherwise. */
export const BUSINESS_TIME_ZONE = (typeof process !== "undefined" && process.env?.APP_TIME_ZONE) || "Europe/Amsterdam";

const DAY_ISO = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The calendar day (ISO, YYYY-MM-DD) of a moment, in the business's time zone. */
export const dayOf = (at: Date) => DAY_ISO.format(at);

/** Today's date (ISO), in the business's time zone. */
export const today = () => dayOf(new Date());

/** The ISO day `n` days after `iso` (before, when `n` is negative). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (ISO days): 1 when `b` is the day after `a`. */
export function daysBetween(a: string, b: string): number {
  const ms = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((ms(b) - ms(a)) / 86400000);
}

/** How far the business's clock is ahead of UTC at a moment, in milliseconds. */
function offsetAt(at: Date): number {
  const p = Object.fromEntries(PARTS.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The moment a local day and time ("HH:MM", business time zone) happened.
 * Used for times typed into forms, so "10:30" is stored as 10:30 local
 * time, not as 10:30 in London.
 */
export function localMoment(day: string, time = "12:00"): Date {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh ?? 12, mm ?? 0);
  // Twice, so a time near a summer/winter change uses that day's offset.
  const first = guess - offsetAt(new Date(guess));
  return new Date(guess - offsetAt(new Date(first)));
}
