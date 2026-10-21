import { GarminError } from "@/errors";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalizes to the `YYYY-MM-DD` form Garmin expects.
 *
 * `Date` objects are formatted in UTC, not the local timezone. Garmin's API
 * consumes UTC calendar dates, so this is correct — but it is a foot-gun for
 * a caller in a negative UTC offset: passing `new Date()` late in their local
 * day can format as tomorrow's date, because it is already tomorrow in UTC.
 */
export function formatDate(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new GarminError("Expected a valid date");
    }
    return value.toISOString().slice(0, 10);
  }
  if (!ISO_DATE.test(value)) {
    throw new GarminError(`Expected a date in YYYY-MM-DD format, got "${value}"`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new GarminError(`Expected a valid date, got "${value}"`);
  }
  return value;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Formats a local wall-clock time for Garmin's timestamp fields, which omit the timezone offset.
 */
export function formatLocalTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.00`
  );
}

/** Formats a UTC instant for Garmin's GMT timestamp fields. */
export function formatGmtTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19) + ".00";
}

const HAS_TIME = /\d{2}:\d{2}/;
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Parse an ISO timestamp, reading a NAIVE string's wall clock as LOCAL time.
 *
 * JavaScript's `new Date(s)` disagrees with that in two places, both handled
 * here: a date-only string (`"2026-09-20"`) is parsed as UTC midnight by spec,
 * and a bare date is not a datetime at all. A string carrying its own offset
 * or `Z` is passed through untouched — it already names an instant.
 */
export function parseIsoLocal(s: string): Date {
  return new Date(HAS_TIME.test(s) ? s : `${s}T00:00:00`);
}

/**
 * Parse an ISO timestamp the way a supplied `gmtTimestamp` is treated:
 * a naive string is assumed to be UTC. It therefore gets `Z`
 * appended rather than being read as local time, which is what `new Date`
 * would otherwise do.
 */
export function parseIsoUtc(s: string): Date {
  if (HAS_ZONE.test(s)) return new Date(s);
  return new Date(`${HAS_TIME.test(s) ? s : `${s}T00:00:00`}Z`);
}
