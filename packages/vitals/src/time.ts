import type { DateRange } from "./schema";

export function validateDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Date must use valid YYYY-MM-DD format");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Date must use valid YYYY-MM-DD format");
  }
  return value;
}

export function validateDateRange(range: DateRange): DateRange {
  const startDate = validateDate(range.startDate);
  const endDate = validateDate(range.endDate);
  if (startDate > endDate) throw new Error("startDate must not be after endDate");
  return { startDate, endDate };
}

export function localDateAt(timestamp: string, timezone: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("observedAt must be a valid timestamp");
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
  } catch {
    throw new Error("timezone must be a valid IANA timezone");
  }
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  const day = parts.find(part => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Could not derive local date");
  return `${year}-${month}-${day}`;
}

export function normalizeTimestamp(timestamp?: string): string {
  const date = timestamp === undefined ? new Date() : new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("observedAt must be a valid RFC3339 timestamp");
  return date.toISOString();
}
