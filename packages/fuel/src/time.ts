export function utcRangeForLocalDay(date: string, timeZone: string) {
  const day = Temporal.PlainDate.from(date);
  const midnight = (value: Temporal.PlainDate) => value.toZonedDateTime(timeZone)
    .startOfDay().toInstant().toString({ fractionalSecondDigits: 3 });
  return { start: midnight(day), end: midnight(day.add({ days: 1 })) };
}

export function validateDate(date: string) {
  try { return Temporal.PlainDate.from(date).toString(); }
  catch { throw new Error("date must be a valid YYYY-MM-DD"); }
}
