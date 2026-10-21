import { describe, expect, test } from "bun:test";
import { Garmin, GarminError, MemoryTokenStore, type Tokens } from "../src/index";

const future = Math.floor(Date.now() / 1000) + 3600;
const tokens: Tokens = {
  access_token: "access",
  refresh_token: "refresh",
  client_id: "test-client",
  expires_at: future,
  refresh_token_expires_at: future + 3600,
};

function makeClient(fallbackResponse?: (request: Request) => Response) {
  const requests: Request[] = [];
  const store = new MemoryTokenStore();
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(String(input), init);
    requests.push(request);
    const url = new URL(request.url);
    if (url.pathname === "/userprofile-service/socialProfile") {
      return Response.json({ displayName: "runner", userName: "runner", fullName: "Runner", profileId: 1 });
    }
    if (url.pathname === "/userprofile-service/userprofile/user-settings") {
      return Response.json({ userData: { measurementSystem: "metric" } });
    }
    if (url.pathname === "/download-service/files/activity/7") {
      return new Response(Uint8Array.of(0, 127, 255));
    }
    if (url.pathname === "/upload-service/upload/fit" || url.pathname === "/upload-service/upload") {
      return Response.json({ fileName: "run.fit", status: "uploaded" });
    }
    if (url.pathname === "/weight-service/user-weight" && request.method === "POST") {
      return Response.json({ status: "saved" });
    }
    if (url.pathname === "/wellness-service/wellness/dailySleepData/runner") {
      return Response.json({ dailySleepDTO: { calendarDate: url.searchParams.get("date") } });
    }
    if (url.pathname === "/hrv-service/hrv/2026-10-21") {
      return Response.json({ hrvSummary: { calendarDate: "2026-10-21" } });
    }
    if (url.pathname === "/activitylist-service/activities/search/activities") {
      return Response.json([{ activityId: 7 }]);
    }
    if (url.pathname === "/activity-service/activity/7" && request.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/metrics-service/metrics/trainingreadiness/2026-10-21") {
      return Response.json([{ calendarDate: "2026-10-21", readinessLevel: "HIGH" }]);
    }
    return fallbackResponse?.(request) ?? new Response("not found", { status: 404 });
    }) as typeof fetch;
    return { requests, store, client: new Garmin({ tokenStore: store, fetchImpl, retries: 0 }) };
}

describe("domain API", () => {
  test("reuses profile and settings caches until tokens are loaded again", async () => {
    const { requests, store, client } = makeClient((request) =>
      new URL(request.url).pathname === "/personalrecord-service/personalrecord/prs/runner"
        ? Response.json({})
        : new Response("not found", { status: 404 }));
    await store.save(tokens);
    await client.loadTokens();

    await client.profile.get();
    await client.profile.get();
    await client.profile.hasConnectPlus();
    await client.profile.measurementSystem();
    await client.profile.measurementSystem();
    await client.activities.getPersonalRecord();

    const paths = () => requests.map(({ url }) => new URL(url).pathname);
    expect(paths().filter((path) => path === "/userprofile-service/socialProfile")).toHaveLength(1);
    expect(paths().filter((path) => path === "/userprofile-service/userprofile/user-settings")).toHaveLength(1);
    expect(paths()).toContain("/personalrecord-service/personalrecord/prs/runner");

    await client.loadTokens();
    await client.profile.get();
    await client.profile.measurementSystem();

    expect(paths().filter((path) => path === "/userprofile-service/socialProfile")).toHaveLength(2);
    expect(paths().filter((path) => path === "/userprofile-service/userprofile/user-settings")).toHaveLength(2);
  });

  test("exposes idiomatic wellness, activity, and training APIs on one client", async () => {
    const { requests, store, client } = makeClient();
    await store.save(tokens);
    expect(await client.loadTokens()).toBe(true);

    expect(await client.wellness.sleep("2026-10-21")).toMatchObject({
      dailySleepDTO: { calendarDate: "2026-10-21" },
    });
    expect(await client.wellness.hrv("2026-10-21")).toMatchObject({
      hrvSummary: { calendarDate: "2026-10-21" },
    });
    expect(await client.activities.list({ limit: 20 })).toEqual([{ activityId: 7 }]);
    expect(await client.training.readiness("2026-10-21")).toHaveLength(1);
    expect(await client.profile.measurementSystem()).toBe("metric");

    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/userprofile-service/socialProfile",
      "/wellness-service/wellness/dailySleepData/runner",
      "/hrv-service/hrv/2026-10-21",
      "/activitylist-service/activities/search/activities",
      "/metrics-service/metrics/trainingreadiness/2026-10-21",
      "/userprofile-service/userprofile/user-settings",
    ]);
    for (const request of requests) expect(request.headers.get("authorization")).toBe("Bearer access");
    expect(new URL(requests[3]!.url).searchParams.get("limit")).toBe("20");
  });

  test("routes representative calls through every domain API", async () => {
    const { requests, store, client } = makeClient((request) => {
      const path = new URL(request.url).pathname;
      if (path === "/web-gateway/course/owner/") return Response.json({ coursesForUser: [] });
      if ([
        "/workout-service/workouts",
        "/calendar-service/events",
        "/gear-service/gear/filterGear",
        "/device-service/deviceregistration/devices",
        "/badge-service/badge/earned",
        "/goal-service/goal/goals",
      ].includes(path)) return Response.json([]);
      return Response.json({});
    });
    await store.save(tokens);
    await client.loadTokens();
    const date = "2026-10-21";

    expect(await client.profile.get()).toMatchObject({ profileId: 1 });
    expect(await client.wellness.allDayStress(date)).toEqual({});
    expect(await client.activities.getHeartRateForDate(date)).toEqual({});
    expect(await client.workouts.list()).toEqual([]);
    expect(await client.courses.list()).toEqual({ coursesForUser: [] });
    expect(await client.calendar.list()).toEqual([]);
    expect(await client.gear.list(1)).toEqual([]);
    expect(await client.devices.list()).toEqual([]);
    expect(await client.challenges.listEarnedBadges()).toEqual([]);
    expect(await client.weight.list(date, date)).toEqual({});
    expect(await client.bodyComposition.getRange(date)).toEqual({});
    expect(await client.womensHealth.forDate(date)).toEqual({});
    expect(await client.goals.list()).toEqual([]);
    expect(await client.golf.userStats()).toEqual({});
    expect(await client.nutrition.dailyLog(date)).toEqual({});
    expect(await client.misc.lifestyle(date)).toEqual({});

    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/userprofile-service/socialProfile",
      `/wellness-service/wellness/dailyStress/${date}`,
      `/mobile-gateway/heartRate/forDate/${date}`,
      "/workout-service/workouts",
      "/web-gateway/course/owner/",
      "/calendar-service/events",
      "/gear-service/gear/filterGear",
      "/device-service/deviceregistration/devices",
      "/badge-service/badge/earned",
      `/weight-service/weight/range/${date}/${date}`,
      "/weight-service/weight/dateRange",
      `/periodichealth-service/menstrualcycle/dayview/${date}`,
      "/goal-service/goal/goals",
      "/gcs-golfcommunity/api/v2/player/stats",
      `/nutrition-service/food/logs/${date}`,
      `/lifestylelogging-service/dailyLog/${date}`,
    ]);
  });

  test("wellness stats and body uses the body-composition endpoint", async () => {
    const date = "2026-10-21";
    const { requests, store, client } = makeClient((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/usersummary-service/usersummary/daily/runner") {
        return Response.json({ summaryValue: 1 });
      }
      if (url.pathname === "/weight-service/weight/dateRange") {
        return Response.json({ totalAverage: { bodyValue: 2 } });
      }
      return new Response("not found", { status: 404 });
    });
    await store.save(tokens);
    await client.loadTokens();

    expect(await client.wellness.statsAndBody(date)).toEqual({ summaryValue: 1, bodyValue: 2 });
    expect(requests.map(({ url }) => new URL(url).pathname)).toContain(
      "/weight-service/weight/dateRange",
    );
    const bodyRequest = requests.find(
      ({ url }) => new URL(url).pathname === "/weight-service/weight/dateRange",
    );
    expect(new URL(bodyRequest!.url).searchParams.get("startDate")).toBe(date);
    expect(new URL(bodyRequest!.url).searchParams.get("endDate")).toBe(date);
  });

  test("returns activity downloads as Uint8Array bytes", async () => {
    const { store, client } = makeClient();
    await store.save(tokens);
    await client.loadTokens();

    const bytes = await client.activities.download(7);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([0, 127, 255]);
  });

  test("keeps activity import and device-sync upload requests distinct", async () => {
    const { requests, store, client } = makeClient();
    await store.save(tokens);
    await client.loadTokens();
    const file = new Blob(["fit-data"], { type: "application/octet-stream" });

    expect(await client.activities.import(file, "run.fit")).toMatchObject({ status: "uploaded" });
    expect(await client.activities.upload(file, "run.fit")).toMatchObject({ status: "uploaded" });

    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/upload-service/upload/fit",
      "/upload-service/upload",
    ]);
    expect(requests[0]?.headers.get("nk")).toBe("NT");
    expect(requests[0]?.headers.get("origin")).toBe("https://sso.garmin.com");
    expect(requests[0]?.headers.get("user-agent")).toBe("GCM-iOS-5.7.2.1");
    expect(requests[1]?.headers.get("nk")).toBeNull();
    for (const request of requests) {
      expect(request.headers.get("authorization")).toBe("Bearer access");
      expect((await request.formData()).get("file")).toBeInstanceOf(Blob);
    }
  });

  test("uses delete for activity removal", async () => {
    const { requests, store, client } = makeClient();
    await store.save(tokens);
    await client.loadTokens();

    expect(await client.activities.delete(7)).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("DELETE");
  });

  test("uses list and get verbs for domain collections and records", () => {
    const { client } = makeClient();

    expect(client.wellness).not.toHaveProperty("stress");
    expect(typeof client.activities.getHeartRateForDate).toBe("function");
    expect(client.activities).not.toHaveProperty("listForDate");
    expect(typeof client.activities.listByDate).toBe("function");
    expect(typeof client.activities.getLast).toBe("function");
    expect(typeof client.activities.listTypes).toBe("function");
    expect(typeof client.activities.listEventTypes).toBe("function");
    expect(typeof client.activities.getPersonalRecord).toBe("function");
    expect(typeof client.activities.listGearActivities).toBe("function");
    expect(typeof client.activities.getDetails).toBe("function");
    expect(typeof client.activities.getProgressSummary).toBe("function");
    expect(typeof client.activities.downloadHealthSnapshot).toBe("function");
    expect(client.activities).not.toHaveProperty("forDate");
    expect(client.activities).not.toHaveProperty("last");

    expect(typeof client.training.listPlans).toBe("function");
    expect(typeof client.training.getPlan).toBe("function");
    expect(typeof client.workouts.listScheduled).toBe("function");
    expect(typeof client.workouts.getScheduledWorkout).toBe("function");
    expect(typeof client.workouts.getNextScheduledWorkout).toBe("function");
    expect(typeof client.workouts.getAdaptiveWorkout).toBe("function");
    expect(typeof client.workouts.listScheduledWorkoutSummaries).toBe("function");
    expect(typeof client.challenges.listEarnedBadges).toBe("function");
    expect(typeof client.challenges.getBadge).toBe("function");
    expect(typeof client.devices.getSettings).toBe("function");
    expect(typeof client.profile.getSettings).toBe("function");
    expect(typeof client.gear.getStats).toBe("function");
    expect(typeof client.nutrition.listCustomFoods).toBe("function");
    expect(typeof client.nutrition.listFoodLogs).toBe("function");
    expect(typeof client.nutrition.deleteFoodLogs).toBe("function");
  });

  test("creates weight records with caller units and timestamps", async () => {
    const { requests, store, client } = makeClient();
    await store.save(tokens);
    await client.loadTokens();

    await client.weight.create(70, "lbs", new Date("2026-10-21T10:00:00.000Z"));
    await client.weight.createWithTimestamps(72, "kg", "2026-10-21T11:00:00");

    expect(requests).toHaveLength(2);
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]!.json()).toMatchObject({ value: 70, unitKey: "lbs", sourceType: "MANUAL" });
    const timestampPayload = await requests[1]!.json() as Record<string, unknown>;
    expect(timestampPayload).toMatchObject({ value: 72, unitKey: "kg", sourceType: "MANUAL" });
    expect(timestampPayload.dateTimestamp).toBe("2026-10-21T11:00:00.00");
    expect(typeof timestampPayload.gmtTimestamp).toBe("string");
  });

  test("creates body composition through the FIT upload endpoint", async () => {
    const { requests, store, client } = makeClient();
    await store.save(tokens);
    await client.loadTokens();

    expect(await client.bodyComposition.create(70, { timestamp: "2026-10-21T10:00:00.000Z" }))
      .toMatchObject({ status: "uploaded" });
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!.url).pathname).toBe("/upload-service/upload");
    const file = (await requests[0]!.formData()).get("file");
    expect(file).toBeInstanceOf(Blob);
    if (!(file instanceof File)) throw new Error("expected an uploaded file");
    expect(file.name).toBe("body_composition.fit");
    expect(file.size).toBeGreaterThan(0);
  });

  test("rejects dot path segments before they reach URL normalization", async () => {
    const { requests, store, client } = makeClient();
    await store.save(tokens);
    await client.loadTokens();

    let error: unknown;
    try {
      await client.activities.get("..");
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(GarminError);
    expect(requests).toHaveLength(0);
  });

  test("keeps transport details and legacy flat method names out of Garmin", () => {
    const { client } = makeClient();
    expect(client).not.toHaveProperty("client");
    expect(client).not.toHaveProperty("getSleepData");
    expect(client).not.toHaveProperty("getActivities");
  });

  test("keeps the typed request escape hatch relative and authenticated", async () => {
    const { store, client } = makeClient();
    await store.save(tokens);
    await client.loadTokens();
    let rejected = false;
    try { await client.request("https://attacker.invalid/path"); }
    catch { rejected = true; }
    expect(rejected).toBe(true);
  });
});
