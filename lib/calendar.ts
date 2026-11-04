import * as jalaali from "jalaali-js";
import { DateTime } from "luxon";

export type ImportantDate = {
  calendar: "jalali" | "gregorian";
  original_year?: number | null;
  month: number;
  day: number;
  recurrence: "none" | "yearly";
  leap_policy: "last_valid_day" | "skip";
  event_date?: string | null;
};
export function localToday(zone = "Asia/Tehran", now = DateTime.now()) {
  return now.setZone(zone).toISODate()!;
}
export function isValidOriginal(d: ImportantDate) {
  if (d.calendar === "jalali") {
    const y = d.original_year ?? 1399;
    try {
      return jalaali.isValidJalaaliDate(y, d.month, d.day);
    } catch {
      return false;
    }
  }
  return DateTime.fromObject(
    { year: d.original_year ?? 2000, month: d.month, day: d.day },
    { zone: "UTC" },
  ).isValid;
}
export function originalISO(d: ImportantDate) {
  if (!d.original_year) return null;
  if (!isValidOriginal(d)) return null;
  if (d.calendar === "gregorian")
    return DateTime.utc(d.original_year, d.month, d.day).toISODate();
  const g = jalaali.toGregorian(d.original_year, d.month, d.day);
  return DateTime.utc(g.gy, g.gm, g.gd).toISODate();
}
export function occurrences(
  d: ImportantDate,
  from: string,
  to: string,
): string[] {
  if (d.recurrence === "none")
    return d.event_date && d.event_date >= from && d.event_date <= to
      ? [d.event_date]
      : [];
  const start = DateTime.fromISO(from, { zone: "UTC" }),
    end = DateTime.fromISO(to, { zone: "UTC" });
  if (!start.isValid || !end.isValid) return [];
  const jy = (date: DateTime) =>
    jalaali.toJalaali(date.year, date.month, date.day).jy;
  const first = d.calendar === "jalali" ? jy(start) : start.year;
  const last = d.calendar === "jalali" ? jy(end) : end.year;
  const result: string[] = [];
  for (let year = first; year <= last; year++) {
    let max: number;
    try {
      max =
        d.calendar === "jalali"
          ? jalaali.jalaaliMonthLength(year, d.month)
          : DateTime.utc(year, d.month).daysInMonth!;
    } catch {
      continue;
    }
    if (d.day > max && d.leap_policy === "skip") continue;
    const day = Math.min(max, d.day);
    const g =
      d.calendar === "jalali"
        ? jalaali.toGregorian(year, d.month, day)
        : { gy: year, gm: d.month, gd: day };
    const iso = DateTime.utc(g.gy, g.gm, g.gd).toISODate()!;
    if (iso >= from && iso <= to) result.push(iso);
  }
  return result;
}
export function nextOccurrence(d: ImportantDate, from = localToday()) {
  return (
    occurrences(
      d,
      from,
      DateTime.fromISO(from).plus({ years: 9 }).toISODate()!,
    )[0] ?? null
  );
}
export function zonedInstant(day: string, time: string, zone: string) {
  const dt = DateTime.fromISO(`${day}T${time}`, { zone });
  if (!dt.isValid) throw new Error("Invalid local date or timezone");
  return dt
    .getPossibleOffsets()
    .sort((a, b) => a.toMillis() - b.toMillis())[0]
    .toUTC()
    .toISO()!;
}
export function flowerSchedule(delivery: string, time: string, zone: string) {
  const previous = DateTime.fromISO(delivery, { zone })
    .minus({ days: 1 })
    .toISODate()!;
  return {
    scheduled_at: zonedInstant(previous, time, zone),
    deadline_at: DateTime.fromISO(previous, { zone })
      .endOf("day")
      .toUTC()
      .toISO()!,
  };
}
export function faDate(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat("fa-IR", {
    timeZone: "Asia/Tehran",
    month: "long",
    day: "numeric",
    ...options,
  }).format(
    new Date(
      typeof value === "string" && value.length === 10
        ? value + "T12:00:00Z"
        : value,
    ),
  );
}
