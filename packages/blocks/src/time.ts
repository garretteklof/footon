export const localDateAt = (timestamp: number, timeZone: string) =>
  Temporal.Instant.fromEpochMilliseconds(timestamp).toZonedDateTimeISO(timeZone).toPlainDate().toString();

export const addDays = (date: string, days: number) => Temporal.PlainDate.from(date).add({ days }).toString();

export function validateDate(date: string) {
  try { return Temporal.PlainDate.from(date).toString(); }
  catch { throw new Error("date must be a valid YYYY-MM-DD"); }
}
