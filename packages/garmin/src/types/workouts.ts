/**
 * Type definitions for workout templates, scheduling, and device messages. Responses keep open fields
 * where Garmin does not document a stable schema.
 */
import type { WORKOUT_EXERCISE_CATEGORIES } from "../constants/workouts";

/**
 * One of the 53 categories Garmin accepts. See `WORKOUT_EXERCISE_CATEGORIES`.
 *
 * The exercise NAMES valid within each category ship separately, in
 * `@footon/garmin/exercises` — see that module for why the two halves are validated so
 * differently.
 */
export type ExerciseCategory = (typeof WORKOUT_EXERCISE_CATEGORIES)[number];

/** A generic `{id, key, displayOrder}`-shaped reference object used throughout workout JSON. */
export interface WorkoutTypeRef {
  [key: string]: unknown;
}

/** One executable workout step (warmup, interval, recovery, cooldown, rest, ...). */
export interface ExecutableWorkoutStep {
  type?: string; // "ExecutableStepDTO"
  stepOrder: number;
  stepType?: WorkoutTypeRef | null;
  endCondition?: WorkoutTypeRef | null;
  endConditionValue?: number | null;
  targetType?: WorkoutTypeRef | null;
  strokeType?: WorkoutTypeRef | null;
  equipmentType?: WorkoutTypeRef | null;
  childStepId?: number | null;
  [key: string]: unknown;
}

/** A repeat block wrapping a set of steps (e.g. "3x" a warmup+interval pair). */
export interface RepeatWorkoutGroup {
  type?: string; // "RepeatGroupDTO"
  stepOrder: number;
  stepType?: WorkoutTypeRef | null;
  /** The iteration count for a count-based repeat; `null` for time-based repeats. */
  numberOfIterations: number | null;
  workoutSteps: (ExecutableWorkoutStep | RepeatWorkoutGroup)[];
  endCondition?: WorkoutTypeRef | null;
  endConditionValue?: number | null;
  childStepId?: number | null;
  smartRepeat?: boolean;
  [key: string]: unknown;
}

/** One segment of a workout (a workout can have several, e.g. a multi-sport workout). */
export interface WorkoutSegment {
  segmentOrder: number;
  sportType: WorkoutTypeRef;
  workoutSteps: (ExecutableWorkoutStep | RepeatWorkoutGroup)[];
  [key: string]: unknown;
}

/**
 * The shape accepted by the six per-sport upload helpers (`uploadRunningWorkout` etc.).
 * `sportType` is optional here — each helper fills in its sport's default when omitted, but an explicit
 * value is passed through unchanged if the caller supplies one.
 */
export interface WorkoutInput {
  workoutName: string;
  sportType?: WorkoutTypeRef;
  estimatedDurationInSecs: number;
  workoutSegments: WorkoutSegment[];
  author?: WorkoutTypeRef;
  description?: string;
  [key: string]: unknown;
}

/** A stored Garmin workout template. Untyped beyond the fields observed/documented; passes through unchecked. */
export interface WorkoutRecord {
  workoutId?: number;
  workoutName?: string;
  [key: string]: unknown;
}

/** One calendar item as returned inside `/calendar-service/year/{y}/month/{m}`'s `calendarItems`. */
export interface CalendarItem {
  itemType?: string;
  date?: string;
  [key: string]: unknown;
}

/** Response of `/calendar-service/year/{year}/month/{month}`. */
export interface CalendarMonth {
  calendarItems?: CalendarItem[];
  [key: string]: unknown;
}

/** A device message queued by `pushWorkoutToDevice`. */
export interface DeviceMessage {
  messageId: number;
  messageType: string;
  messageStatus: string;
  deviceId: number;
  deviceName: string;
  fileType: string;
  messageUrl: string;
  messageName: string;
  priority: number;
  metaDataId: number;
  wifiSetup: boolean;
  hidden: boolean;
  applicationKey: string | null;
  firmwareVersion: string | null;
  deviceXmlDataType: string | null;
  createdTimeStamp: string | null;
  updatedTimeStamp: string | null;
  uniqueIdentifier: string | null;
  groupName: string | null;
  appDetails: unknown;
}

/** One workout entry returned by scheduled-workout and training-plan summary methods. */
export interface ScheduledWorkoutSummary {
  /** `null` for a Garmin Coach workout, which cannot be unscheduled on its own. */
  scheduledWorkoutId: number | null;
  workoutId: number | null;
  workoutUuid: string | null;
  workoutName: string | null;
  /** Sport key, e.g. `"cycling"`. */
  workoutType: string | null;
  /** `YYYY-MM-DD`. */
  scheduleDate: string;
  trainingPlanId?: number | null;
  /**
   * `"ITP"` for an ITP plan's workout; `null` both for a workout you scheduled yourself AND for a
   * Garmin Coach one — tell those apart by `fbtAdaptivePlanId`.
   */
  tpType?: string | null;
  /** Garmin Coach's one-line description of the session. */
  workoutPhrase?: string | null;
  estimatedDurationInSecs?: number | null;
  estimatedDistanceInMeters?: number | null;
  tpPlanName?: string | null;
  itpPlanId?: number | null;
  atpPlanId?: number | null;
  fbtAdaptivePlanId?: number | null;
  selfGuidedPlanId?: number | null;
  /** The activity that completed it, once one has. */
  associatedActivityId?: number | null;
  isRestDay?: boolean | null;
  race?: boolean;
  [key: string]: unknown;
}

/** One enrolled plan's slice of the calendar, from Garmin's GraphQL `trainingPlanScalar`. */
export interface TrainingPlanWorkoutSchedule {
  trainingPlanId: number;
  planName: string;
  /** The plan kind, e.g. `"ITP"` — the same values as a plan's `trainingPlanCategory`. */
  trainingPlanClassification: string;
  trainingPlanDetailsDTO: {
    athletePlanId?: number;
    athleteRace?: { raceDay?: string | null; raceName?: string | null; raceUrl?: string | null } | null;
    workoutsPerWeek?: number;
    registrationDate?: string;
    /** Upper-case sport, e.g. `"CYCLING"`. */
    trainingType?: string;
    [key: string]: unknown;
  } | null;
  workoutScheduleSummaries: ScheduledWorkoutSummary[];
}