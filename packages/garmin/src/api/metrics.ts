import { GarminError } from "@/errors";
import type { ApiClient } from "../types/api";
import { formatDate } from "@/util/date";
import { TRAINING_READINESS_ENDPOINT } from "@/constants/endpoints";
import { validateSportKey, pathSegment } from "@/util/validate";
import type {
    CyclingFtpResult,
    EnduranceScoreResult,
    FitnessAgeResult,
    FtpRangeResult,
    HeartRateZoneEntry,
    HeartRateZoneMethod,
    HeartRateZoneUpdate,
    HillScoreResult,
    LactateThresholdLatest,
    LactateThresholdRange,
    MaxMetricsResult,
    PowerZoneEntry,
    PowerZonesForSportResult,
    RacePredictionsResult,
    RunningToleranceEntry,
    TrainingReadinessEntry,
    TrainingStatusResult,
} from "../types/metrics";

interface MetricsHost {
    readonly client: ApiClient;
    displayName(): Promise<string>;
}

export function createMetricsApi(host: MetricsHost) {
    /** Garmin repeats the date in both URL segments. */
    async function getMaxMetrics(
        cdate: string | Date,
    ): Promise<MaxMetricsResult | null> {
        const date = formatDate(cdate);
        return host.client.connectapi<MaxMetricsResult>(
            `/metrics-service/metrics/maxmet/daily/${pathSegment(date)}/${pathSegment(date)}`,
        );
    }

    async function getMaxMetricsRange(
        start: string | Date,
        end: string | Date,
    ): Promise<MaxMetricsResult | null> {
        const startDate = formatDate(start);
        const endDate = formatDate(end);
        if (startDate > endDate) {
            throw new GarminError(
                "getMaxMetricsRange: start date must not be after end date",
            );
        }
        return host.client.connectapi<MaxMetricsResult>(
            `/metrics-service/metrics/maxmet/daily/${pathSegment(startDate)}/${pathSegment(endDate)}`,
        );
    }

    /**
     * Garmin does not document the functional-threshold-power range endpoint.
     */
    async function getFunctionalThresholdPowerRange(
        start: string | Date,
        end: string | Date,
        sport = "RUNNING",
        aggregation = "daily",
    ): Promise<FtpRangeResult | null> {
        const startDate = formatDate(start);
        const endDate = formatDate(end);
        const normalizedSport = validateSportKey(sport);
        const validatedAggregation = validateFtpAggregation(aggregation);
        return host.client.connectapi<FtpRangeResult>(
            `/biometric-service/stats/functionalThresholdPower/range/${pathSegment(startDate)}/${pathSegment(endDate)}`,
            {
                params: {
                    sport: normalizedSport,
                    aggregation: validatedAggregation,
                    aggregationStrategy: "LATEST",
                },
            },
        );
    }

    /**
     * Latest requests use `sport: "Running"`. Range requests use `"RUNNING"`.
     * Garmin can return `hearRate` instead of `heartRate` in the latest response.
     * Range requests require `startDate`, default `endDate` to today, and include functional threshold power.
     */
    async function getLactateThreshold(
        latest = true,
        startDate?: string | Date,
        endDate?: string | Date,
        aggregation = "daily",
    ): Promise<LactateThresholdLatest | LactateThresholdRange> {
        if (latest) {
            const today = formatDate(new Date());
            const [speedAndHeartRateRaw, powerRaw] = await Promise.all([
                host.client.connectapi<unknown>(
                    "/biometric-service/biometric/latestLactateThreshold",
                ),
                host.client.connectapi<unknown>(
                    `/biometric-service/biometric/powerToWeight/latest/${pathSegment(today)}`,
                    { params: { sport: "Running" } },
                ),
            ]);
            const power: Record<string, unknown> = Array.isArray(powerRaw)
                ? ((powerRaw[0] as Record<string, unknown> | undefined) ?? {})
                : powerRaw && typeof powerRaw === "object"
                  ? (powerRaw as Record<string, unknown>)
                  : {};
            const merged: Record<string, unknown> = {};
            for (const entry of speedAndHeartRateRaw as Iterable<unknown>) {
                const record = entry as Record<string, unknown>;
                for (const [key, value] of Object.entries(record)) {
                    if (key === "heartRate" || key === "hearRate") continue;
                    merged[key] = value;
                }
                const heartRate = record.heartRate ?? record.hearRate;
                if (heartRate !== undefined) merged.heartRate = heartRate;
            }
            return { speed_and_heart_rate: merged, power };
        }

        if (startDate === undefined) {
            throw new GarminError(
                "getLactateThreshold: startDate is required when latest is false",
            );
        }
        const start = formatDate(startDate);
        const end =
            endDate === undefined ? formatDate(new Date()) : formatDate(endDate);
        const validatedAggregation = validateFtpAggregation(aggregation);
        const params = {
            sport: "RUNNING",
            aggregation: validatedAggregation,
            aggregationStrategy: "LATEST",
        };
        const [speed, heartRate, power] = await Promise.all([
            host.client.connectapi<unknown>(
                `/biometric-service/stats/lactateThresholdSpeed/range/${pathSegment(start)}/${pathSegment(end)}`,
                { params },
            ),
            host.client.connectapi<unknown>(
                `/biometric-service/stats/lactateThresholdHeartRate/range/${pathSegment(start)}/${pathSegment(end)}`,
                { params },
            ),
            getFunctionalThresholdPowerRange(
                start,
                end,
                "RUNNING",
                validatedAggregation,
            ),
        ]);
        return { speed, heart_rate: heartRate, power };
    }

    async function getTrainingReadiness(
        cdate: string | Date,
    ): Promise<TrainingReadinessEntry[] | null> {
        return host.client.connectapi<TrainingReadinessEntry[]>(
            `${TRAINING_READINESS_ENDPOINT}/${pathSegment(formatDate(cdate))}`,
        );
    }

    /**
     * Selects the `AFTER_WAKEUP_RESET` entry, then the first entry. Returns `null` for an empty list.
     * Some firmware omits the list shape. In that case, the method returns Garmin's response unchanged.
     */
    async function getMorningTrainingReadiness(
        cdate: string | Date,
    ): Promise<TrainingReadinessEntry | null> {
        const data = (await getTrainingReadiness(cdate)) as unknown;
        if (!data || (Array.isArray(data) && data.length === 0)) return null;
        if (!Array.isArray(data)) return data as TrainingReadinessEntry;
        const list = data as TrainingReadinessEntry[];
        const match = list.find(
            (entry) => entry.inputContext === "AFTER_WAKEUP_RESET",
        );
        return match ?? list[0] ?? null;
    }

    /** Single dates use `calendarDate`. Ranges use weekly aggregation. */
    async function getEnduranceScore(
        startdate: string | Date,
        enddate?: string | Date,
    ): Promise<EnduranceScoreResult | null> {
        const start = formatDate(startdate);
        if (enddate === undefined) {
            return host.client.connectapi<EnduranceScoreResult>(
                "/metrics-service/metrics/endurancescore",
                { params: { calendarDate: start } },
            );
        }
        const end = formatDate(enddate);
        return host.client.connectapi<EnduranceScoreResult>(
            "/metrics-service/metrics/endurancescore/stats",
            { params: { startDate: start, endDate: end, aggregation: "weekly" } },
        );
    }

    /** Garmin accepts only `daily` or `weekly` aggregation for running tolerance. */
    async function getRunningTolerance(
        startdate: string | Date,
        enddate: string | Date,
        aggregation = "weekly",
    ): Promise<RunningToleranceEntry[] | null> {
        if (!RUNNING_TOLERANCE_AGGREGATIONS.has(aggregation)) {
            throw new GarminError(
                `aggregation must be one of daily, weekly; got "${aggregation}"`,
            );
        }
        const start = formatDate(startdate);
        const end = formatDate(enddate);
        return host.client.connectapi<RunningToleranceEntry[]>(
            "/metrics-service/metrics/runningtolerance/stats",
            { params: { startDate: start, endDate: end, aggregation } },
        );
    }

    /**
     * Uses the latest route with no arguments or the range route with all three arguments.
     * Accepts `daily` or `monthly`. Partial arguments and ranges over 366 days fail.
     * The range check does not reject reversed dates.
     */
    async function getRacePredictions(
        startdate?: string | Date,
        enddate?: string | Date,
        type?: "daily" | "monthly",
    ): Promise<RacePredictionsResult | null> {
        const provided = [startdate, enddate, type].filter(
            (v) => v !== undefined,
        ).length;
        if (provided !== 0 && provided !== 3) {
            throw new GarminError(
                "getRacePredictions: you must either provide all parameters or no parameters",
            );
        }
        if (provided === 0) {
            return host.client.connectapi<RacePredictionsResult>(
                `/metrics-service/metrics/racepredictions/latest/${pathSegment(await host.displayName())}`,
            );
        }
        if (type !== "daily" && type !== "monthly") {
            throw new GarminError(
                'getRacePredictions: type must be "daily" or "monthly"',
            );
        }
        const start = formatDate(startdate as string | Date);
        const end = formatDate(enddate as string | Date);
        if (daysBetween(start, end) > 366) {
            throw new GarminError(
                "getRacePredictions: date range must not exceed 366 days",
            );
        }
        return host.client.connectapi<RacePredictionsResult>(
            `/metrics-service/metrics/racepredictions/${pathSegment(type)}/${pathSegment(await host.displayName())}`,
            { params: { fromCalendarDate: start, toCalendarDate: end } },
        );
    }

    async function getTrainingStatus(
        cdate: string | Date,
    ): Promise<TrainingStatusResult | null> {
        return host.client.connectapi<TrainingStatusResult>(
            `/metrics-service/metrics/trainingstatus/aggregated/${pathSegment(formatDate(cdate))}`,
        );
    }

    async function getFitnessAgeData(
        cdate: string | Date,
    ): Promise<FitnessAgeResult | null> {
        return host.client.connectapi<FitnessAgeResult>(
            `/fitnessage-service/fitnessage/${pathSegment(formatDate(cdate))}`,
        );
    }

    /** Range requests use daily aggregation. */
    async function getHillScore(
        startdate: string | Date,
        enddate?: string | Date,
    ): Promise<HillScoreResult | null> {
        const start = formatDate(startdate);
        if (enddate === undefined) {
            return host.client.connectapi<HillScoreResult>(
                "/metrics-service/metrics/hillscore",
                { params: { calendarDate: start } },
            );
        }
        const end = formatDate(enddate);
        return host.client.connectapi<HillScoreResult>(
            "/metrics-service/metrics/hillscore/stats",
            { params: { startDate: start, endDate: end, aggregation: "daily" } },
        );
    }

    /** Returns the latest cycling value. Use the range method for history. */
    async function getCyclingFtp(): Promise<CyclingFtpResult | null> {
        return host.client.connectapi<CyclingFtpResult>(
            "/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING",
        );
    }

    async function getHeartRateZones(): Promise<HeartRateZoneEntry[] | null> {
        return host.client.connectapi<HeartRateZoneEntry[]>(
            "/biometric-service/heartRateZones",
        );
    }

    /**
     * Garmin copies the DEFAULT profile when a sport has no profile.
     * Garmin does not recalculate zone floors. Floors must be in ascending order.
     */
    async function setHeartRateZones(
        update: HeartRateZoneUpdate,
    ): Promise<HeartRateZoneEntry | null> {
        const sport = validateSportKey(update.sport ?? "DEFAULT");
        const {
            trainingMethod,
            maxHeartRate,
            restingHeartRate,
            lactateThresholdHeartRate,
            zoneFloors,
        } = update;
        if (
            [
                trainingMethod,
                maxHeartRate,
                restingHeartRate,
                lactateThresholdHeartRate,
                zoneFloors,
            ].every((v) => v === undefined)
        ) {
            throw new GarminError(
                "setHeartRateZones needs at least one field to change besides sport",
            );
        }
        if (trainingMethod !== undefined && !HR_ZONE_METHODS.has(trainingMethod)) {
            throw new GarminError(
                `Unknown trainingMethod "${String(trainingMethod)}" — expected HR_MAX, HR_RESERVE or LACTATE_THRESHOLD`,
            );
        }
        if (maxHeartRate !== undefined) assertBpm(maxHeartRate, "maxHeartRate");
        if (restingHeartRate !== undefined)
            assertBpm(restingHeartRate, "restingHeartRate");
        if (lactateThresholdHeartRate !== undefined) {
            assertBpm(lactateThresholdHeartRate, "lactateThresholdHeartRate");
        }
        if (zoneFloors !== undefined) {
            if (!Array.isArray(zoneFloors) || zoneFloors.length !== 5) {
                throw new GarminError(
                    "zoneFloors must hold exactly five values, the floors of zones 1-5",
                );
            }
            zoneFloors.forEach((f, i) => assertBpm(f, `zoneFloors[${String(i)}]`));
            for (let i = 1; i < 5; i++) {
                if (zoneFloors[i]! <= zoneFloors[i - 1]!) {
                    throw new GarminError("zoneFloors must be strictly ascending");
                }
            }
        }

        const profiles =
            (await host.client.connectapi<HeartRateZoneEntry[]>(HR_ZONES_PATH)) ??
            [];
        const existing = profiles.find((p) => p.sport === sport);
        const base = existing ?? profiles.find((p) => p.sport === "DEFAULT");
        if (!base) {
            throw new GarminError(
                `No ${sport} heart-rate zone profile, and no DEFAULT one to start it from`,
            );
        }
        const next: HeartRateZoneEntry = { ...base, sport, changeState: "CHANGED" };
        if (trainingMethod !== undefined) next.trainingMethod = trainingMethod;
        if (maxHeartRate !== undefined) next.maxHeartRateUsed = maxHeartRate;
        if (restingHeartRate !== undefined) {
            next.restingHeartRateUsed = restingHeartRate;
            next.restingHrAutoUpdateUsed = false;
        }
        if (lactateThresholdHeartRate !== undefined) {
            next.lactateThresholdHeartRateUsed = lactateThresholdHeartRate;
        }
        if (zoneFloors !== undefined) {
            zoneFloors.forEach((floor, i) => {
                next[`zone${String(i + 1)}Floor`] = floor;
            });
        }

        await host.client.connectapi(HR_ZONES_PATH, {
            method: "PUT",
            json: [next],
        });
        const after =
            await host.client.connectapi<HeartRateZoneEntry[]>(HR_ZONES_PATH);
        return after?.find((p) => p.sport === sport) ?? null;
    }

    /**
     * Sends the current profile with `changeState: "DELETED"` so the sport uses DEFAULT.
     * Cannot remove DEFAULT. Throws when the sport has no profile.
     */
    async function deleteHeartRateZones(
        sport: string,
    ): Promise<unknown> {
        const key = validateSportKey(sport);
        if (key === "DEFAULT") {
            throw new GarminError(
                "The DEFAULT heart-rate zone profile cannot be deleted",
            );
        }
        const profiles =
            (await host.client.connectapi<HeartRateZoneEntry[]>(HR_ZONES_PATH)) ??
            [];
        const existing = profiles.find((p) => p.sport === key);
        if (!existing) {
            throw new GarminError(
                `There is no ${key} heart-rate zone profile to delete`,
            );
        }
        return host.client.connectapi(HR_ZONES_PATH, {
            method: "PUT",
            json: [{ ...existing, changeState: "DELETED" }],
        });
    }

    async function getPowerZones(): Promise<PowerZoneEntry[] | null> {
        return host.client.connectapi<PowerZoneEntry[]>(
            "/biometric-service/powerZones/sports/all",
        );
    }

    async function getPowerZonesForSport(
        sport: string,
    ): Promise<PowerZonesForSportResult | null> {
        const normalized = validateSportKey(sport);
        return host.client.connectapi<PowerZonesForSportResult>(
            `/biometric-service/powerZones/sport/${pathSegment(normalized)}`,
        );
    }

    return {
        maxMetrics: getMaxMetrics,
        maxMetricsRange: getMaxMetricsRange,
        functionalThresholdPower: getFunctionalThresholdPowerRange,
        lactateThreshold: getLactateThreshold,
        readiness: getTrainingReadiness,
        morningReadiness: getMorningTrainingReadiness,
        endurance: getEnduranceScore,
        runningTolerance: getRunningTolerance,
        racePredictions: getRacePredictions,
        status: getTrainingStatus,
        fitnessAge: getFitnessAgeData,
        hillScore: getHillScore,
        cyclingFtp: getCyclingFtp,
        heartRateZones: getHeartRateZones,
        setHeartRateZones,
        deleteHeartRateZones,
        powerZones: getPowerZones,
        powerZonesForSport: getPowerZonesForSport,
    };
}

const MS_PER_DAY = 86_400_000;

function toUtcMidnight(dateStr: string): Date {
    return new Date(`${dateStr}T00:00:00Z`);
}

function daysBetween(startStr: string, endStr: string): number {
    return Math.round(
        (toUtcMidnight(endStr).getTime() - toUtcMidnight(startStr).getTime()) /
            MS_PER_DAY,
    );
}

const FTP_AGGREGATIONS = new Set(["daily", "weekly", "monthly", "yearly"]);

function validateFtpAggregation(aggregation: string): string {
    if (!FTP_AGGREGATIONS.has(aggregation)) {
        throw new GarminError(
            `aggregation must be one of daily, weekly, monthly, yearly; got "${aggregation}"`,
        );
    }
    return aggregation;
}

const RUNNING_TOLERANCE_AGGREGATIONS = new Set(["daily", "weekly"]);

const HR_ZONES_PATH = "/biometric-service/heartRateZones";
const HR_ZONE_METHODS: ReadonlySet<string> = new Set<HeartRateZoneMethod>([
    "HR_MAX",
    "HR_RESERVE",
    "LACTATE_THRESHOLD",
]);

function assertBpm(value: number, name: string): void {
    if (!Number.isInteger(value) || value < 1 || value > 300) {
        throw new GarminError(
            `${name} must be a whole number of bpm from 1 to 300; got ${String(value)}`,
        );
    }
}
