import { pathSegment } from "@/util/validate";
import { GarminError } from "@/errors";
import type { ApiTransferClient } from "../types/api";
import type { DeviceLastUsed } from "../types/devices";
import { formatDate } from "@/util/date";
import { WORKOUT_SPORT_TYPE_ID } from "@/constants/workouts";
import {
    type CalendarItem,
    type CalendarMonth,
    type ScheduledWorkoutSummary,
    type TrainingPlanWorkoutSchedule,
    type WorkoutInput,
    type WorkoutRecord,
    type DeviceMessage,
} from "../types/workouts";

interface WorkoutsHost {
    readonly client: ApiTransferClient;
    getLastUsedDevice(): Promise<DeviceLastUsed | null>;
}

export function createWorkoutsApi(host: WorkoutsHost) {
    async function getWorkouts(
        start = 0,
        limit = 100,
    ): Promise<WorkoutRecord[] | null> {
        return host.client.connectapi<WorkoutRecord[]>(
            "/workout-service/workouts",
            {
                params: { start, limit },
            },
        );
    }

    async function getWorkoutById(
        workoutId: number | string,
    ): Promise<WorkoutRecord | null> {
        return host.client.connectapi<WorkoutRecord>(
            `/workout-service/workout/${pathSegment(workoutId)}`,
        );
    }

    /** Deleting a workout template cannot be undone. */
    async function deleteWorkout(
        workoutId: number | string,
    ): Promise<unknown> {
        return host.client.connectapi(
            `/workout-service/workout/${pathSegment(workoutId)}`,
            { method: "DELETE" },
        );
    }

    async function downloadWorkout(
        workoutId: number | string,
    ): Promise<Uint8Array> {
        return host.client.download(
            `/workout-service/workout/FIT/${pathSegment(workoutId)}`,
        );
    }

    /**
     * Accepts an object, array, or JSON string. Invalid JSON raises `GarminError`.
     * Garmin requires unique `stepOrder` values across repeat groups, or none.
     * Pace targets use meters per second, with the faster bound first.
     * Time-based repeats use `numberOfIterations: null`.
     * Strength workouts use `category` and `exerciseName`. Weights are in kilograms.
     */
    async function uploadWorkout(
        workoutJson: Record<string, unknown> | unknown[] | string,
    ): Promise<WorkoutRecord | null> {
        const body = parseWorkoutJson(workoutJson, /* arrays allowed */ true);
        return host.client.connectapi<WorkoutRecord>("/workout-service/workout", {
            method: "POST",
            json: body,
        });
    }

    /**
     * Garmin's PUT replaces the full workout. Omitted fields are erased.
     * The method sets `workoutId` from the path and accepts only object payloads.
     */
    async function updateWorkout(
        workoutId: number | string,
        workoutJson: Record<string, unknown> | string,
    ): Promise<WorkoutRecord | null> {
        const parsed = parseWorkoutJson(workoutJson, /* arrays not allowed */ false);
        const body = { ...(parsed as Record<string, unknown>), workoutId };
        return host.client.connectapi<WorkoutRecord>(
            `/workout-service/workout/${pathSegment(workoutId)}`,
            {
                method: "PUT",
                json: body,
            },
        );
    }

    async function uploadRunningWorkout(
        workout: WorkoutInput,
    ): Promise<WorkoutRecord | null> {
        return uploadWorkout(buildSportWorkout(workout, RUNNING_SPORT_TYPE));
    }

    async function uploadCyclingWorkout(
        workout: WorkoutInput,
    ): Promise<WorkoutRecord | null> {
        return uploadWorkout(buildSportWorkout(workout, CYCLING_SPORT_TYPE));
    }

    async function uploadSwimmingWorkout(
        workout: WorkoutInput,
    ): Promise<WorkoutRecord | null> {
        return uploadWorkout(buildSportWorkout(workout, SWIMMING_SPORT_TYPE));
    }

    async function uploadStrengthWorkout(
        workout: WorkoutInput,
    ): Promise<WorkoutRecord | null> {
        return uploadWorkout(buildSportWorkout(workout, STRENGTH_SPORT_TYPE));
    }

    /**
     * Uses the last-used device and first saved workout when IDs are omitted.
     * Garmin requires a workout name. The device message uses a relative FIT path.
     */
    async function pushWorkoutToDevice(
        workoutId?: number | string,
        deviceId?: number | string,
    ): Promise<DeviceMessage[] | null> {
        const resolvedDeviceId = deviceId ?? (await resolveLastUsedDeviceId());
        const resolvedWorkoutId = workoutId ?? (await resolveFirstWorkoutId());

        const workout = await getWorkoutById(resolvedWorkoutId);
        const messageName = workout?.workoutName;
        if (typeof messageName !== "string") {
            throw new GarminError(
                `Cannot push workout ${String(resolvedWorkoutId)}: getWorkoutById returned no workoutName`,
            );
        }

        return host.client.connectapi<DeviceMessage[]>(
            "/device-service/devicemessage/messages",
            {
                method: "POST",
                json: [
                    {
                        deviceId: resolvedDeviceId,
                        messageUrl: `workout-service/workout/FIT/${resolvedWorkoutId}`,
                        messageType: "workouts",
                        groupName: null,
                        messageName,
                        priority: 1,
                        fileType: "FIT",
                        metaDataId: resolvedWorkoutId,
                    },
                ],
            },
        );
    }

    async function resolveLastUsedDeviceId(): Promise<number | string> {
        const device = await host.getLastUsedDevice();
        const id = device?.userDeviceId;
        if (id === undefined) {
            throw new GarminError(
                "No last-used device found (userDeviceId missing) to push workout to",
            );
        }
        return id;
    }

    async function resolveFirstWorkoutId(): Promise<number | string> {
        const list = await getWorkouts(0, 1);
        const id = list?.[0]?.workoutId;
        if (id === undefined) {
            throw new GarminError("No workouts found to push.");
        }
        return id;
    }

    /**
     * Accepts months 1–12 and sends Garmin's zero-based month.
     * Requires a year of 2000 or later.
     */
    async function getScheduledWorkouts(
        year: number | string,
        month: number | string,
    ): Promise<CalendarMonth | null> {
        const yearNum = Number(year);
        const monthNum = Number(month);
        if (!Number.isInteger(yearNum) || yearNum < 2000) {
            throw new GarminError(`Expected year >= 2000, got "${String(year)}"`);
        }
        if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
            throw new GarminError(
                `Expected month between 1 and 12, got "${String(month)}"`,
            );
        }
        return host.client.connectapi<CalendarMonth>(
            `/calendar-service/year/${pathSegment(yearNum)}/month/${pathSegment(monthNum - 1)}`,
        );
    }

    /** Uses `/workout-service/schedule`, unlike the calendar month feed. */
    async function getScheduledWorkoutById(
        scheduledWorkoutId: number | string,
    ): Promise<WorkoutRecord | null> {
        return host.client.connectapi<WorkoutRecord>(
            `/workout-service/schedule/${pathSegment(scheduledWorkoutId)}`,
        );
    }

    /** Returns the earliest workout on or after today from this and next month, or `{}`. */
    async function getNextScheduledWorkout(): Promise<CalendarItem | Record<string, never>> {
        const today = new Date();
        const todayStr = formatDate(today);
        const year = today.getUTCFullYear();
        const month = today.getUTCMonth() + 1;
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextYear = month === 12 ? year + 1 : year;

        const [current, next] = await Promise.all([
            getScheduledWorkouts(year, month),
            getScheduledWorkouts(nextYear, nextMonth),
        ]);

        const items = [
            ...(current?.calendarItems ?? []),
            ...(next?.calendarItems ?? []),
        ].filter(
            (item): item is CalendarItem & { date: string } =>
                item.itemType === "workout" &&
                typeof item.date === "string" &&
                item.date >= todayStr,
        );
        items.sort((a, b) => a.date.localeCompare(b.date));
        return items[0] ?? {};
    }

    async function scheduleWorkout(
        workoutId: number | string,
        dateStr: string | Date,
    ): Promise<WorkoutRecord | null> {
        const date = formatDate(dateStr);
        return host.client.connectapi<WorkoutRecord>(
            `/workout-service/schedule/${pathSegment(workoutId)}`,
            {
                method: "POST",
                json: { date },
            },
        );
    }

    /** Removes the scheduled entry without deleting the workout template. */
    async function unscheduleWorkout(
        scheduledWorkoutId: number | string,
    ): Promise<unknown> {
        return host.client.connectapi(
            `/workout-service/schedule/${pathSegment(scheduledWorkoutId)}`,
            {
                method: "DELETE",
            },
        );
    }

    /** Fetches Garmin Coach workouts by UUID. They have no numeric `workoutId`. */
    async function getAdaptiveWorkout(
        workoutUuid: string,
    ): Promise<WorkoutRecord | null> {
        if (
            !/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(
                workoutUuid,
            )
        ) {
            throw new GarminError(`Invalid workout UUID: "${workoutUuid}"`);
        }
        return host.client.connectapi<WorkoutRecord>(
            `/workout-service/fbt-adaptive/${pathSegment(workoutUuid)}`,
        );
    }

    // GraphQL requests use fixed queries and validated inputs. Callers cannot supply query text.

    /** Garmin returns GraphQL errors in HTTP 200 responses. This method raises `GarminError`. */
    async function graphqlScalar<T>(
        field: string,
        args: string,
    ): Promise<T | null> {
        const result = await host.client.connectapi<{
            data?: Record<string, unknown> | null;
            errors?: { message?: string }[];
        }>("/graphql-gateway/graphql", {
            method: "POST",
            json: { query: `query{${field}(${args})}` },
        });
        if (result?.errors?.length) {
            throw new GarminError(
                `Garmin GraphQL ${field} failed: ${result.errors.map((e) => e.message).join("; ")}`,
            );
        }
        return (result?.data?.[field] as T | undefined) ?? null;
    }

    /**
     * Returns planned and user-scheduled workouts across an inclusive date range.
     * Use `scheduledWorkoutId` to unschedule an entry. This feed can lag schedule changes.
     */
    async function getScheduledWorkoutSummaries(
        startdate: string | Date,
        enddate: string | Date,
    ): Promise<ScheduledWorkoutSummary[]> {
        const start = formatDate(startdate);
        const end = formatDate(enddate);
        if (start > end)
            throw new GarminError(
                "getScheduledWorkoutSummaries: start date must not be after end date",
            );
        const rows = await graphqlScalar<ScheduledWorkoutSummary[]>(
            "workoutScheduleSummariesScalar",
            `startDate:"${start}", endDate:"${end}"`,
        );
        return rows ?? [];
    }

    /**
     * Returns workouts grouped by plan. Garmin controls the date window. Adaptive plans may have no
     * future workouts until Garmin generates them.
     */
    async function getTrainingPlanWorkouts(
        calendarDate: string | Date,
        options: { firstDayOfWeek?: "monday" | "sunday"; lang?: string } = {},
    ): Promise<TrainingPlanWorkoutSchedule[]> {
        const date = formatDate(calendarDate);
        const firstDayOfWeek = options.firstDayOfWeek ?? "monday";
        if (firstDayOfWeek !== "monday" && firstDayOfWeek !== "sunday") {
            throw new GarminError(
                `firstDayOfWeek must be "monday" or "sunday"; got "${String(firstDayOfWeek)}"`,
            );
        }
        const lang = options.lang ?? "en-US";
        if (!/^[a-z]{2}-[A-Z]{2}$/.test(lang)) {
            throw new GarminError(`lang must look like "en-US"; got "${lang}"`);
        }
        const plan = await graphqlScalar<{
            trainingPlanWorkoutScheduleDTOS?: TrainingPlanWorkoutSchedule[];
        }>(
            "trainingPlanScalar",
            `calendarDate:"${date}", lang:"${lang}", firstDayOfWeek:"${firstDayOfWeek}"`,
        );
        return plan?.trainingPlanWorkoutScheduleDTOS ?? [];
    }

    return {
        list: getWorkouts,
        get: getWorkoutById,
        delete: deleteWorkout,
        download: downloadWorkout,
        upload: uploadWorkout,
        update: updateWorkout,
        uploadRunning: uploadRunningWorkout,
        uploadCycling: uploadCyclingWorkout,
        uploadSwimming: uploadSwimmingWorkout,
        uploadStrength: uploadStrengthWorkout,
        pushToDevice: pushWorkoutToDevice,
        listScheduled: getScheduledWorkouts,
        getScheduledWorkout: getScheduledWorkoutById,
        getNextScheduledWorkout: getNextScheduledWorkout,
        schedule: scheduleWorkout,
        unschedule: unscheduleWorkout,
        getAdaptiveWorkout: getAdaptiveWorkout,
        listScheduledWorkoutSummaries: getScheduledWorkoutSummaries,
        listTrainingPlanWorkouts: getTrainingPlanWorkouts,
    };
}

function parseWorkoutJson(
    input: Record<string, unknown> | unknown[] | string,
    allowArray: boolean,
): Record<string, unknown> | unknown[] {
    let value: unknown = input;
    if (typeof input === "string") {
        try {
            value = JSON.parse(input) as unknown;
        } catch (cause) {
            throw new GarminError("workoutJson is not valid JSON", { cause });
        }
    }
    if (Array.isArray(value)) {
        if (!allowArray) {
            throw new GarminError(
                "workoutJson must resolve to an object, not an array, for updateWorkout",
            );
        }
        // Array.isArray narrows to any[]. Restore unknown[] for the return type.
        return value as unknown[];
    }
    if (value !== null && typeof value === "object") {
        return value as Record<string, unknown>;
    }
    throw new GarminError(
        "workoutJson must be an object or array (or a JSON string of one)",
    );
}

// Each sport has a distinct Garmin default. Callers can override it.

function buildSportWorkout(
    input: WorkoutInput,
    defaultSportType: Record<string, unknown>,
): Record<string, unknown> {
    if (
        typeof input.workoutName !== "string" ||
        typeof input.estimatedDurationInSecs !== "number" ||
        !Array.isArray(input.workoutSegments)
    ) {
        throw new GarminError(
            "workout must have workoutName (string), estimatedDurationInSecs (number), and workoutSegments (array)",
        );
    }
    return {
        ...input,
        sportType: input.sportType ?? defaultSportType,
    };
}

const RUNNING_SPORT_TYPE = {
    sportTypeId: WORKOUT_SPORT_TYPE_ID.RUNNING,
    sportTypeKey: "running",
    displayOrder: 1,
};
const CYCLING_SPORT_TYPE = {
    sportTypeId: WORKOUT_SPORT_TYPE_ID.CYCLING,
    sportTypeKey: "cycling",
    displayOrder: 2,
};
const SWIMMING_SPORT_TYPE = {
    sportTypeId: WORKOUT_SPORT_TYPE_ID.SWIMMING,
    sportTypeKey: "swimming",
    displayOrder: 3,
};
const STRENGTH_SPORT_TYPE = {
    sportTypeId: WORKOUT_SPORT_TYPE_ID.STRENGTH_TRAINING,
    sportTypeKey: "strength_training",
    displayOrder: 5,
};
