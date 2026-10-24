import { afterEach, expect, test } from "bun:test";
import { closeFixtures, fixture } from "./training-fixture";
import {
  athleteProfileSchema,
  completedActivityInputSchema,
  getAthleteProfile,
  getCompletedActivities,
  recordCompletedActivity,
  setAthleteProfile,
} from "../src/index";

afterEach(closeFixtures);

test("athletic profiles store validated goals and records separately for each user", () => {
  const x = fixture();
  const profile = setAthleteProfile(x.db, x.alice, {
    runningBackground: "Club runner since 2018",
    trainingPreferences: ["Long run on Sunday"],
    goals: [{ description: "Run 40 km per week", targetDate: "2027-01-01" }],
    personalRecords: [{ event: "marathon", durationSeconds: 12300, achievedOn: "2026-09-20" }],
    targetRaces: [{ name: "Spring marathon", event: "marathon", date: "2027-04-18", goalTimeSeconds: 12000 }],
  });
  expect(profile).toMatchObject({ runningBackground: "Club runner since 2018", goals: [{ description: "Run 40 km per week" }] });
  expect(profile.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(getAthleteProfile(x.db, x.alice)).toEqual(profile);
  expect(getAthleteProfile(x.db, x.bob)).toBeUndefined();
  expect(athleteProfileSchema.safeParse({ targetRaces: [{ name: "Invalid", event: "marathon", date: "2026-02-30" }] }).success).toBe(false);
  expect(athleteProfileSchema.safeParse({ personalRecords: [{ event: "10K", durationSeconds: 0 }] }).success).toBe(false);
});

test("completed activities normalize local dates, deduplicate imports, and isolate users", () => {
  const x = fixture();
  const beforeDst = recordCompletedActivity(x.db, x.alice, "America/Los_Angeles", {
    activityType: "run", startedAt: "2026-03-08T07:30:00Z", durationSeconds: 3600, distanceMeters: 10000,
    source: "garmin", sourceKey: "activity-1",
  });
  const afterDst = recordCompletedActivity(x.db, x.alice, "America/Los_Angeles", {
    activityType: "run", startedAt: "2026-03-08T08:30:00Z", durationSeconds: 1800, distanceMeters: 5000,
    source: "garmin", sourceKey: "activity-2",
  });
  const duplicate = recordCompletedActivity(x.db, x.alice, "America/Los_Angeles", {
    activityType: "run", startedAt: "2026-03-08T07:30:00Z", durationSeconds: 3600, distanceMeters: 10000,
    source: "garmin", sourceKey: "activity-1",
  });
  expect(beforeDst).toMatchObject({ startedAt: "2026-03-08T07:30:00.000Z", localDate: "2026-03-07" });
  expect(afterDst.localDate).toBe("2026-03-08");
  expect(duplicate.id).toBe(beforeDst.id);
  expect(getCompletedActivities(x.db, x.alice, { startDate: "2026-03-07", endDate: "2026-03-08" })).toHaveLength(2);
  expect(getCompletedActivities(x.db, x.bob, { startDate: "2026-03-07", endDate: "2026-03-08" })).toEqual([]);
  expect(completedActivityInputSchema.safeParse({ activityType: "unknown", startedAt: "2026-03-08T08:30:00Z", durationSeconds: 3 }).success).toBe(false);
  expect(() => recordCompletedActivity(x.db, x.alice, "Not/A_Timezone", {
    activityType: "run", startedAt: "2026-03-08T08:30:00Z", durationSeconds: 60,
  })).toThrow();
  expect(() => recordCompletedActivity(x.db, x.alice, "UTC", {
    activityType: "run", startedAt: "2026-03-08T08:30:00", durationSeconds: 60,
  })).toThrow();
  expect(x.sqlite.query("SELECT count(*) AS count FROM completed_activities").get()).toEqual({ count: 2 });
});

test("profile defaults and activity records remain distinct from planned workouts", () => {
  const x = fixture();
  const profile = setAthleteProfile(x.db, x.alice, {});
  expect(profile).toMatchObject({ trainingPreferences: [], goals: [], personalRecords: [], targetRaces: [] });
  recordCompletedActivity(x.db, x.alice, "America/Chicago", {
    activityType: "strength", startedAt: "2026-10-20T15:00:00Z", durationSeconds: 2700, note: "Gym session",
  });
  expect(x.sqlite.query("SELECT count(*) AS count FROM training_accounts").get()).toEqual({ count: 0 });
  expect(getCompletedActivities(x.db, x.alice, { startDate: "2026-10-20", endDate: "2026-10-20" })[0]?.distanceMeters).toBeNull();
});
