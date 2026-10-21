import { describe, expect, test } from "bun:test";
import { buildWorkout, GarminError, type RepeatWorkoutGroup } from "../src/index";
import { exercise, isExerciseName } from "../src/workouts/exercises";

describe("workout construction", () => {
  test("builds globally ordered repeat steps with checked exercise data", () => {
    const workout = buildWorkout("Strength", { sport: "strength_training" })
      .warmup({ time: 30 })
      .repeat(2, (set) => set.interval({
        reps: 8,
        exercise: exercise("SQUAT", "BARBELL_BACK_SQUAT"),
        weightKg: 60,
      }).rest(45))
      .build();
    const steps = workout.workoutSegments[0]!.workoutSteps;
    const repeat = steps[1] as RepeatWorkoutGroup;

    expect(workout.workoutName).toBe("Strength");
    expect(steps.map((step) => step.stepOrder)).toEqual([1, 2]);
    expect(repeat.type).toBe("RepeatGroupDTO");
    expect(repeat.workoutSteps.map((step) => step.stepOrder)).toEqual([3, 4]);
    expect(repeat.workoutSteps[0]).toMatchObject({
      category: "SQUAT",
      exerciseName: "BARBELL_BACK_SQUAT",
      weightValue: 60,
      weightUnit: { unitKey: "kilogram" },
    });
    expect(isExerciseName("SQUAT", "BARBELL_BACK_SQUAT")).toBe(true);
    expect(isExerciseName("SQUAT", "NOT_AN_EXERCISE")).toBe(false);
    expect(isExerciseName("toString", "toString")).toBe(false);
    expect(isExerciseName("BENCH_PRESS", "constructor")).toBe(false);
  });

  test("rejects a workout step without an end condition", () => {
    expect(() => buildWorkout("Invalid", { sport: "running" })
      .interval({})
      .build()).toThrow(GarminError);
  });

  test("encodes timed nested repeats and keeps step order global", () => {
    const workout = buildWorkout("AMRAP", { sport: "hiit" })
      .repeatForSeconds(600, (set) =>
        set.interval({ reps: 10, exercise: { category: "PUSH_UP" } })
          .repeat(2, (inner) => inner.interval({ time: 30 }).rest(15)),
      )
      .build();
    const outer = workout.workoutSegments[0]!.workoutSteps[0] as RepeatWorkoutGroup;
    const inner = outer.workoutSteps[1] as RepeatWorkoutGroup;

    expect(outer).toMatchObject({
      stepOrder: 1,
      numberOfIterations: null,
      endCondition: { conditionTypeKey: "time" },
      endConditionValue: 600,
    });
    expect(outer.workoutSteps.map((step) => step.stepOrder)).toEqual([2, 3]);
    expect(inner).toMatchObject({
      stepOrder: 3,
      numberOfIterations: 2,
      endCondition: { conditionTypeKey: "iterations" },
    });
    expect(inner.workoutSteps.map((step) => step.stepOrder)).toEqual([4, 5]);
  });

  test("builds multi-sport legs as ordered sport-specific segments", () => {
    const workout = buildWorkout("Brick", {
      sport: "multi_sport",
      sessionTransitionsEnabled: true,
    })
      .leg("swimming", (leg) => leg.warmup({ distance: 400 }))
      .leg("cycling", (leg) => leg.interval({ time: 480 }))
      .leg("running", (leg) => leg.interval({ distance: 5000 }))
      .build();

    expect(workout.sportType).toMatchObject({ sportTypeKey: "multi_sport" });
    expect(workout.isSessionTransitionEnabled).toBe(true);
    expect(workout.workoutSegments.map((segment) => [segment.segmentOrder, segment.sportType["sportTypeKey"]])).toEqual([
      [1, "swimming"],
      [2, "cycling"],
      [3, "running"],
    ]);
    expect(workout.workoutSegments.map((segment) => segment.workoutSteps[0]!.stepOrder)).toEqual([1, 2, 3]);
  });

  test("encodes pool units, swim details, and CSS targets", () => {
    const workout = buildWorkout("Swim", { sport: "swimming", poolLength: 25 })
      .interval({
        distance: 100,
        stroke: "fly",
        drill: "kick",
        equipment: "paddles",
        target: { swimCssOffsetSeconds: 5 },
      })
      .interval({ fixedRepetition: 4, stroke: "individual_medley", equipment: "fins" })
      .build();
    const [swim, lengths] = workout.workoutSegments[0]!.workoutSteps;

    expect(workout).toMatchObject({ poolLength: 25, poolLengthUnit: { unitKey: "meter" } });
    expect(swim).toMatchObject({
      endCondition: { conditionTypeKey: "distance" },
      endConditionValue: 100,
      strokeType: { strokeTypeKey: "fly" },
      drillType: { drillTypeKey: "kick" },
      equipmentType: { equipmentTypeKey: "paddles" },
      targetType: { workoutTargetTypeKey: "swim.css.offset" },
      targetValueOne: 5,
    });
    expect(lengths).toMatchObject({
      endCondition: { conditionTypeKey: "fixed.repetition" },
      endConditionValue: 4,
      strokeType: { strokeTypeKey: "individual_medley" },
      equipmentType: { equipmentTypeKey: "fins" },
    });
  });

  test("encodes less common step end conditions with their values", () => {
    const steps = buildWorkout("End conditions", { sport: "other" })
      .rest({ restSeconds: 45 })
      .interval({ calories: 200 })
      .interval({ heartRateBpm: 160 })
      .interval({ powerWatts: 250 })
      .build().workoutSegments[0]!.workoutSteps;

    expect(steps.map((step) => [step.endCondition?.["conditionTypeKey"], step.endConditionValue])).toEqual([
      ["fixed.rest", 45],
      ["calories", 200],
      ["heart.rate", 160],
      ["power", 250],
    ]);
  });
});
