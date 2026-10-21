/** An activity summary, as listed by `getActivities` and returned by `getActivity`. */
export interface Activity {
  activityId: number;
  activityName?: string;
  startTimeLocal?: string;
  distance?: number;
  duration?: number;
  activityType?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A file format `downloadActivity` can produce. `ORIGINAL` is the file the device uploaded. */
export type ActivityDownloadFormat = "ORIGINAL" | "TCX" | "GPX" | "KML" | "CSV";

/**
 * Response shape of `GET /mobile-gateway/heartRate/forDate/{fordate}` is undocumented beyond
 * "an object" — index signature only, no fields invented.
 */
export interface HeartRateForDateResponse {
  [key: string]: unknown;
}

/** One activity type returned by `GET /activity-service/activity/activityTypes`. */
export interface ActivityType {
  typeId: number;
  typeKey: string;
  parentTypeId: number;
  isHidden?: boolean;
  restricted?: boolean;
  trimmable?: boolean;
  [key: string]: unknown;
}

/** The activity-type endpoint returns an array of `ActivityType` entries. */
export type ActivityTypesResponse = ActivityType[];

/** Result of `POST /upload-service/upload/{ext}`. */
export interface ImportActivityResult {
  [key: string]: unknown;
}

/**
 * Result of `POST /upload-service/upload` — the plain, non-import upload (distinct endpoint and
 * headers from `importActivity`, see that function's doc comment). The raw response is passed
 * through; it may be null. Undocumented shape.
 */
export interface UploadActivityResult {
  [key: string]: unknown;
}

/** One personal-record row; the endpoint's row fields remain opaque. */
export type PersonalRecord = Record<string, unknown>;

/** `getPersonalRecord` returns a list of opaque personal-record rows. */
export type PersonalRecords = PersonalRecord[];

/**
 * Response shapes for the per-activity detail sub-resources below are undocumented — index
 * signatures only, no fields invented. Where a field is known by name (e.g. `exerciseSets`), it
 * is included.
 */
export interface ActivitySplits {
  [key: string]: unknown;
}

/** `getActivityTypedSplits`' response. */
export interface ActivityTypedSplits {
  [key: string]: unknown;
}

/** `getActivitySplitSummaries`' response. */
export interface ActivitySplitSummaries {
  [key: string]: unknown;
}

/** `getActivityWeather`'s response. */
export interface ActivityWeather {
  [key: string]: unknown;
}

/** `getActivityHrInTimezones`' response: time in each heart-rate zone. */
export interface ActivityHrInTimezones {
  [key: string]: unknown;
}

/** `getActivityPowerInTimezones`' response: time in each power zone. */
export interface ActivityPowerInTimezones {
  [key: string]: unknown;
}

/** `getActivityDetails`' response: the activity's time series and track. */
export interface ActivityDetails {
  [key: string]: unknown;
}

/** `getActivityExerciseSets`'s response and `setActivityExerciseSets`'s payload share this shape. */
export interface ActivityExerciseSets {
  exerciseSets?: unknown[];
  [key: string]: unknown;
}

/** One activity-gear entry; the endpoint returns an array. */
export interface ActivityGear {
  [key: string]: unknown;
}

/** One entry of `GET /activitylist-service/activities/{gearUUID}/gear`. */
export interface GearActivity {
  [key: string]: unknown;
}

/** `.json()` result of `PUT /gear-service/gear/link|unlink/{gearUUID}/activity/{activityId}`. */
export interface GearLinkResult {
  [key: string]: unknown;
}

/** `GET /fitnessstats-service/activity`. */
export interface ProgressSummary {
  [key: string]: unknown;
}

/** An event type returned by `GET /activity-service/activity/eventTypes`. */
export interface ActivityEventType {
  typeId: number;
  typeKey: ActivityEventTypeKey;
  sortOrder: number;
}

/** Event-type keys returned by `GET /activity-service/activity/eventTypes`. */
export type ActivityEventTypeKey =
  | "race"
  | "recreation"
  | "specialEvent"
  | "training"
  | "transportation"
  | "touring"
  | "geocaching"
  | "fitness"
  | "uncategorized";

/**
 * Garmin Connect's "How did you feel?" rating, stored as `summaryDTO.directWorkoutFeel`:
 * 0 very weak, 25 weak, 50 normal, 75 strong, 100 very strong.
 */
export type ActivityFeel = 0 | 25 | 50 | 75 | 100;
