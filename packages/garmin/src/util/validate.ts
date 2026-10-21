import { GarminError } from "@/errors";

const SPORT_KEY_RE = /^[A-Z_]+$/;

/** Normalizes a Garmin sport key to uppercase letters and underscores. */
export function validateSportKey(sport: string): string {
  const normalized = sport.toUpperCase();
  if (!SPORT_KEY_RE.test(normalized)) {
    throw new GarminError(`Invalid sport key: "${sport}"`);
  }
  return normalized;
}

export function validateNonNegativeInteger(value: number, paramName: string): number {
  if (!Number.isInteger(value)) {
    throw new GarminError(`${paramName} must be an integer`);
  }
  if (value < 0) {
    throw new GarminError(`${paramName} must be non-negative, got: ${value}`);
  }
  return value;
}

export function validatePositiveInteger(value: number, paramName: string): number {
  if (!Number.isInteger(value)) {
    throw new GarminError(`${paramName} must be an integer`);
  }
  if (value <= 0) {
    throw new GarminError(`${paramName} must be a positive integer, got: ${value}`);
  }
  return value;
}

/** Encodes a single URL path segment and rejects dot segments before URL normalization. */
export function pathSegment(value: string | number): string {
  const segment = String(value);
  if (segment === "." || segment === "..") {
    throw new GarminError("Path segments cannot be . or ..");
  }
  return encodeURIComponent(segment);
}

const UUID_HEX_RE = /^[0-9a-fA-F]+$/;

/** Validates a gear UUID in hyphenated or compact hexadecimal form. */
export function validateUuid(uuid: string): string {
  const stripped = uuid.replace(/-/g, "");
  if (stripped.length === 0 || !UUID_HEX_RE.test(stripped)) {
    throw new GarminError(`Invalid gear UUID: "${uuid}"`);
  }
  return uuid;
}
