/**
 * Base class of every error this library throws, so `instanceof GarminError` catches them all.
 * `name` is the concrete subclass's name.
 */
export class GarminError extends Error {
  /** `options.cause` is the underlying error, if any. */
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** Authentication failed or the account is not authorized for this request. */
export class GarminAuthError extends GarminError {}

/** A network or resource-level operation failed. Inspect `cause` when present. */
export class GarminConnectionError extends GarminError {}

/**
 * Garmin returns a bare 403 when an endpoint requires Connect+.
 * The nutrition resource checks `hasConnectPlus()` when possible.
 * This error separates missing subscriptions from expired sessions.
 */
export class GarminConnectPlusRequiredError extends GarminError {
  /** Thrown by the methods that need Connect+; `cause` is the 403, when there was one. */
  constructor(
    /** The `Garmin` method that was called. */
    readonly method: string,
    options?: { cause?: unknown },
  ) {
    super(
      `${method} needs a Garmin Connect+ subscription, and this account does not have one. ` +
        "Connect+ is bought in the Garmin Connect app and needs a paired Garmin device.",
      options,
    );
  }
}

/** 429. `retryAfter` is seconds, taken from the Retry-After header when present. */
export class GarminRateLimitError extends GarminError {
  constructor(
    message: string,
    /** Seconds to wait before retrying, from the `Retry-After` header; absent without one. */
    readonly retryAfter?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Any other non-2xx response. */
export class GarminHttpError extends GarminError {
  constructor(
    message: string,
    /** The HTTP status code. */
    readonly status: number,
    /** The URL that was requested. */
    readonly url: string,
    /** The response body, as text. */
    readonly body: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
