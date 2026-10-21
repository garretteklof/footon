/**
 * Garmin exercise names, grouped by category.
 *
 * Import `garmints/exercises` to avoid loading this catalogue through the package root. It adds
 * about a third to the package size.
 *
 * Garmin rejects invalid categories but silently stores invalid exercise names as `""`.
 * `exercise()` checks category/name pairs at compile time. `isExerciseName()` checks runtime input.
 *
 * ```ts
 * import { exercise } from "garmints/exercises";
 *
 * exercise("SQUAT", "BARBELL_BACK_SQUAT");
 * // TypeScript rejects a name from another category.
 * exercise("SQUAT", "BARBELL_BENCH_PRESS");
 * ```
 *
 * Names come from Garmin Connect's public exercise translation catalogue:
 * https://connect.garmin.com/web-translations/exercise_types/exercise_types.properties.
 * This curated list can become outdated. Use `WORKOUT_EXERCISE_CATEGORIES` for category keys.
 */
import { EXERCISES } from "../constants/exercises";

export { EXERCISES };

/** A category that has at least one named exercise — every key of {@link EXERCISES}. */
export type ExerciseCategoryWithNames = keyof typeof EXERCISES;

/** The exercise names valid for one category. */
export type ExerciseName<C extends ExerciseCategoryWithNames> =
    (typeof EXERCISES)[C][number];

/**
 * Returns a `{ category, name }` pair with a compile-time category/name check.
 *
 * Pass the result to a workout step's `exercise` option. The function returns the pair without a
 * runtime check:
 *
 * ```ts
 * .interval({ reps: 10, exercise: exercise("BENCH_PRESS", "BARBELL_BENCH_PRESS") })
 * ```
 */
export function exercise<
    C extends ExerciseCategoryWithNames,
    N extends ExerciseName<C>,
>(category: C, name: N): { category: C; name: N } {
    return { category, name };
}

/**
 * Checks at runtime whether `name` belongs to `category`.
 *
 * Use this for runtime input from a database, form, or user. A `false` result prevents Garmin from
 * silently storing an empty `exerciseName`.
 */
export function isExerciseName(category: string, name: string): boolean {
    // Reject inherited keys. Otherwise `"toString"` appears valid and `"constructor"` fails on `.includes`.
    if (!Object.hasOwn(EXERCISES, category)) return false;
    const names = EXERCISES[category as keyof typeof EXERCISES] as readonly string[];
    return names.includes(name);
}
