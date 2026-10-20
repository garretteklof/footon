export function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, "").replace(/^00/, "+");
  const number = compact.startsWith("+")
    ? compact
    : /^\d{10}$/.test(compact)
      ? `+1${compact}`
      : /^1\d{10}$/.test(compact)
        ? `+${compact}`
        : "";

  if (!/^\+[1-9]\d{6,14}$/.test(number)) {
    throw new Error("Phone numbers must be E.164, or 10/11-digit US numbers");
  }
  return number;
}
