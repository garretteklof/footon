import { pathSegment } from "@/util/validate";
import {
    BODY_BATTERY_ENDPOINT,
    HEART_RATES_ENDPOINT,
    HRV_ENDPOINT,
    SLEEP_ENDPOINT,
    STEPS_ENDPOINT,
    USER_SUMMARY_ENDPOINT,
} from "@/constants/endpoints";
import { GarminAuthError, GarminError } from "@/errors";
import type { ApiClient } from "../types/api";
import type { BodyCompositionRange } from "../types/bodyComposition";
import {
    formatDate,
    formatGmtTimestamp,
    formatLocalTimestamp,
} from "@/util/date";

import type {
    BloodPressureRange,
    BloodPressureSetResult,
    BodyBatteryEntry,
    BodyBatteryEvent,
    CaloriesDailyEntry,
    DailyEventsData,
    DailyStatsEntry,
    DailyStatsType,
    DailyStepsEntry,
    DailyStressData,
    FloorsData,
    HeartRateData,
    HrvData,
    HrvDataRange,
    HydrationLogResult,
    IntensityMinutesData,
    RespirationData,
    RhrDailyEntry,
    RhrDayData,
    SleepData,
    SleepDailyEntry,
    Spo2Data,
    StatsAndBody,
    StepsEntry,
    UserSummary,
    WeeklyIntensityMinutesEntry,
    WeeklyStepsEntry,
    WeeklyStressEntry,
} from "../types/wellness";

interface WellnessHost {
    readonly client: ApiClient;
    displayName(): Promise<string>;
    getBodyComposition(
        startdate: string | Date,
        enddate?: string | Date,
    ): Promise<BodyCompositionRange | null>;
}

export function createWellnessApi(host: WellnessHost) {
    async function getUserSummary(
        cdate: string | Date,
    ): Promise<UserSummary> {
        const date = formatDate(cdate);
        const summary = await host.client.connectapi<UserSummary>(
            `${USER_SUMMARY_ENDPOINT}/${pathSegment(await host.displayName())}`,
            { params: { calendarDate: date } },
        );
        if (!summary) throw new GarminError("No user summary received from Garmin");
        if (summary.privacyProtected === true) {
            throw new GarminAuthError("User summary is privacy-protected");
        }
        return summary;
    }

    async function getStepsData(
        cdate: string | Date,
    ): Promise<StepsEntry[]> {
        const date = formatDate(cdate);
        const steps = await host.client.connectapi<StepsEntry[]>(
            `${STEPS_ENDPOINT}/${pathSegment(await host.displayName())}`,
            { params: { date } },
        );
        return steps ?? [];
    }

    async function getHeartRates(
        cdate: string | Date,
    ): Promise<HeartRateData> {
        const date = formatDate(cdate);
        const data = await host.client.connectapi<HeartRateData>(
            `${HEART_RATES_ENDPOINT}/${pathSegment(await host.displayName())}`,
            { params: { date } },
        );
        if (!data) throw new GarminError("No heart rate data received from Garmin");
        return data;
    }

    // Garmin returns no sleep data when the user did not wear the watch.
    async function getSleepData(
        cdate: string | Date,
    ): Promise<SleepData | null> {
        const date = formatDate(cdate);
        return host.client.connectapi<SleepData>(
            `${SLEEP_ENDPOINT}/${pathSegment(await host.displayName())}`,
            { params: { date, nonSleepBufferMinutes: 60 } },
        );
    }

    async function getHrvData(
        cdate: string | Date,
    ): Promise<HrvData | null> {
        return host.client.connectapi<HrvData>(
            `${HRV_ENDPOINT}/${pathSegment(formatDate(cdate))}`,
        );
    }

    async function getBodyBattery(
        startdate: string | Date,
        enddate?: string | Date,
    ): Promise<BodyBatteryEntry[]> {
        const start = formatDate(startdate);
        const end = enddate === undefined ? start : formatDate(enddate);
        const data = await host.client.connectapi<BodyBatteryEntry[]>(
            BODY_BATTERY_ENDPOINT,
            { params: { startDate: start, endDate: end } },
        );
        return data ?? [];
    }

    async function getBodyBatteryEvents(
        cdate: string | Date,
    ): Promise<BodyBatteryEvent[] | null> {
        return host.client.connectapi<BodyBatteryEvent[]>(
            `/wellness-service/wellness/bodyBattery/events/${pathSegment(formatDate(cdate))}`,
        );
    }

    async function getFloors(
        cdate: string | Date,
    ): Promise<FloorsData> {
        const date = formatDate(cdate);
        const data = await host.client.connectapi<FloorsData>(
            `/wellness-service/wellness/floorsChartData/daily/${pathSegment(date)}`,
        );
        if (!data) throw new GarminError("No floors data received from Garmin");
        return data;
    }

    /**
     * Garmin limits step requests to 28 days. Longer ranges are split into chunks.
     * Short-range null responses stay null. Empty chunks are omitted from longer results.
     */
    async function getDailySteps(
        start: string | Date,
        end: string | Date,
    ): Promise<DailyStepsEntry[] | null> {
        const startDate = formatDate(start);
        const endDate = formatDate(end);
        if (startDate > endDate) {
            throw new GarminError(
                "getDailySteps: start date must not be after end date",
            );
        }
        const url = (s: string, e: string): string =>
            `/usersummary-service/stats/steps/daily/${pathSegment(s)}/${pathSegment(e)}`;
        if (daysBetween(startDate, endDate) <= 28) {
            return host.client.connectapi<DailyStepsEntry[]>(
                url(startDate, endDate),
            );
        }
        const results: DailyStepsEntry[] = [];
        let chunkStart = startDate;
        while (chunkStart <= endDate) {
            const chunkEnd =
                daysBetween(chunkStart, endDate) > 27
                    ? addDays(chunkStart, 27)
                    : endDate;
            const chunkResults = await host.client.connectapi<DailyStepsEntry[]>(
                url(chunkStart, chunkEnd),
            );
            if (chunkResults) results.push(...chunkResults);
            chunkStart = addDays(chunkEnd, 1);
        }
        return results;
    }

    /**
     * Garmin limits requests to 28 days. Longer ranges omit aggregates that do not describe the full range.
     */
    async function getDailyStats(
        start: string | Date,
        end: string | Date,
        statsType: DailyStatsType,
    ): Promise<DailyStatsEntry[]> {
        if (!DAILY_STATS_TYPES.has(statsType)) {
            throw new GarminError(
                `statsType must be "CALORIES" or "STEPS"; got "${String(statsType)}"`,
            );
        }
        const startDate = formatDate(start);
        const endDate = formatDate(end);
        if (startDate > endDate) {
            throw new GarminError(
                "getDailyStats: start date must not be after end date",
            );
        }
        const results: DailyStatsEntry[] = [];
        let chunkStart = startDate;
        while (chunkStart <= endDate) {
            const chunkEnd =
                daysBetween(chunkStart, endDate) > 27
                    ? addDays(chunkStart, 27)
                    : endDate;
            const page = await host.client.connectapi<{
                values?: DailyStatsEntry[];
            }>(
                `/usersummary-service/stats/daily/${pathSegment(chunkStart)}/${pathSegment(chunkEnd)}`,
                { params: { statsType } },
            );
            if (page?.values) results.push(...page.values);
            chunkStart = addDays(chunkEnd, 1);
        }
        return results;
    }

    async function getWeeklySteps(
        end: string | Date,
        weeks = 52,
    ): Promise<WeeklyStepsEntry[] | null> {
        assertPositiveInteger(weeks, "weeks");
        const endDate = formatDate(end);
        return host.client.connectapi<WeeklyStepsEntry[]>(
            `/usersummary-service/stats/steps/weekly/${pathSegment(endDate)}/${pathSegment(weeks)}`,
        );
    }

    async function getWeeklyStress(
        end: string | Date,
        weeks = 52,
    ): Promise<WeeklyStressEntry[] | null> {
        assertPositiveInteger(weeks, "weeks");
        const endDate = formatDate(end);
        return host.client.connectapi<WeeklyStressEntry[]>(
            `/usersummary-service/stats/stress/weekly/${pathSegment(endDate)}/${pathSegment(weeks)}`,
        );
    }

    async function getWeeklyIntensityMinutes(
        start: string | Date,
        end: string | Date,
    ): Promise<WeeklyIntensityMinutesEntry[] | null> {
        const s = formatDate(start);
        const e = formatDate(end);
        return host.client.connectapi<WeeklyIntensityMinutesEntry[]>(
            `/usersummary-service/stats/im/weekly/${pathSegment(s)}/${pathSegment(e)}`,
        );
    }

    /** Adds body `totalAverage` values to the user summary. */
    async function getStatsAndBody(
        cdate: string | Date,
    ): Promise<StatsAndBody> {
        const date = formatDate(cdate);
        const [stats, body] = await Promise.all([
            getUserSummary(date),
            host.getBodyComposition(date),
        ]);
        const totalAverage =
            body &&
            typeof body === "object" &&
            body.totalAverage &&
            typeof body.totalAverage === "object"
                ? body.totalAverage
                : {};
        return { ...stats, ...totalAverage };
    }

    /** Pulse is optional. Garmin requires integer values. */
    async function setBloodPressure(
        systolic: number,
        diastolic: number,
        pulse?: number,
        when: Date = new Date(),
        notes = "",
    ): Promise<BloodPressureSetResult | null> {
        if (!Number.isInteger(systolic) || systolic < 70 || systolic > 260) {
            throw new GarminError("systolic must be an integer between 70 and 260");
        }
        if (!Number.isInteger(diastolic) || diastolic < 40 || diastolic > 150) {
            throw new GarminError(
                "diastolic must be an integer between 40 and 150",
            );
        }
        if (
            pulse !== undefined &&
            (!Number.isInteger(pulse) || pulse < 20 || pulse > 250)
        ) {
            throw new GarminError("pulse must be an integer between 20 and 250");
        }
        return host.client.connectapi<BloodPressureSetResult>(
            "/bloodpressure-service/bloodpressure",
            {
                method: "POST",
                json: {
                    measurementTimestampLocal: formatLocalTimestamp(when),
                    measurementTimestampGMT: formatGmtTimestamp(when),
                    systolic,
                    diastolic,
                    sourceType: "MANUAL",
                    notes,
                    ...(pulse !== undefined ? { pulse } : {}),
                },
            },
        );
    }

    async function getBloodPressure(
        startdate: string | Date,
        enddate?: string | Date,
    ): Promise<BloodPressureRange | null> {
        const start = formatDate(startdate);
        const end = enddate === undefined ? start : formatDate(enddate);
        return host.client.connectapi<BloodPressureRange>(
            `/bloodpressure-service/bloodpressure/range/${pathSegment(start)}/${pathSegment(end)}`,
            { params: { includeAll: "true" } },
        );
    }

    async function deleteBloodPressure(
        version: number | string,
        cdate: string | Date,
    ): Promise<unknown> {
        const v = Number(version);
        assertPositiveInteger(v, "version");
        const date = formatDate(cdate);
        return host.client.connectapi(
            `/bloodpressure-service/bloodpressure/${pathSegment(date)}/${pathSegment(v)}`,
            {
                method: "DELETE",
            },
        );
    }

    /**
     * Uses milliliters. Negative values subtract hydration.
     * The magnitude cannot exceed `MAX_HYDRATION_ML`.
     * The method defaults to now. A date without a time uses local midnight.
     * The date and time must match when both are set.
     */
    async function addHydrationData(
        valueInMl: number,
        when?: Date,
        cdate?: string | Date,
    ): Promise<HydrationLogResult | null> {
        if (Math.abs(valueInMl) > MAX_HYDRATION_ML) {
            throw new GarminError(
                `valueInMl magnitude must not exceed ${MAX_HYDRATION_ML}`,
            );
        }
        let date: string;
        let timestampLocal: string;
        if (when === undefined && cdate === undefined) {
            const now = new Date();
            date = formatDate(now);
            timestampLocal = formatLocalTimestamp(now);
        } else if (when === undefined) {
            date = formatDate(cdate as string | Date);
            timestampLocal = `${date}T00:00:00.00`;
        } else if (cdate === undefined) {
            date = formatDate(when);
            timestampLocal = formatLocalTimestamp(when);
        } else {
            date = formatDate(cdate);
            const derivedDate = formatDate(when);
            if (derivedDate !== date) {
                throw new GarminError("timestamp's date does not match cdate");
            }
            timestampLocal = formatLocalTimestamp(when);
        }
        return host.client.connectapi<HydrationLogResult>(
            "/usersummary-service/usersummary/hydration/log",
            {
                method: "PUT",
                json: { calendarDate: date, timestampLocal, valueInML: valueInMl },
            },
        );
    }

    async function getHydrationData(
        cdate: string | Date,
    ): Promise<HydrationLogResult | null> {
        return host.client.connectapi<HydrationLogResult>(
            `/usersummary-service/usersummary/hydration/daily/${pathSegment(formatDate(cdate))}`,
        );
    }

    async function getRespirationData(
        cdate: string | Date,
    ): Promise<RespirationData | null> {
        return host.client.connectapi<RespirationData>(
            `/wellness-service/wellness/daily/respiration/${pathSegment(formatDate(cdate))}`,
        );
    }

    /**
     * Converts `lastSevenDaysAvgSpO2` to a number when Garmin sends a string.
     */
    async function getSpo2Data(
        cdate: string | Date,
    ): Promise<Spo2Data | null> {
        const data = await host.client.connectapi<Spo2Data>(
            `/wellness-service/wellness/daily/spo2/${pathSegment(formatDate(cdate))}`,
        );
        if (
            data &&
            typeof data === "object" &&
            typeof data.lastSevenDaysAvgSpO2 === "string"
        ) {
            data.lastSevenDaysAvgSpO2 = Number(data.lastSevenDaysAvgSpO2);
        }
        return data;
    }

    async function getIntensityMinutesData(
        cdate: string | Date,
    ): Promise<IntensityMinutesData | null> {
        return host.client.connectapi<IntensityMinutesData>(
            `/wellness-service/wellness/daily/im/${pathSegment(formatDate(cdate))}`,
        );
    }

    async function getAllDayStress(
        cdate: string | Date,
    ): Promise<DailyStressData | null> {
        return host.client.connectapi<DailyStressData>(
            `/wellness-service/wellness/dailyStress/${pathSegment(formatDate(cdate))}`,
        );
    }

    async function getAllDayEvents(
        cdate: string | Date,
    ): Promise<DailyEventsData | null> {
        const date = formatDate(cdate);
        return host.client.connectapi<DailyEventsData>(
            "/wellness-service/wellness/dailyEvents",
            {
                params: { calendarDate: date },
            },
        );
    }

    /**
     * Garmin limits this endpoint to 28 days. Longer ranges are chunked.
     * Results are de-duplicated and sorted by `calendarDate`.
     */
    async function getSleepDaily(
        start: string | Date,
        end: string | Date,
    ): Promise<SleepDailyEntry[]> {
        const startDate = formatDate(start);
        const endDate = formatDate(end);
        if (startDate > endDate) {
            throw new GarminError(
                "getSleepDaily: start date must not be after end date",
            );
        }
        const byDate = new Map<string, SleepDailyEntry>();
        let chunkStart = startDate;
        while (chunkStart <= endDate) {
            const chunkEnd =
                daysBetween(chunkStart, endDate) > 27
                    ? addDays(chunkStart, 27)
                    : endDate;
            const data = await host.client.connectapi<{
                individualStats?: SleepDailyEntry[];
            }>(
                `/sleep-service/stats/sleep/daily/${pathSegment(chunkStart)}/${pathSegment(chunkEnd)}`,
            );
            for (const row of data?.individualStats ?? []) {
                const key =
                    typeof row.calendarDate === "string"
                        ? row.calendarDate
                        : JSON.stringify(row);
                byDate.set(key, row);
            }
            chunkStart = addDays(chunkEnd, 1);
        }
        return [...byDate.values()].sort((a, b) =>
            String(a.calendarDate ?? "").localeCompare(
                String(b.calendarDate ?? ""),
            ),
        );
    }

    async function getRhrDay(
        cdate: string | Date,
    ): Promise<RhrDayData | null> {
        const date = formatDate(cdate);
        return host.client.connectapi<RhrDayData>(
            `/userstats-service/wellness/daily/${pathSegment(await host.displayName())}`,
            { params: { fromDate: date, untilDate: date, metricId: 60 } },
        );
    }

    /**
     * Flattens all arrays in `allMetrics.metricsMap` to date/value rows.
     * Omits rows without a value.
     */
    async function getRhrDaily(
        start: string | Date,
        end: string | Date,
    ): Promise<RhrDailyEntry[]> {
        const s = formatDate(start);
        const e = formatDate(end);
        const data = await host.client.connectapi<{
            allMetrics?: { metricsMap?: Record<string, unknown> };
        }>(
            `/userstats-service/wellness/daily/${pathSegment(await host.displayName())}`,
            {
                params: { fromDate: s, untilDate: e, metricId: 60 },
            },
        );
        const metricsMap = data?.allMetrics?.metricsMap ?? {};
        const rows: RhrDailyEntry[] = [];
        for (const entries of Object.values(metricsMap)) {
            if (!Array.isArray(entries)) continue;
            for (const entry of entries as unknown[]) {
                if (!entry || typeof entry !== "object") continue;
                const e2 = entry as Record<string, unknown>;
                if (e2.value === null || e2.value === undefined) continue;
                rows.push({
                    calendarDate: e2.calendarDate as string | undefined,
                    value: e2.value as number,
                });
            }
        }
        return rows;
    }

    /**
     * Requests active calories (`metricId=22`) and resting calories (`metricId=23`).
     * Merges both series by date and omits rows with no values.
     */
    async function getCaloriesDaily(
        start: string | Date,
        end: string | Date,
    ): Promise<CaloriesDailyEntry[]> {
        const s = formatDate(start);
        const e = formatDate(end);
        const query = new URLSearchParams({ fromDate: s, untilDate: e });
        query.append("metricId", "22");
        query.append("metricId", "23");
        const data = await host.client.connectapi<{
            allMetrics?: { metricsMap?: Record<string, unknown> };
        }>(
            `/userstats-service/wellness/daily/${pathSegment(await host.displayName())}?${query.toString()}`,
        );
        const metricsMap = data?.allMetrics?.metricsMap ?? {};
        const byDate = new Map<
            string,
            { calendarDate: string; active?: number; resting?: number }
        >();
        const collect = (
            key: string,
            assign: (
                row: { active?: number; resting?: number },
                value: number | undefined,
            ) => void,
        ) => {
            const entries = metricsMap[key];
            if (!Array.isArray(entries)) return;
            for (const entry of entries as unknown[]) {
                if (!entry || typeof entry !== "object") continue;
                const e2 = entry as Record<string, unknown>;
                const calendarDate = e2.calendarDate as string | undefined;
                if (!calendarDate) continue;
                const value = e2.value as number | null | undefined;
                const existing = byDate.get(calendarDate) ?? { calendarDate };
                assign(existing, value ?? undefined);
                byDate.set(calendarDate, existing);
            }
        };
        collect("WELLNESS_ACTIVE_CALORIES", (row, value) => {
            row.active = value;
        });
        collect("WELLNESS_BMR_CALORIES", (row, value) => {
            row.resting = value;
        });
        const result: CaloriesDailyEntry[] = [];
        for (const { calendarDate, active, resting } of byDate.values()) {
            if (active === undefined && resting === undefined) continue;
            result.push({
                calendarDate,
                active,
                resting,
                total: (active ?? 0) + (resting ?? 0),
            });
        }
        return result;
    }

    async function getHrvDataRange(
        start: string | Date,
        end: string | Date,
    ): Promise<HrvDataRange | null> {
        const s = formatDate(start);
        const e = formatDate(end);
        return host.client.connectapi<HrvDataRange>(
            `/hrv-service/hrv/daily/${pathSegment(s)}/${pathSegment(e)}`,
        );
    }

    return {
        summary: getUserSummary,
        steps: getStepsData,
        heartRates: getHeartRates,
        sleep: getSleepData,
        hrv: getHrvData,
        bodyBattery: getBodyBattery,
        bodyBatteryEvents: getBodyBatteryEvents,
        floors: getFloors,
        dailySteps: getDailySteps,
        dailyStats: getDailyStats,
        weeklySteps: getWeeklySteps,
        weeklyStress: getWeeklyStress,
        weeklyIntensityMinutes: getWeeklyIntensityMinutes,
        statsAndBody: getStatsAndBody,
        setBloodPressure,
        bloodPressure: getBloodPressure,
        deleteBloodPressure,
        addHydration: addHydrationData,
        hydration: getHydrationData,
        respiration: getRespirationData,
        spo2: getSpo2Data,
        intensityMinutes: getIntensityMinutesData,
        allDayStress: getAllDayStress,
        allDayEvents: getAllDayEvents,
        sleepDaily: getSleepDaily,
        restingHeartRateDay: getRhrDay,
        restingHeartRate: getRhrDaily,
        calories: getCaloriesDaily,
        hrvRange: getHrvDataRange,
    };
}

const MS_PER_DAY = 86_400_000;

function toUtcMidnight(dateStr: string): Date {
    return new Date(`${dateStr}T00:00:00Z`);
}

function addDays(dateStr: string, days: number): string {
    const d = toUtcMidnight(dateStr);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function daysBetween(startStr: string, endStr: string): number {
    return Math.round(
        (toUtcMidnight(endStr).getTime() - toUtcMidnight(startStr).getTime()) /
            MS_PER_DAY,
    );
}

const DAILY_STATS_TYPES: ReadonlySet<string> = new Set<DailyStatsType>([
    "CALORIES",
    "STEPS",
]);

function assertPositiveInteger(value: number, name: string): void {
    if (!Number.isInteger(value) || value <= 0) {
        throw new GarminError(`${name} must be a positive integer`);
    }
}

const MAX_HYDRATION_ML = 10_000;
