import { GarminError, GarminHttpError } from "@/errors";
import type { ApiClient } from "../types/api";
import { formatDate } from "@/util/date";
import { validateSportKey, validateUuid, pathSegment } from "@/util/validate";
import type { Gear, GearDefaults, GearStats } from "../types/gear";

interface GearHost {
    readonly client: ApiClient;
}

export function createGearApi(host: GearHost) {
    /** Garmin returns additional gear fields that the `Gear` type does not include. */
    async function getGear(
        userProfileNumber: number | string,
    ): Promise<Gear[] | null> {
        return host.client.connectapi<Gear[]>("/gear-service/gear/filterGear", {
            params: { userProfilePk: userProfileNumber },
        });
    }

    /**
     * Converts kilometers to meters and minutes to seconds.
     * Rejects values that round below one unit.
     */
    async function createGear(
        gearType: string,
        brand: string,
        model: string,
        name: string,
        firstUseDate: string | Date,
        usageType = "DISTANCE",
        maxUsageDistanceKm?: number,
        maxUsageDurationMin?: number,
        notes = "",
        activityTypeKeys?: string[],
    ): Promise<unknown> {
        const body: Record<string, unknown> = {
            uuid: null,
            gearType: validateSportKey(gearType),
            brand,
            model,
            name,
            firstUseDate: formatDate(firstUseDate),
            maxUsageDate: null,
            usageType: validateSportKey(usageType),
            notes,
            associatedActivityTypes: (activityTypeKeys ?? []).map(
                (activityTypeKey) => ({
                    activityTypeKey,
                    defaultGear: true,
                    preferredGear: false,
                }),
            ),
        };
        if (maxUsageDistanceKm !== undefined) {
            body["maxUsageDistanceMeters"] =
                convertMaxUsageDistanceKm(maxUsageDistanceKm);
        }
        if (maxUsageDurationMin !== undefined) {
            body["maxUsageDurationSeconds"] =
                convertMaxUsageDurationMin(maxUsageDurationMin);
        }
        return host.client.connectapi("/gear-service/gear/v2", {
            method: "POST",
            json: body,
        });
    }

    /** Returns `{}` for an empty response or HTTP 404. The method throws other errors. */
    async function getGearStats(
        gearUUID: string,
    ): Promise<GearStats> {
        const uuid = validateUuid(gearUUID);
        try {
            const data = await host.client.connectapi<GearStats>(
                `/gear-service/gear/stats/${pathSegment(uuid)}`,
            );
            return data ?? {};
        } catch (cause) {
            if (cause instanceof GarminHttpError && cause.status === 404) {
                return {};
            }
            throw cause;
        }
    }

    async function getGearDefaults(
        userProfileNumber: number | string,
    ): Promise<GearDefaults[] | null> {
        return host.client.connectapi<GearDefaults[]>(
            `/gear-service/gear/user/${pathSegment(userProfileNumber)}/activityTypes`,
        );
    }

    /** Deletes gear and its activity history. Garmin requires a hyphenated UUID. */
    async function deleteGear(gearUUID: string): Promise<unknown> {
        const uuid = validateUuid(gearUUID);
        const bare = uuid.replace(/-/g, "");
        const hyphenated =
            bare.length === 32
                ? `${bare.slice(0, 8)}-${bare.slice(8, 12)}-${bare.slice(12, 16)}-${bare.slice(16, 20)}-${bare.slice(20)}`
                : uuid;
        return host.client.connectapi(
            `/gear-service/gear/v2/${pathSegment(hyphenated)}`,
            {
                method: "DELETE",
            },
        );
    }

    /** Replaces all default activity types. Keys use lowercase. An empty list clears them. */
    async function setGearActivityDefaults(
        gearUUID: string,
        activityTypeKeys: string[],
    ): Promise<unknown> {
        const uuid = validateUuid(gearUUID);
        const path = `/gear-service/gear/v2/${pathSegment(uuid)}`;
        const current = await host.client.connectapi<Record<string, unknown>>(path);
        if (!current) {
            throw new GarminError(
                `Cannot set gear defaults: no gear found for UUID ${gearUUID}`,
            );
        }
        const body = {
            ...current,
            associatedActivityTypes: activityTypeKeys.map((activityTypeKey) => ({
                activityTypeKey,
                defaultGear: true,
                preferredGear: false,
            })),
        };
        return host.client.connectapi(path, { method: "PUT", json: body });
    }

    return {
        list: getGear,
        create: createGear,
        getStats: getGearStats,
        delete: deleteGear,
        setActivityDefaults: setGearActivityDefaults,
        getActivityDefaults: getGearDefaults,
    };
}

function convertMaxUsageDistanceKm(km: number): number {
    const meters = Math.round(km * 1000);
    if (meters < 1) {
        throw new GarminError(
            `max_usage_distance_km must convert to at least 1 meter, got ${meters}m from ${km}km`,
        );
    }
    return meters;
}

function convertMaxUsageDurationMin(min: number): number {
    const seconds = Math.round(min * 60);
    if (seconds < 1) {
        throw new GarminError(
            `max_usage_duration_min must convert to at least 1 second, got ${seconds}s from ${min}min`,
        );
    }
    return seconds;
}
