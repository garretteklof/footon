import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";

describe("built package exports", () => {
  test("imports the package root and exercise subpath in Bun and Node", async () => {
    const script = [
      "import { Garmin, MemoryTokenStore, buildWorkout, WORKOUT_SPORT_TYPE_ID, WORKOUT_EXERCISE_CATEGORIES } from 'garmints';",
      "import { EXERCISES, exercise, isExerciseName } from 'garmints/exercises';",
      "const client = new Garmin({ tokenStore: new MemoryTokenStore() });",
      "if (typeof client.wellness.sleep !== 'function') throw new Error('missing wellness resource');",
      "if (WORKOUT_SPORT_TYPE_ID.RUNNING !== 1 || !WORKOUT_EXERCISE_CATEGORIES.includes('SQUAT')) throw new Error('missing workout constants');",
      "if (exercise('SQUAT', 'BARBELL_BACK_SQUAT').name !== 'BARBELL_BACK_SQUAT') throw new Error('exercise export failed');",
      "if (!isExerciseName('BENCH_PRESS', 'BARBELL_BENCH_PRESS') || isExerciseName('toString', 'toString')) throw new Error('exercise runtime validation failed');",
      "if (buildWorkout('smoke', { sport: 'running' }).interval({ distance: 100 }).build().workoutSegments.length === 0) throw new Error('workout builder export failed');",
      "if (!EXERCISES || Object.keys(EXERCISES).length === 0) throw new Error('missing exercise catalogue');",
    ].join("\n");

    for (const runtime of [Bun.which("bun"), Bun.which("node")]) {
      if (!runtime) throw new Error("Both Bun and Node are required for package export verification");
      const result = spawnSync(runtime, ["--input-type=module", "-e", script], { cwd: process.cwd() });
      if (result.status !== 0) {
        throw new Error(`${runtime} package import failed: ${result.stderr.toString()}`);
      }
      expect(result.status).toBe(0);
    }

    const rootBundle = await readFile(resolve(process.cwd(), "dist/index.js"), "utf8");
    expect(rootBundle).not.toContain("BARBELL_BACK_SQUAT");
  });

  test("resolves public declarations for a strict NodeNext consumer", async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "garmints-types-"));
    try {
      await mkdir(join(root, "node_modules"), { recursive: true });
      await symlink(resolve(process.cwd()), join(root, "node_modules", "garmints"), "dir");
      await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
      await writeFile(join(root, "consumer.mts"), [
        'import { buildWorkout, Garmin, MemoryTokenStore, type ConnectPlusMethod, type HeartRateForDateResponse, type SocialProfile, type UserSettings, WORKOUT_SPORT_TYPE_ID } from "garmints";',
        'import { EXERCISES, exercise } from "garmints/exercises";',
        'const method: ConnectPlusMethod = "logFood";',
        'const profile: SocialProfile = { displayName: "A", userName: "a", fullName: "A", profileId: 1 };',
        'const settings: UserSettings = { userData: { measurementSystem: "metric" } };',
        'const sportId: number = WORKOUT_SPORT_TYPE_ID.RUNNING;',
        'const heartRateResponse: HeartRateForDateResponse = {};',
        'const bench: "BARBELL_BENCH_PRESS" = exercise("BENCH_PRESS", "BARBELL_BENCH_PRESS").name;',
        'const names: readonly string[] = EXERCISES.BENCH_PRESS;',
        'const workout = buildWorkout("consumer", { sport: "running" }).interval({ reps: 8 }).build();',
        'const garmin = new Garmin({ tokenStore: new MemoryTokenStore() });',
        'const activities = garmin.activities.list({ limit: 20 });',
        'const plans = garmin.training.listPlans();',
        'const scheduled = garmin.workouts.listScheduled(2026, 10);',
        'const nextWorkout = garmin.workouts.getNextScheduledWorkout();',
        'const foods = garmin.nutrition.listCustomFoods();',
        'const foodLogs = garmin.nutrition.listFoodLogs("2026-10-01", "2026-10-21");',
        'const weights = garmin.weight.create(70, "kg");',
        'const stress = garmin.wellness.allDayStress("2026-10-21");',
        'const heartRateForDate = garmin.activities.getHeartRateForDate("2026-10-21");',
        '// @ts-expect-error the duplicate stress alias is not part of the public API',
        'garmin.wellness.stress("2026-10-21");',
        '// @ts-expect-error this response is heart-rate data, not an activity list',
        'garmin.activities.listForDate("2026-10-21");',
        '// @ts-expect-error scheduled workouts use the descriptive getter name',
        'garmin.workouts.getScheduled(1);',
        '// @ts-expect-error invalid Connect+ methods are rejected',
        'const invalidMethod: ConnectPlusMethod = "not-a-method";',
        '// @ts-expect-error exercise names must belong to the selected category',
        'exercise("BENCH_PRESS", "BARBELL_BACK_SQUAT");',
        '// @ts-expect-error exercise categories must be recognized Garmin keys',
        'exercise("NOT_A_CATEGORY", "BARBELL_BACK_SQUAT");',
        '// @ts-expect-error the catalogue exposes only populated known categories',
        'EXERCISES.NOT_A_CATEGORY;',
        'void [method, profile, settings, sportId, heartRateResponse, bench, names, workout, garmin, activities, plans, scheduled, nextWorkout, foods, foodLogs, weights, stress, heartRateForDate, invalidMethod];',
      ].join("\n"));

      const node = Bun.which("node");
      if (!node) throw new Error("Node is required for declaration verification");
      const compiler = resolve("node_modules/typescript/bin/tsc");
      const result = spawnSync(node, [
        compiler, "--noEmit", "--strict", "--skipLibCheck", "false", "--target", "ES2022",
        "--module", "NodeNext", "--moduleResolution", "NodeNext", "--types", "node",
        "--typeRoots", resolve("node_modules/@types"), "consumer.mts",
      ], { cwd: root, encoding: "utf8" });
      if (result.status !== 0) throw new Error(`NodeNext declaration check failed: ${result.stdout}${result.stderr}`);
      expect(result.status).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
