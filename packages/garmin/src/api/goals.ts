import { GarminError } from "@/errors";
import type { ApiClient } from "../types/api";
import {
    validateNonNegativeInteger,
    validatePositiveInteger,
} from "@/util/validate";
import type { Goal, GoalStatus } from "../types/goals";

interface GoalsHost {
    readonly client: ApiClient;
}

export function createGoalsApi(host: GoalsHost) {
    /**
     * Garmin indexes pages from 1. A request cap prevents unbounded pagination.
     * Accepts `active`, `future`, or `past`. The `limit` must be positive.
     * Garmin requires `Sec-Fetch-Site: same-origin` for custom accumulation-goal results.
     */
    async function getGoals(
        status: GoalStatus = "active",
        start = 1,
        limit = 30,
    ): Promise<Goal[]> {
        if (!VALID_STATUSES.includes(status)) {
            throw new GarminError(
                `Invalid goal status "${status}" — must be one of ${VALID_STATUSES.join(", ")}`,
            );
        }
        const validStart = validateNonNegativeInteger(start, "start");
        const validLimit = validatePositiveInteger(limit, "limit");

        const results: Goal[] = [];
        let currentStart = validStart;
        let sawEmptyPage = false;

        for (let page = 0; page < MAX_PAGINATED_REQUESTS; page++) {
            const batch = await host.client.connectapi<Goal[]>(
                "/goal-service/goal/goals",
                {
                    params: {
                        status,
                        start: currentStart,
                        limit: validLimit,
                        sortOrder: "asc",
                    },
                    headers: { "Sec-Fetch-Site": "same-origin" },
                },
            );
            if (!batch || batch.length === 0) {
                sawEmptyPage = true;
                break;
            }
            results.push(...batch);
            currentStart += validLimit;
        }

        if (!sawEmptyPage) {
            throw new GarminError(
                `Pagination exceeded ${MAX_PAGINATED_REQUESTS} requests; aborting`,
            );
        }
        return results;
    }

    return { list: getGoals };
}

const MAX_PAGINATED_REQUESTS = 2000;

const VALID_STATUSES: readonly GoalStatus[] = ["active", "future", "past"];
