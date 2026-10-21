import { pathSegment } from "@/util/validate";

import { GarminError } from "@/errors";
import type { ApiClient } from "../types/api";
import { formatDate, formatGmtTimestamp } from "@/util/date";
import type {
    MenstrualCalendarData,
    MenstrualCycleSummary,
    MenstrualDayView,
    MenstrualLastConfirmed,
    MenstrualReports,
    PregnancySummary,
} from "../types/womensHealth";

interface WomensHealthHost {
    readonly client: ApiClient;
    getUserProfile(): Promise<{ profileId: number; [key: string]: unknown }>;
}

export function createWomensHealthApi(host: WomensHealthHost) {
    /** Adds the cached profile ID to writes when available. */
    async function resolveUserProfilePk(): Promise<number | undefined> {
        try {
            const profile = await host.getUserProfile();
            return typeof profile.profileId === "number"
                ? profile.profileId
                : undefined;
        } catch {
            return undefined;
        }
    }

    async function getMenstrualDataForDate(
        fordate: string | Date,
    ): Promise<MenstrualDayView | null> {
        return host.client.connectapi<MenstrualDayView>(
            `/periodichealth-service/menstrualcycle/dayview/${pathSegment(formatDate(fordate))}`,
        );
    }

    /** Garmin supports inclusive ranges up to 90 days. This method does not enforce that limit. */
    async function getMenstrualCalendarData(
        startdate: string | Date,
        enddate: string | Date,
    ): Promise<MenstrualCalendarData | null> {
        const start = formatDate(startdate);
        const end = formatDate(enddate);
        return host.client.connectapi<MenstrualCalendarData>(
            `/periodichealth-service/menstrualcycle/calendar/${pathSegment(start)}/${pathSegment(end)}`,
        );
    }

    async function getMenstrualLastConfirmed(
        fordate: string | Date,
    ): Promise<MenstrualLastConfirmed | null> {
        return host.client.connectapi<MenstrualLastConfirmed>(
            `/periodichealth-service/menstrualcycle/lastconfirmed/${pathSegment(formatDate(fordate))}`,
        );
    }

    async function getMenstrualCycleSummary(
        fordate: string | Date,
    ): Promise<MenstrualCycleSummary | null> {
        return host.client.connectapi<MenstrualCycleSummary>(
            `/periodichealth-service/menstrualcycle/summary/${pathSegment(formatDate(fordate))}`,
        );
    }

    /** Accepts 1, 6, or 12 cycles. Trims `reportType` before sending. */
    async function getMenstrualReports(
        fordate: string | Date,
        numberOfCycles = 6,
        options: {
            nextReport?: boolean;
            reportType?: string;
            todayCalendarDate?: string | Date;
        } = {},
    ): Promise<MenstrualReports | null> {
        const date = formatDate(fordate);
        if (!VALID_REPORT_CYCLE_COUNTS.has(numberOfCycles)) {
            throw new GarminError(
                `numberOfCycles must be one of 1, 6, or 12; got ${numberOfCycles}`,
            );
        }
        const todayCalendarDate = formatDate(
            options.todayCalendarDate ?? new Date(),
        );
        const reportType = (options.reportType ?? "CYCLE").trim();
        return host.client.connectapi<MenstrualReports>(
            `/periodichealth-service/reports/menstrualcycle/${pathSegment(numberOfCycles)}/${pathSegment(date)}`,
            {
                params: {
                    next: String(options.nextReport ?? false),
                    reportType,
                    todayCalendarDate,
                },
            },
        );
    }

    async function getPregnancySummary(): Promise<PregnancySummary | null> {
        return host.client.connectapi<PregnancySummary>(
            "/periodichealth-service/menstrualcycle/pregnancysnapshot",
        );
    }

    /**
     * Garmin replaces the full daily log and clears omitted fields.
     * An empty `notes` value clears notes. An omitted field preserves the note.
     * The method requires at least one field. `NO_DISCHARGE` cannot appear with other values.
     * It uppercases enum fields but does not validate them. It uses a UTC `reportTimestamp`.
     */
    async function updateMenstrualDailyLog(
        calendarDate: string | Date,
        options: {
            symptoms?: string[];
            moods?: string[];
            flow?: string;
            discharge?: string[];
            sexDrive?: string;
            sexualActivity?: string;
            notes?: string;
            ovulationDay?: boolean;
        } = {},
    ): Promise<unknown> {
        const date = formatDate(calendarDate);

        const hasAnyField =
            options.symptoms !== undefined ||
            options.moods !== undefined ||
            options.flow !== undefined ||
            options.discharge !== undefined ||
            options.sexDrive !== undefined ||
            options.sexualActivity !== undefined ||
            options.notes !== undefined ||
            options.ovulationDay !== undefined;
        if (!hasAnyField) {
            throw new GarminError(
                "updateMenstrualDailyLog requires at least one field besides calendarDate " +
                    "(this guards against an accidental full-day wipe, since omitted fields are cleared server-side)",
            );
        }

        const discharge = options.discharge?.map((value) => value.toUpperCase());
        if (
            discharge &&
            discharge.includes("NO_DISCHARGE") &&
            discharge.length > 1
        ) {
            throw new GarminError(
                '"NO_DISCHARGE" cannot be combined with any other discharge value',
            );
        }

        const pk = await resolveUserProfilePk();

        const rawBody: Record<string, unknown> = {
            calendarDate: date,
            symptoms: options.symptoms?.map((value) => value.toUpperCase()),
            moods: options.moods?.map((value) => value.toUpperCase()),
            flow: options.flow?.toUpperCase(),
            discharge,
            sexDrive: options.sexDrive?.toUpperCase(),
            sexualActivity: options.sexualActivity?.toUpperCase(),
            notes: options.notes,
            ovulationDay: options.ovulationDay ?? false,
            reportTimestamp: formatGmtTimestamp(new Date()),
            ...(pk !== undefined ? { userProfilePk: pk } : {}),
        };

        return host.client.connectapi(
            `/periodichealth-service/menstrualcycle/dailylog/${pathSegment(date)}`,
            {
                method: "POST",
                json: cleanMenstrualDailyLog(rawBody),
            },
        );
    }

    /**
     * Garmin replaces confirmed days in the range. Omitted days are removed.
     * Each group must contain consecutive dates inside the range. The method rejects empty groups and outside dates.
     * This method cannot identify predicted cycles. It accepts confirmed dates only.
     * The `reportTimestamp` uses UTC.
     */
    async function updateMenstrualCalendar(
        startdate: string | Date,
        enddate: string | Date,
        cycleDatesLists: (string | Date)[][],
        options: { todayCalendarDate?: string | Date } = {},
    ): Promise<unknown> {
        const start = formatDate(startdate);
        const end = formatDate(enddate);

        const normalizedLists = cycleDatesLists.map((group, index) => {
            if (group.length === 0) {
                throw new GarminError(
                    `cycleDatesLists[${index}] must be non-empty`,
                );
            }
            const formatted = group.map((value) => formatDate(value));
            assertConsecutiveDates(formatted, index);
            for (const date of formatted) {
                if (date < start || date > end) {
                    throw new GarminError(
                        `cycleDatesLists[${index}] date "${date}" falls outside [${start}, ${end}]`,
                    );
                }
            }
            return formatted;
        });

        const todayCalendarDate = formatDate(
            options.todayCalendarDate ?? new Date(),
        );
        const pk = await resolveUserProfilePk();

        return host.client.connectapi(
            "/periodichealth-service/menstrualcycle/calendarupdates",
            {
                method: "POST",
                json: {
                    todayCalendarDate,
                    startDate: start,
                    endDate: end,
                    reportTimestamp: formatGmtTimestamp(new Date()),
                    cycleDatesLists: normalizedLists,
                    futureEditsByFE: true,
                    ...(pk !== undefined ? { userProfilePk: pk } : {}),
                },
            },
        );
    }

    /**
     * This endpoint initializes the cycle but does not update preferences.
     * `updateMenstrualSettings` changes preferences. The `reportTimestamp` uses UTC.
     */
    async function initMenstrualCycleSetup(
        periodStartDate: string | Date,
        periodLength: number,
        cycleLength: number,
    ): Promise<unknown> {
        const date = formatDate(periodStartDate);
        const pk = await resolveUserProfilePk();
        return host.client.connectapi(
            "/periodichealth-service/menstrualcycle/initCycleSetup",
            {
                method: "POST",
                json: {
                    periodStartDate: date,
                    periodLength,
                    cycleLength,
                    reportTimestamp: formatGmtTimestamp(new Date()),
                    ...(pk !== undefined ? { userProfilePk: pk } : {}),
                },
            },
        );
    }

    /**
     * Set `predictedCycle` to `true` to confirm a predicted cycle.
     * The `reportTimestamp` uses UTC.
     */
    async function confirmMenstrualPeriodStart(
        periodStartDate: string | Date,
        periodLength: number,
        cycleLength: number,
        options: { predictedCycle?: boolean } = {},
    ): Promise<unknown> {
        const date = formatDate(periodStartDate);
        const pk = await resolveUserProfilePk();
        return host.client.connectapi(
            `/periodichealth-service/menstrualcycle/${pathSegment(date)}`,
            {
                method: "POST",
                json: {
                    periodStartDate: date,
                    periodLength,
                    cycleLength,
                    predictedCycle: options.predictedCycle ?? false,
                    hasSpecifiedCycleLength: true,
                    hasSpecifiedPeriodLength: true,
                    reportTimestamp: formatGmtTimestamp(new Date()),
                    ...(pk !== undefined ? { userProfilePk: pk } : {}),
                },
            },
        );
    }

    /**
     * The method rejects empty updates and merges caller values with current cycle settings.
     * It uses PUT and takes the response ID when `userSettingsId` is absent. It does not update pregnancy fields.
     */
    async function updateMenstrualSettings(
        settings: Record<string, unknown>,
        options: { userSettingsId?: number } = {},
    ): Promise<unknown> {
        if (Object.keys(settings).length === 0) {
            throw new GarminError("settings must be a non-empty object");
        }

        const path = "/userprofile-service/userprofile/user-settings";
        const current = await host.client.connectapi<UserSettingsSnapshot>(path);
        const currentMenstrualSettings = current?.userMenstrualCycleSettings ?? {};
        const merged = { ...currentMenstrualSettings, ...settings };

        let userSettingsId = options.userSettingsId;
        if (userSettingsId === undefined && typeof current?.id === "number") {
            userSettingsId = current.id;
        }

        return host.client.connectapi(path, {
            method: "PUT",
            json: {
                userMenstrualCycleSettings: merged,
                ...(userSettingsId !== undefined ? { id: userSettingsId } : {}),
            },
        });
    }

    return {
        forDate: getMenstrualDataForDate,
        calendar: getMenstrualCalendarData,
        lastConfirmed: getMenstrualLastConfirmed,
        cycleSummary: getMenstrualCycleSummary,
        reports: getMenstrualReports,
        pregnancy: getPregnancySummary,
        updateDailyLog: updateMenstrualDailyLog,
        updateCalendar: updateMenstrualCalendar,
        initializeCycle: initMenstrualCycleSetup,
        confirmPeriodStart: confirmMenstrualPeriodStart,
        updateSettings: updateMenstrualSettings,
    };
}

const VALID_REPORT_CYCLE_COUNTS = new Set([1, 6, 12]);


function isEmptyCollection(value: unknown): boolean {
    if (typeof value === "string") return value.length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object" && value !== null)
        return Object.keys(value).length === 0;
    return false;
}

/** This method omits null, undefined, and empty values. It keeps empty `notes` to clear the note. */
function cleanMenstrualDailyLog(
    body: Record<string, unknown>,
): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue;
        if (key !== "notes" && isEmptyCollection(value)) continue;
        cleaned[key] = value;
    }
    return cleaned;
}

function assertConsecutiveDates(dates: string[], groupIndex: number): void {
    for (let i = 1; i < dates.length; i++) {
        const prevMs = Date.parse(`${dates[i - 1]}T00:00:00Z`);
        const curMs = Date.parse(`${dates[i]}T00:00:00Z`);
        if (curMs - prevMs !== 86_400_000) {
            throw new GarminError(
                `cycleDatesLists[${groupIndex}] must be consecutive calendar dates; ` +
                    `"${dates[i - 1]}" is not immediately followed by "${dates[i]}"`,
            );
        }
    }
}

interface UserSettingsSnapshot {
    id?: unknown;
    userMenstrualCycleSettings?: Record<string, unknown>;
    [key: string]: unknown;
}
