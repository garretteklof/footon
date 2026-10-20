export const localDateAt = (timestamp: number, timeZone: string) =>
  Temporal.Instant.fromEpochMilliseconds(timestamp)
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();

export function utcRangeForLocalDay(date: string, timeZone: string) {
  const day = Temporal.PlainDate.from(date);
  const midnight = (d: Temporal.PlainDate) =>
    d.toZonedDateTime(timeZone).startOfDay().toInstant().toString({ fractionalSecondDigits: 3 });

  return {
    start: midnight(day),
    end: midnight(day.add({ days: 1 })),
  };
}

export function validateDate(date: string) {
  try { return Temporal.PlainDate.from(date).toString(); }
  catch { throw new Error("date must be a valid YYYY-MM-DD"); }
}

export const addDays = (date: string, days: number) =>
  Temporal.PlainDate.from(date).add({ days }).toString();

export function isValidTimeZone(timeZone: string) {
  if (/^[+-]\d{2}(?::?\d{2})?$/.test(timeZone)) return false;
  try {
    Temporal.Now.zonedDateTimeISO(timeZone);
    return true;
  } catch {
    return false;
  }
}
