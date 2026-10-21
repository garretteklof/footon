/** Garmin workout API lookup tables and accepted exercise categories. */

/** `SportType` IDs — from `/workout-service/workout/types`. */
export const WORKOUT_SPORT_TYPE_ID = {
  RUNNING: 1,
  CYCLING: 2,
  OTHER: 3,
  SWIMMING: 4,
  STRENGTH_TRAINING: 5,
  CARDIO_TRAINING: 6,
  YOGA: 7,
  PILATES: 8,
  HIIT: 9,
  MULTI_SPORT: 10,
  MOBILITY: 11,
  RUCKING: 13,
} as const;

export const WORKOUT_STROKE_TYPE_ID = {
  ANY_STROKE: 1,
  BACKSTROKE: 2,
  BREASTSTROKE: 3,
  DRILL: 4,
  FLY: 5,
  FREE: 6,
  INDIVIDUAL_MEDLEY: 7,
  MIXED: 8,
  INDIVIDUAL_MEDLEY_BY_ROUND: 9,
  REVERSE_INDIVIDUAL_MEDLEY_BY_ROUND: 10,
} as const;

export const WORKOUT_DRILL_TYPE_ID = { KICK: 1, PULL: 2, DRILL: 3 } as const;

export const WORKOUT_EQUIPMENT_TYPE_ID = {
  FINS: 1,
  KICKBOARD: 2,
  PADDLES: 3,
  PULL_BUOY: 4,
  SNORKEL: 5,
} as const;

export const WORKOUT_SWIM_INSTRUCTION_TYPE_ID = {
  RECOVERY: 1,
  VERY_EASY: 2,
  EASY: 3,
  MODERATE: 4,
  HARD: 5,
  VERY_HARD: 6,
  ALL_OUT: 7,
  FAST: 8,
  ASCEND: 9,
  DESCEND: 10,
} as const;

/** Supported workout exercise category keys. Invalid categories can cause the whole upload to fail. */
export const WORKOUT_EXERCISE_CATEGORIES = [
  // FIT SDK `exercise_category`, in enum order.
  "BENCH_PRESS",
  "CALF_RAISE",
  "CARDIO",
  "CARRY",
  "CHOP",
  "CORE",
  "CRUNCH",
  "CURL",
  "DEADLIFT",
  "FLYE",
  "HIP_RAISE",
  "HIP_STABILITY",
  "HIP_SWING",
  "HYPEREXTENSION",
  "LATERAL_RAISE",
  "LEG_CURL",
  "LEG_RAISE",
  "LUNGE",
  "OLYMPIC_LIFT",
  "PLANK",
  "PLYO",
  "PULL_UP",
  "PUSH_UP",
  "ROW",
  "SHOULDER_PRESS",
  "SHOULDER_STABILITY",
  "SHRUG",
  "SIT_UP",
  "SQUAT",
  "TOTAL_BODY",
  "TRICEPS_EXTENSION",
  "WARM_UP",
  "RUN",
  "UNKNOWN",
  // Garmin Connect additions to the FIT SDK categories. The first three are accepted by the API but
  // are not offered in the web exercise picker.
  "BIKE",
  "STRETCH",
  "BANDED_EXERCISES",
  "BATTLE_ROPE",
  "SLED",
  "SUSPENSION",
  // Additional movement and equipment categories.
  "BIKE_OUTDOOR",
  "INDOOR_BIKE",
  "RUN_INDOOR",
  "ELLIPTICAL",
  "STAIR_STEPPER",
  "FLOOR_CLIMB",
  "LADDER",
  "SANDBAG",
  "SLEDGE_HAMMER",
  "TIRE",
  "INDOOR_ROW",
  // Yoga poses and pilates/mobility moves.
  "POSE",
  "MOVE",
] as const;

export const WORKOUT_INTENSITY_TYPE_ID = {
  ACTIVE: 1,
  REST: 2,
  WARMUP: 3,
  COOLDOWN: 4,
} as const;

/** `StepType` IDs — from `/workout-service/workout/types`. */
export const WORKOUT_STEP_TYPE_ID = {
  WARMUP: 1,
  COOLDOWN: 2,
  INTERVAL: 3,
  RECOVERY: 4,
  REST: 5,
  REPEAT: 6,
  OTHER: 7,
  MAIN: 8,
} as const;

export const WORKOUT_CONDITION_TYPE_ID = {
  LAP_BUTTON: 1,
  TIME: 2,
  DISTANCE: 3,
  CALORIES: 4,
  POWER: 5,
  HEART_RATE: 6,
  ITERATIONS: 7,
  FIXED_REST: 8,
  FIXED_REPETITION: 9,
  REPS: 10,
  // 11-24: read from GET /workout-service/workout/types -> workoutConditionTypes.
  TRAINING_PEAKS_TSS: 11,
  REPETITION_TIME: 12,
  TIME_AT_VALID_CDA: 13,
  POWER_LAST_LAP: 14,
  MAX_POWER_LAST_LAP: 15,
  REPETITION_SWIM_CSS_OFFSET: 16,
  VELOCITY_LOSS: 17,
  CUSTOM_VELOCITY: 18,
  VBT_VELOCITY_ZONE: 19,
  VELOCITY_MIN: 20,
  PEAK_VELOCITY_MIN: 21,
  PEAK_VELOCITY_LOSS: 22,
  CUSTOM_PEAK_VELOCITY: 23,
  POWER_LOSS: 24,
} as const;

export const WORKOUT_TARGET_TYPE_ID = {
  NO_TARGET: 1,
  POWER_ZONE: 2,
  CADENCE: 3,
  HEART_RATE_ZONE: 4,
  SPEED_ZONE: 5,
  PACE_ZONE: 6,
  GRADE: 7,
  HEART_RATE_LAP: 8,
  POWER_LAP: 9,
  RESISTANCE: 15,
  // 10-27 (minus the IDs above): read from GET /workout-service/workout/types -> workoutTargetTypes.
  POWER_3S: 10,
  POWER_10S: 11,
  POWER_30S: 12,
  SPEED_LAP: 13,
  SWIM_STROKE: 14,
  POWER_CURVE: 16,
  SWIM_CSS_OFFSET: 17,
  SWIM_INSTRUCTION: 18,
  INSTRUCTION: 19,
  VELOCITY_LOSS: 20,
  CUSTOM_VELOCITY: 21,
  VBT_VELOCITY_ZONE: 22,
  POWER_LOSS: 23,
  VELOCITY_MIN: 24,
  PEAK_VELOCITY_MIN: 25,
  PEAK_VELOCITY_LOSS: 26,
  CUSTOM_PEAK_VELOCITY: 27,
} as const;
