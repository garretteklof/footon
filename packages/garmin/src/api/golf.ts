import { GarminError } from "@/errors";
import type { ApiClient } from "../types/api";
import {
    validateNonNegativeInteger,
    validatePositiveInteger,
    pathSegment,
} from "@/util/validate";
import type {
    GolfClubStats,
    GolfScorecardDetail,
    GolfScorecardSummary,
    GolfShotData,
    GolfUserStats,
} from "../types/golf";

interface GolfHost {
    readonly client: ApiClient;
}

export function createGolfApi(host: GolfHost) {
    /** Garmin requires `per-page`, not `perPage`. */
    async function getGolfSummary(
        start = 0,
        limit = 100,
    ): Promise<GolfScorecardSummary | null> {
        validateNonNegativeInteger(start, "start");
        validatePositiveInteger(limit, "limit");
        return host.client.connectapi<GolfScorecardSummary>(
            "/gcs-golfcommunity/api/v2/scorecard/summary",
            { params: { "per-page": limit, start } },
        );
    }

    /** Sends Garmin's hyphenated keys and `include-longest-shot-distance: "true"`. */
    async function getGolfScorecard(
        scorecardId: number | string,
    ): Promise<GolfScorecardDetail | null> {
        return host.client.connectapi<GolfScorecardDetail>(
            "/gcs-golfcommunity/api/v2/scorecard/detail",
            {
                params: {
                    "scorecard-ids": String(scorecardId),
                    "include-longest-shot-distance": "true",
                },
            },
        );
    }

    /**
     * Garmin ignores filters that include holes 10–18, so this method requests all holes instead.
     */
    async function getGolfShotData(
        scorecardId: number | string,
        holeNumbers?: string,
    ): Promise<GolfShotData | null> {
        const normalized =
            holeNumbers === undefined
                ? undefined
                : normalizeHoleNumbers(holeNumbers);
        return host.client.connectapi<GolfShotData>(
            `/gcs-golfcommunity/api/v2/shot/scorecard/${pathSegment(scorecardId)}/hole`,
            normalized === undefined
                ? {}
                : { params: { "hole-numbers": normalized } },
        );
    }

    /** Garmin requires `per-page` and `include-stats: "true"`. */
    async function getGolfClubStats(
        limit = 1000,
    ): Promise<GolfClubStats[] | null> {
        validatePositiveInteger(limit, "limit");
        return host.client.connectapi<GolfClubStats[]>(
            "/gcs-golfcommunity/api/v2/club/player",
            {
                params: { "per-page": limit, "include-stats": "true" },
            },
        );
    }

    async function getGolfUserStats(): Promise<GolfUserStats | null> {
        return host.client.connectapi<GolfUserStats>(
            "/gcs-golfcommunity/api/v2/player/stats",
        );
    }

    return {
        summary: getGolfSummary,
        scorecard: getGolfScorecard,
        shotData: getGolfShotData,
        clubStats: getGolfClubStats,
        userStats: getGolfUserStats,
    };
}

const HOLE_NUMBER_RE = /^\d+$/;
const MIN_HOLE = 1;
const MAX_HOLE = 18;

function normalizeHoleNumbers(holeNumbers: string): string | undefined {
    const stripped = holeNumbers.replace(/\s+/g, "");
    if (stripped.length === 0) {
        throw new GarminError(`Invalid holeNumbers: "${holeNumbers}"`);
    }
    const tokens = stripped.split(/[,-]/);
    const numbers = tokens.map((token) => {
        if (!HOLE_NUMBER_RE.test(token)) {
            throw new GarminError(`Invalid holeNumbers: "${holeNumbers}"`);
        }
        const n = Number(token);
        if (n < MIN_HOLE || n > MAX_HOLE) {
            throw new GarminError(
                `Invalid holeNumbers: "${holeNumbers}" — holes must be ${MIN_HOLE}-${MAX_HOLE}, got ${n}`,
            );
        }
        return n;
    });
    if (numbers.some((n) => n > 9)) {
        return undefined;
    }
    return numbers.join("-");
}
