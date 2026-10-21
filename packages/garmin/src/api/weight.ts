import { pathSegment } from "@/util/validate";
import { GarminError } from "@/errors";
import type { ApiClient } from "../types/api";
import {
    formatDate,
    formatGmtTimestamp,
    formatLocalTimestamp,
    parseIsoLocal,
    parseIsoUtc,
} from "@/util/date";
import type { DailyWeighIns, WeighInRange } from "../types/weight";

interface WeightHost {
    readonly client: ApiClient;
}

export function createWeightApi(host: WeightHost) {
    /**
     * Garmin returns weight in grams, regardless of the recorded unit.
     */
    async function getWeighIns(
        startdate: string | Date,
        enddate: string | Date,
    ): Promise<WeighInRange> {
        const start = formatDate(startdate);
        const end = formatDate(enddate);
        const data = await host.client.connectapi<WeighInRange>(
            `/weight-service/weight/range/${pathSegment(start)}/${pathSegment(end)}`,
            { params: { includeAll: "true" } },
        );
        return data ?? {};
    }

    /**
     * Sends `weight` unchanged in the unit named by `unitKey`. Garmin converts it.
     */
    async function addWeighIn(
        weight: number,
        unitKey: "kg" | "lbs" = "kg",
        when: Date = new Date(),
    ): Promise<unknown> {
        // Both timestamp fields use the same instant.
        return host.client.connectapi("/weight-service/user-weight", {
            method: "POST",
            json: {
                dateTimestamp: formatLocalTimestamp(when),
                gmtTimestamp: formatGmtTimestamp(when),
                unitKey,
                sourceType: "MANUAL",
                value: weight,
            },
        });
    }

    async function deleteWeighIn(
        cdate: string | Date,
        weightPk: number,
    ): Promise<null> {
        await host.client.connectapi(
            `/weight-service/weight/${pathSegment(formatDate(cdate))}/byversion/${pathSegment(weightPk)}`,
            { method: "DELETE" },
        );
        return null;
    }

    /**
     * Sends weight unchanged in `unitKey`. Uses `dateTimestamp` before `when`.
     * Derives GMT from that instant unless supplied. Parses local times as local and GMT times as UTC.
     */
    async function addWeighInWithTimestamps(
        weight: number,
        unitKey: "kg" | "lbs" = "kg",
        dateTimestamp?: string,
        gmtTimestamp?: string,
        when: Date = new Date(),
    ): Promise<unknown> {
        const localInstant = dateTimestamp ? parseIsoLocal(dateTimestamp) : when;
        if (Number.isNaN(localInstant.getTime())) {
            throw new GarminError(
                `invalid dateTimestamp: "${dateTimestamp ?? ""}"`,
            );
        }
        const gmtInstant = gmtTimestamp ? parseIsoUtc(gmtTimestamp) : localInstant;
        if (Number.isNaN(gmtInstant.getTime())) {
            throw new GarminError(`invalid gmtTimestamp: "${gmtTimestamp ?? ""}"`);
        }

        return host.client.connectapi("/weight-service/user-weight", {
            method: "POST",
            json: {
                dateTimestamp: formatLocalTimestamp(localInstant),
                gmtTimestamp: formatGmtTimestamp(gmtInstant),
                unitKey,
                sourceType: "MANUAL",
                value: weight,
            },
        });
    }

    async function getDailyWeighIns(
        cdate: string | Date,
    ): Promise<DailyWeighIns | null> {
        return host.client.connectapi<DailyWeighIns>(
            `/weight-service/weight/dayview/${pathSegment(formatDate(cdate))}`,
            { params: { includeAll: "true" } },
        );
    }

    /**
     * Returns null when no entries exist or when several exist and `deleteAll` is false.
     * Deletes cannot be undone.
     */
    async function deleteWeighIns(
        cdate: string | Date,
        deleteAll = false,
    ): Promise<number | null> {
        const date = formatDate(cdate);
        const day = await getDailyWeighIns(date);
        const entries = day?.dateWeightList ?? [];
        if (entries.length === 0) return null;
        if (entries.length > 1 && !deleteAll) return null;

        let deleted = 0;
        for (const entry of entries) {
            if (typeof entry.samplePk !== "number") continue;
            await deleteWeighIn(date, entry.samplePk);
            deleted++;
        }
        return deleted;
    }

    return {
        list: getWeighIns,
        create: addWeighIn,
        delete: deleteWeighIn,
        createWithTimestamps: addWeighInWithTimestamps,
        getDaily: getDailyWeighIns,
        deleteMany: deleteWeighIns,
    };
}
