import { pathSegment, validateUuid } from "@/util/validate";
import {
    ACTIVITIES_COUNT_ENDPOINT,
    ACTIVITIES_SEARCH_ENDPOINT,
    ACTIVITY_ENDPOINT,
} from "@/constants/endpoints";
import { GarminConnectionError, GarminError, GarminHttpError } from "@/errors";
import type { ApiTransferClient } from "../types/api";
import { formatDate } from "@/util/date";
import type {
    Activity,
    HeartRateForDateResponse,
    ActivityDetails,
    ActivityDownloadFormat,
    ActivityEventType,
    ActivityEventTypeKey,
    ActivityExerciseSets,
    ActivityFeel,
    ActivityGear,
    ActivityHrInTimezones,
    ActivityPowerInTimezones,
    ActivitySplits,
    ActivitySplitSummaries,
    ActivityTypedSplits,
    ActivityTypesResponse,
    ActivityWeather,
    GearActivity,
    GearLinkResult,
    ImportActivityResult,
    PersonalRecords,
    ProgressSummary,
    UploadActivityResult,
} from "../types/activities";

interface ActivitiesHost {
    readonly client: ApiTransferClient;
    /** Garmin identifies personal records by profile display name. */
    displayName(): Promise<string>;
}

export function createActivitiesApi(host: ActivitiesHost) {

    async function countActivities(): Promise<number> {
        const data = await host.client.connectapi<{ totalCount?: number }>(
            ACTIVITIES_COUNT_ENDPOINT,
        );
        if (!data || typeof data.totalCount !== "number") {
            throw new GarminError("No activities count data received");
        }
        return data.totalCount;
    }

    async function getActivities(
        start = 0,
        limit = 20,
    ): Promise<Activity[]> {
        const activities = await host.client.connectapi<Activity[]>(
            ACTIVITIES_SEARCH_ENDPOINT,
            { params: { start, limit } },
        );
        return activities ?? [];
    }

    async function getActivity(
        activityId: number | string,
    ): Promise<Activity> {
        const activity = await host.client.connectapi<Activity>(
            `${ACTIVITY_ENDPOINT}/${pathSegment(activityId)}`,
        );
        if (!activity) throw new GarminError(`No activity ${activityId} found`);
        return activity;
    }

    async function downloadActivity(
        activityId: number | string,
        format: ActivityDownloadFormat = "ORIGINAL",
    ): Promise<Uint8Array> {
        const base = DOWNLOAD_PATHS[format];
        if (!base) {
            throw new GarminError(`Unknown download format "${format}"`);
        }
        return host.client.download(`${base}/${pathSegment(activityId)}`);
    }

    async function getHeartRateForDate(
        fordate: string | Date,
    ): Promise<HeartRateForDateResponse | null> {
        const date = formatDate(fordate);
        return host.client.connectapi<HeartRateForDateResponse>(
            `/mobile-gateway/heartRate/forDate/${pathSegment(date)}`,
        );
    }

    async function getLastActivity(): Promise<Activity | null> {
        const activities = await getActivities(0, 1);
        return activities.length > 0
            ? (activities[activities.length - 1] ?? null)
            : null;
    }

    async function getActivityTypes(): Promise<ActivityTypesResponse | null> {
        return host.client.connectapi<ActivityTypesResponse>(
            "/activity-service/activity/activityTypes",
        );
    }

    async function deleteActivity(
        activityId: number | string,
    ): Promise<unknown> {
        return host.client.connectapi(
            `${ACTIVITY_ENDPOINT}/${pathSegment(activityId)}`,
            {
                method: "DELETE",
            },
        );
    }

    async function setActivityName(
        activityId: number | string,
        activityName: string,
    ): Promise<unknown> {
        return host.client.connectapi(
            `${ACTIVITY_ENDPOINT}/${pathSegment(activityId)}`,
            {
                method: "PUT",
                json: { activityId, activityName },
            },
        );
    }

    async function setActivityType(
        activityId: number | string,
        typeId: number,
        typeKey: string,
        parentTypeId: number,
    ): Promise<unknown> {
        return host.client.connectapi(
            `${ACTIVITY_ENDPOINT}/${pathSegment(activityId)}`,
            {
                method: "PUT",
                json: {
                    activityId,
                    activityTypeDTO: { typeId, typeKey, parentTypeId },
                },
            },
        );
    }

    async function setActivityDescription(
        activityId: number | string,
        description: string,
    ): Promise<unknown> {
        return host.client.connectapi(
            `${ACTIVITY_ENDPOINT}/${pathSegment(activityId)}`,
            {
                method: "PUT",
                json: { activityId, description },
            },
        );
    }

    async function getActivityEventTypes(): Promise<ActivityEventType[] | null> {
        return host.client.connectapi<ActivityEventType[]>(
            "/activity-service/activity/eventTypes",
        );
    }

    /** Garmin fills `typeId` and sort order from the event-type key. */
    async function setActivityEventType(
        activityId: number | string,
        eventType: ActivityEventTypeKey,
    ): Promise<unknown> {
        if (!ACTIVITY_EVENT_TYPE_KEYS.has(eventType)) {
            throw new GarminError(
                `Unknown activity event type "${String(eventType)}" — expected one of ` +
                    `${[...ACTIVITY_EVENT_TYPE_KEYS].join(", ")}`,
            );
        }
        return host.client.connectapi(
            `${ACTIVITY_ENDPOINT}/${pathSegment(activityId)}`,
            {
                method: "PUT",
                json: { activityId, eventTypeDTO: { typeKey: eventType } },
            },
        );
    }

    /** Accepts RPE from 1 to 10. Garmin stores it as a multiple of 10. */
    async function setActivityPerceivedEffort(
        activityId: number | string,
        rpe: number | null,
    ): Promise<unknown> {
        if (rpe !== null && (!Number.isInteger(rpe) || rpe < 1 || rpe > 10)) {
            throw new GarminError(
                `rpe must be an integer from 1 to 10, or null to clear it; got ${String(rpe)}`,
            );
        }
        return host.client.connectapi(
            `${ACTIVITY_ENDPOINT}/${pathSegment(activityId)}`,
            {
                method: "PUT",
                json: {
                    activityId,
                    summaryDTO: {
                        directWorkoutRpe: rpe === null ? null : rpe * 10,
                    },
                },
            },
        );
    }

    /** Accepts 0, 25, 50, 75, or 100. Pass `null` to clear the rating. */
    async function setActivityFeel(
        activityId: number | string,
        feel: ActivityFeel | null,
    ): Promise<unknown> {
        if (feel !== null && !ACTIVITY_FEELS.has(feel)) {
            throw new GarminError(
                `feel must be one of 0, 25, 50, 75, 100, or null to clear it; got ${String(feel)}`,
            );
        }
        return host.client.connectapi(
            `${ACTIVITY_ENDPOINT}/${pathSegment(activityId)}`,
            {
                method: "PUT",
                json: { activityId, summaryDTO: { directWorkoutFeel: feel } },
            },
        );
    }

    /** Sends the JSON payload without shape validation. */
    async function createManualActivityFromJson(
        payload: Record<string, unknown>,
    ): Promise<unknown> {
        return host.client.connectapi("/activity-service/activity", {
            method: "POST",
            json: payload,
        });
    }

    /** Converts kilometers to meters and minutes to seconds. Sends local time with milliseconds and removes `activity_type_` from `typeKey`. */
    async function createManualActivity(
        startDatetime: string,
        timeZone: string,
        typeKey: string,
        distanceKm: number,
        durationMin: number,
        activityName: string,
    ): Promise<unknown> {
        const payload = {
            activityTypeDTO: { typeKey },
            accessControlRuleDTO: { typeId: 2, typeKey: "private" },
            timeZoneUnitDTO: { unitKey: timeZone },
            activityName,
            metadataDTO: { autoCalcCalories: true },
            summaryDTO: {
                startTimeLocal: startDatetime,
                distance: distanceKm * 1000,
                duration: durationMin * 60,
            },
        };
        return createManualActivityFromJson(payload);
    }

    async function getActivitiesByDate(
        startdate: string | Date,
        enddate?: string | Date,
        activitytype?: string,
        sortorder?: string,
    ): Promise<Activity[]> {
        const startDate = formatDate(startdate);
        const endDate = enddate !== undefined ? formatDate(enddate) : undefined;
        const results: Activity[] = [];
        let start = 0;
        let sawEmptyPage = false;

        for (let page = 0; page < MAX_PAGINATED_REQUESTS; page++) {
            const batch = await host.client.connectapi<Activity[]>(
                "/activitylist-service/activities/search/activities",
                {
                    params: {
                        startDate,
                        start,
                        limit: ACTIVITIES_BY_DATE_PAGE_SIZE,
                        endDate,
                        activityType: activitytype,
                        sortOrder: sortorder,
                    },
                },
            );
            if (!batch || batch.length === 0) {
                sawEmptyPage = true;
                break;
            }
            results.push(...batch);
            start += ACTIVITIES_BY_DATE_PAGE_SIZE;
        }

        if (!sawEmptyPage) {
            throw new GarminError(
                `Pagination exceeded ${MAX_PAGINATED_REQUESTS} requests; aborting`,
            );
        }
        return results;
    }

    /** Uses Garmin's import endpoint and required `NK`, `origin`, and custom `User-Agent` headers. */
    async function importActivity(
        file: Blob,
        filename: string,
    ): Promise<ImportActivityResult> {
        const dotIndex = filename.lastIndexOf(".");
        if (dotIndex <= 0 || dotIndex === filename.length - 1) {
            throw new GarminError(
                `Cannot determine file extension from "${filename}"`,
            );
        }
        const extension = filename.slice(dotIndex + 1).toLowerCase();
        if (!ACTIVITY_UPLOAD_EXTENSIONS.has(extension)) {
            throw new GarminError(
                `Unsupported activity file format ".${extension}" — expected fit, gpx, or tcx`,
            );
        }

        try {
            const result = await host.client.upload(
                file,
                filename,
                `/upload-service/upload/${pathSegment(extension)}`,
                {
                    headers: IMPORT_UPLOAD_HEADERS,
                },
            );
            // Garmin can accept an upload without a response body. Return its filename and status.
            if (result && typeof result === "object") {
                return result as ImportActivityResult;
            }
            return { status: "uploaded", fileName: filename };
        } catch (cause) {
            if (cause instanceof GarminHttpError && cause.status === 409) {
                throw new GarminConnectionError(
                    `Activity already exists (duplicate): ${filename}`,
                    {
                        cause,
                    },
                );
            }
            if (
                cause instanceof GarminHttpError ||
                cause instanceof GarminConnectionError
            ) {
                throw new GarminConnectionError(`Import error: ${cause.message}`, {
                    cause,
                });
            }
            throw cause;
        }
    }

    async function getActivitySplits(
        activityId: number | string,
    ): Promise<ActivitySplits | null> {
        return host.client.connectapi<ActivitySplits>(
            `/activity-service/activity/${pathSegment(activityId)}/splits`,
        );
    }

    async function getActivityTypedSplits(
        activityId: number | string,
    ): Promise<ActivityTypedSplits | null> {
        return host.client.connectapi<ActivityTypedSplits>(
            `/activity-service/activity/${pathSegment(activityId)}/typedsplits`,
        );
    }

    async function getActivitySplitSummaries(
        activityId: number | string,
    ): Promise<ActivitySplitSummaries | null> {
        return host.client.connectapi<ActivitySplitSummaries>(
            `/activity-service/activity/${pathSegment(activityId)}/split_summaries`,
        );
    }

    async function getActivityWeather(
        activityId: number | string,
    ): Promise<ActivityWeather | null> {
        return host.client.connectapi<ActivityWeather>(
            `/activity-service/activity/${pathSegment(activityId)}/weather`,
        );
    }

    async function getActivityHrInTimezones(
        activityId: number | string,
    ): Promise<ActivityHrInTimezones | null> {
        return host.client.connectapi<ActivityHrInTimezones>(
            `/activity-service/activity/${pathSegment(activityId)}/hrTimeInZones`,
        );
    }

    async function getActivityPowerInTimezones(
        activityId: number | string,
    ): Promise<ActivityPowerInTimezones | null> {
        return host.client.connectapi<ActivityPowerInTimezones>(
            `/activity-service/activity/${pathSegment(activityId)}/powerTimeInZones`,
        );
    }

    async function getActivityDetails(
        activityId: number | string,
        maxchart = 2000,
        maxpoly = 4000,
    ): Promise<ActivityDetails | null> {
        return host.client.connectapi<ActivityDetails>(
            `/activity-service/activity/${pathSegment(activityId)}/details`,
            {
                params: {
                    maxChartSize: String(maxchart),
                    maxPolylineSize: String(maxpoly),
                },
            },
        );
    }

    async function getActivityExerciseSets(
        activityId: number | string,
    ): Promise<ActivityExerciseSets | null> {
        return host.client.connectapi<ActivityExerciseSets>(
            `/activity-service/activity/${pathSegment(activityId)}/exerciseSets`,
        );
    }

    /** Garmin replaces the full `exerciseSets` array and rejects unknown FIT exercise names. */
    async function setActivityExerciseSets(
        activityId: number | string,
        payload: ActivityExerciseSets,
    ): Promise<unknown> {
        return host.client.connectapi(
            `/activity-service/activity/${pathSegment(activityId)}/exerciseSets`,
            {
                method: "PUT",
                json: payload,
            },
        );
    }

    async function getActivityGear(
        activityId: number | string,
    ): Promise<ActivityGear[] | null> {
        return host.client.connectapi<ActivityGear[]>(
            "/gear-service/gear/filterGear",
            {
                params: { activityId },
            },
        );
    }

    /** Caps `limit` at 1000. Returns `[]` for HTTP 404 and propagates other errors. */
    async function getGearActivities(
        gearUUID: string,
        limit = 1000,
    ): Promise<GearActivity[]> {
        const cappedLimit = Math.min(limit, GEAR_ACTIVITIES_MAX_LIMIT);
        const uuid = validateUuid(gearUUID);
        try {
            const data = await host.client.connectapi<GearActivity[]>(
                `/activitylist-service/activities/${pathSegment(uuid)}/gear`,
                { params: { start: 0, limit: cappedLimit } },
            );
            return data ?? [];
        } catch (cause) {
            if (cause instanceof GarminHttpError && cause.status === 404) {
                return [];
            }
            throw cause;
        }
    }

    /** Maps HTTP 404 to `GarminConnectionError`. Other errors pass through. */
    async function addGearToActivity(
        gearUUID: string,
        activityId: number | string,
    ): Promise<GearLinkResult | null> {
        const uuid = validateUuid(gearUUID);
        try {
            return await host.client.connectapi<GearLinkResult>(
                `/gear-service/gear/link/${pathSegment(uuid)}/activity/${pathSegment(activityId)}`,
                { method: "PUT" },
            );
        } catch (cause) {
            if (cause instanceof GarminHttpError && cause.status === 404) {
                throw new GarminConnectionError(
                    `Cannot add gear ${gearUUID} to activity ${activityId}: gear not found (likely retired/removed)`,
                    { cause },
                );
            }
            throw cause;
        }
    }

    /** Garmin unlinks gear with `PUT`. Maps HTTP 404 to `GarminConnectionError`. */
    async function removeGearFromActivity(
        gearUUID: string,
        activityId: number | string,
    ): Promise<GearLinkResult | null> {
        const uuid = validateUuid(gearUUID);
        try {
            return await host.client.connectapi<GearLinkResult>(
                `/gear-service/gear/unlink/${pathSegment(uuid)}/activity/${pathSegment(activityId)}`,
                { method: "PUT" },
            );
        } catch (cause) {
            if (cause instanceof GarminHttpError && cause.status === 404) {
                throw new GarminConnectionError(
                    `Cannot remove gear ${gearUUID} from activity ${activityId}: gear not found (likely retired/removed)`,
                    { cause },
                );
            }
            throw cause;
        }
    }

    async function getProgressSummaryBetweenDates(
        startdate: string | Date,
        enddate: string | Date,
        metric = "distance",
        groupbyactivities = true,
    ): Promise<ProgressSummary | null> {
        const startDate = formatDate(startdate);
        const endDate = formatDate(enddate);
        return host.client.connectapi<ProgressSummary>(
            "/fitnessstats-service/activity",
            {
                params: {
                    startDate,
                    endDate,
                    aggregation: "lifetime",
                    groupByParentActivityType: String(groupbyactivities),
                    metric,
                },
            },
        );
    }

    async function downloadHealthSnapshot(
        requestedDate: string | Date,
    ): Promise<Uint8Array> {
        const date = formatDate(requestedDate);
        return host.client.download(
            `/download-service/files/wellness/${pathSegment(date)}`,
        );
    }

    async function getPersonalRecord(): Promise<PersonalRecords | null> {
        const displayName = await host.displayName();
        return host.client.connectapi<PersonalRecords>(
            `/personalrecord-service/personalrecord/prs/${pathSegment(displayName)}`,
        );
    }

    /** Uses the device-sync endpoint without the import headers. */
    async function uploadActivity(
        file: Blob,
        filename: string,
    ): Promise<UploadActivityResult | null> {
        const dotIndex = filename.lastIndexOf(".");
        if (dotIndex <= 0 || dotIndex === filename.length - 1) {
            throw new GarminError(
                `Cannot determine file extension from "${filename}"`,
            );
        }
        const extension = filename.slice(dotIndex + 1).toLowerCase();
        if (!ACTIVITY_UPLOAD_EXTENSIONS.has(extension)) {
            throw new GarminError(
                `Unsupported activity file format ".${extension}" — expected fit, gpx, or tcx`,
            );
        }
        const result = await host.client.upload(file, filename);
        return (result as UploadActivityResult | null) ?? null;
    }

    return {
        count: countActivities,
        getHeartRateForDate: getHeartRateForDate,
        listByDate: getActivitiesByDate,
        getLast: getLastActivity,
        get: getActivity,
        listTypes: getActivityTypes,
        delete: deleteActivity,
        rename: setActivityName,
        setType: setActivityType,
        setDescription: setActivityDescription,
        listEventTypes: getActivityEventTypes,
        setEventType: setActivityEventType,
        setPerceivedEffort: setActivityPerceivedEffort,
        setFeel: setActivityFeel,
        createManualFromJson: createManualActivityFromJson,
        createManual: createManualActivity,
        import: importActivity,
        upload: uploadActivity,
        getPersonalRecord: getPersonalRecord,
        download: downloadActivity,
        splits: getActivitySplits,
        typedSplits: getActivityTypedSplits,
        splitSummaries: getActivitySplitSummaries,
        weather: getActivityWeather,
        heartRateInTimezones: getActivityHrInTimezones,
        powerInTimezones: getActivityPowerInTimezones,
        getDetails: getActivityDetails,
        exerciseSets: getActivityExerciseSets,
        setExerciseSets: setActivityExerciseSets,
        gear: getActivityGear,
        listGearActivities: getGearActivities,
        addGear: addGearToActivity,
        removeGear: removeGearFromActivity,
        getProgressSummary: getProgressSummaryBetweenDates,
        downloadHealthSnapshot: downloadHealthSnapshot,
        list: (options: { start?: number; limit?: number } = {}) =>
            getActivities(options.start, options.limit),
    };
}

const DOWNLOAD_PATHS: Record<ActivityDownloadFormat, string> = {
    ORIGINAL: "/download-service/files/activity",
    TCX: "/download-service/export/tcx/activity",
    GPX: "/download-service/export/gpx/activity",
    KML: "/download-service/export/kml/activity",
    CSV: "/download-service/export/csv/activity",
};

// This PUT accepts only changed fields. Garmin can reject a full activity summary.

const ACTIVITY_EVENT_TYPE_KEYS: ReadonlySet<string> =
    new Set<ActivityEventTypeKey>([
        "race",
        "recreation",
        "specialEvent",
        "training",
        "transportation",
        "touring",
        "geocaching",
        "fitness",
        "uncategorized",
    ]);

const ACTIVITY_FEELS: ReadonlySet<number> = new Set<ActivityFeel>([
    0, 25, 50, 75, 100,
]);

const ACTIVITIES_BY_DATE_PAGE_SIZE = 20;

const MAX_PAGINATED_REQUESTS = 2000;

const IMPORT_UPLOAD_HEADERS: Record<string, string> = {
    NK: "NT",
    origin: "https://sso.garmin.com",
    "User-Agent": "GCM-iOS-5.7.2.1",
};

const ACTIVITY_UPLOAD_EXTENSIONS = new Set(["fit", "gpx", "tcx"]);

const GEAR_ACTIVITIES_MAX_LIMIT = 1000;
