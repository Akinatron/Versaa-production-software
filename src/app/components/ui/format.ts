const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const parse = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) } : null;
};

/** "22 Oct" this year, "22 Oct 2025" otherwise. Display only; stored dates stay ISO. */
export function fmtDate(iso: string | null | undefined, opts: { weekday?: boolean; year?: boolean } = {}): string {
  if (!iso) return "—";
  const p = parse(String(iso));
  if (!p) return String(iso);
  const thisYear = new Date().getFullYear();
  const wd = opts.weekday ? `${DAYS[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()]} ` : "";
  const yr = opts.year || p.y !== thisYear ? ` ${p.y}` : "";
  return `${wd}${p.d} ${MONTHS[p.mo - 1]}${yr}`;
}

/** Days from today (local) to an ISO date: 0 today, 1 tomorrow, -1 yesterday. */
export function daysFromToday(iso: string): number {
  const p = parse(iso);
  if (!p) return 0;
  const now = new Date();
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d) - a) / 86400000);
}

/** "today", "tomorrow", "in 3 days", "2 days ago", else the date. */
export function relDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const n = daysFromToday(iso);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n > 1 && n <= 6) return `in ${n} days`;
  if (n < -1 && n >= -6) return `${-n} days ago`;
  return fmtDate(iso);
}

/** "1 batch", "2 batches". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
