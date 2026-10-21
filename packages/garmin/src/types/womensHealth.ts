/** Types for responses from `src/api/womensHealth.ts`. The models allow undocumented fields. */

/** `GET /periodichealth-service/menstrualcycle/dayview/{fordate}`. */
export interface MenstrualDayView {
  [key: string]: unknown;
}

/** `GET /periodichealth-service/menstrualcycle/calendar/{startdate}/{enddate}`. */
export interface MenstrualCalendarData {
  [key: string]: unknown;
}

/** `GET /periodichealth-service/menstrualcycle/lastconfirmed/{fordate}`. */
export interface MenstrualLastConfirmed {
  [key: string]: unknown;
}

/** `GET /periodichealth-service/menstrualcycle/summary/{fordate}`. */
export interface MenstrualCycleSummary {
  [key: string]: unknown;
}

/** `GET /periodichealth-service/reports/menstrualcycle/{numberOfCycles}/{fordate}`. */
export interface MenstrualReports {
  [key: string]: unknown;
}

/** `GET /periodichealth-service/menstrualcycle/pregnancysnapshot`. */
export interface PregnancySummary {
  [key: string]: unknown;
}
