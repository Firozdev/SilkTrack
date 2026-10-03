export const BD_TZ = "Asia/Dhaka";
export const CN_TZ = "Asia/Shanghai";

/** "YYYY-MM-DD" of `date` as seen in time zone `tz`. */
export function ymdInTz(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/**
 * Date-only values (rate effective date, cut-off, ETA, validity…) are stored
 * as UTC midnight of the calendar day.
 */
export function dayFromYmd(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`Invalid date ${ymd}`);
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function toYmd(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/** Today's calendar day in `tz`, as a date-only value. */
export function today(tz: string = BD_TZ, now: Date = new Date()): Date {
  return dayFromYmd(ymdInTz(now, tz));
}

export function addDays(day: Date, n: number): Date {
  const d = new Date(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/** Format a date-only value. */
export function fmtDay(day: Date | null | undefined): string {
  if (!day) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(day);
}

/** Format a timestamp in the viewer's time zone. */
export function fmtDateTime(date: Date | null | undefined, tz: string): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** ISO-8601 week (Monday start) of a date-only value. */
export function isoWeek(day: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow); // Thursday of this week
  const year = d.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return { year, week };
}

/** Monday of ISO week `week` in `year`. */
export function isoWeekStart(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const week1Monday = addDays(jan4, 1 - dow);
  return addDays(week1Monday, (week - 1) * 7);
}

/** Days from `a` to `b` (date-only values). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
