/** Named Connect API routes. Resource methods add validated path segments and query parameters. */
export const SOCIAL_PROFILE_ENDPOINT = "/userprofile-service/socialProfile";
export const USER_SETTINGS_ENDPOINT = "/userprofile-service/userprofile/user-settings";
export const USER_SUMMARY_ENDPOINT = "/usersummary-service/usersummary/daily";
export const STEPS_ENDPOINT = "/wellness-service/wellness/dailySummaryChart";
export const HEART_RATES_ENDPOINT = "/wellness-service/wellness/dailyHeartRate";
export const SLEEP_ENDPOINT = "/wellness-service/wellness/dailySleepData";
export const HRV_ENDPOINT = "/hrv-service/hrv";
export const BODY_BATTERY_ENDPOINT = "/wellness-service/wellness/bodyBattery/reports/daily";
export const TRAINING_READINESS_ENDPOINT = "/metrics-service/metrics/trainingreadiness";
export const ACTIVITIES_COUNT_ENDPOINT = "/activitylist-service/activities/count";
export const ACTIVITIES_SEARCH_ENDPOINT = "/activitylist-service/activities/search/activities";
export const ACTIVITY_ENDPOINT = "/activity-service/activity";

export const ENDPOINTS = {
  profile: { social: SOCIAL_PROFILE_ENDPOINT, settings: USER_SETTINGS_ENDPOINT },
  wellness: {
    userSummary: USER_SUMMARY_ENDPOINT,
    steps: STEPS_ENDPOINT,
    heartRates: HEART_RATES_ENDPOINT,
    sleep: SLEEP_ENDPOINT,
    hrv: HRV_ENDPOINT,
    bodyBattery: BODY_BATTERY_ENDPOINT,
  },
  training: { readiness: TRAINING_READINESS_ENDPOINT },
  activities: { count: ACTIVITIES_COUNT_ENDPOINT, search: ACTIVITIES_SEARCH_ENDPOINT, activity: ACTIVITY_ENDPOINT },
} as const;
