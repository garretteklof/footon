export function localDateAt(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localMidnightAsUtc(date: string, timeZone: string): string {
  const target = Date.parse(date);
  let low = target - 36 * 60 * 60 * 1000;
  let high = target + 36 * 60 * 60 * 1000;

  // Find the first instant whose local calendar date is this date. The UTC
  // search window covers every IANA offset and naturally handles DST changes.
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (localDateAt(middle, timeZone) >= date) high = middle;
    else low = middle;
  }
  return new Date(high).toISOString();
}

export function utcRangeForLocalDay(date: string, timeZone: string): { start: string; end: string } {
  const nextDate = addDays(date, 1);
  return {
    start: localMidnightAsUtc(date, timeZone),
    end: localMidnightAsUtc(nextDate, timeZone),
  };
}

export function validateDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
    throw new Error("date must use YYYY-MM-DD format");
  return date;
}
export const addDays = (date: string, days: number) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);

export function isValidTimeZone(timeZone: string): boolean {
  if (/^[+-]\d{2}(?::?\d{2})?$/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
