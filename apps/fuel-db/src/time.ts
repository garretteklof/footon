function localDateAt(timestamp: number, timeZone: string): string {
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
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
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
  const [year, month, day] = date.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return {
    start: localMidnightAsUtc(date, timeZone),
    end: localMidnightAsUtc(nextDate, timeZone),
  };
}

export function isValidTimeZone(timeZone: string): boolean {
  if (/^[+-]\d{2}(?::?\d{2})?$/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
