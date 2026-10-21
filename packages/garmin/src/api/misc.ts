import { pathSegment } from "@/util/validate";
import type { ApiClient } from "../types/api";
import { formatDate } from "@/util/date";
import type {
    GraphqlResult,
    LifestyleLoggingData,
    ReloadRequestResult,
} from "../types/misc";


interface MiscHost {
    readonly client: ApiClient;
}

export function createMiscApi(host: MiscHost) {

    async function getLifestyleLoggingData(
        cdate: string | Date,
    ): Promise<LifestyleLoggingData | null> {
        return host.client.connectapi<LifestyleLoggingData>(
            `/lifestylelogging-service/dailyLog/${pathSegment(formatDate(cdate))}`,
        );
    }

    /** Requests a daily data reload. Garmin expects an empty POST body. */
    async function requestReload(
        cdate: string | Date,
    ): Promise<ReloadRequestResult | null> {
        return host.client.connectapi<ReloadRequestResult>(
            `/wellness-service/wellness/epoch/request/${pathSegment(formatDate(cdate))}`,
            { method: "POST" },
        );
    }

    async function queryGarminGraphql(
        query: Record<string, unknown>,
    ): Promise<GraphqlResult | null> {
        return host.client.connectapi<GraphqlResult>("/graphql-gateway/graphql", {
            method: "POST",
            json: query,
        });
    }

    return {
        lifestyle: getLifestyleLoggingData,
        requestReload,
        graphql: queryGarminGraphql,
    };
}
