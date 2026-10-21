import { GarminError } from "@/errors";
import type { ApiUploadClient } from "../types/api";
import { formatDate } from "@/util/date";
import { FitEncoderWeight, type WeightScaleFields } from "../util/fit";
import type { BodyCompositionRange } from "../types/bodyComposition";

interface BodyCompositionTransferHost {
    readonly client: ApiUploadClient;
}

export function createBodyCompositionApi(host: BodyCompositionTransferHost) {

    async function getBodyComposition(
        startdate: string | Date,
        enddate?: string | Date,
    ): Promise<BodyCompositionRange | null> {
        const start = formatDate(startdate);
        const end = enddate === undefined ? start : formatDate(enddate);
        if (start > end) {
            throw new GarminError(
                "getBodyComposition: start date must not be after end date",
            );
        }
        return host.client.connectapi<BodyCompositionRange>(
            "/weight-service/weight/dateRange",
            { params: { startDate: start, endDate: end } },
        );
    }

    /** Garmin accepts body-composition records as FIT uploads. */
    async function addBodyComposition(
        weight: number,
        extra: WeightScaleFields & { timestamp?: string } = {},
    ): Promise<unknown> {
        if (!Number.isFinite(weight) || weight <= 0) {
            throw new GarminError("weight must be a positive, finite number");
        }
        const { timestamp, ...fields } = extra;
        const when = timestamp !== undefined ? new Date(timestamp) : new Date();
        if (Number.isNaN(when.getTime())) {
            throw new GarminError(`invalid timestamp: "${String(timestamp)}"`);
        }

        const encoder = new FitEncoderWeight();
        // Garmin keeps the FIT file creation time separate from the measurement time.
        encoder.writeFileInfo();
        encoder.writeFileCreator();
        encoder.writeDeviceInfo(when);
        encoder.writeWeightScale(when, weight, fields);
        const fitBytes = encoder.finish();

        const file = new Blob([fitBytes], { type: "application/octet-stream" });
        return host.client.upload(
            file,
            "body_composition.fit",
            "/upload-service/upload",
        );
    }

    return { getRange: getBodyComposition, create: addBodyComposition };
}
