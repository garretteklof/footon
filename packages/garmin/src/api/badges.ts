import type { ApiClient } from "../types/api";
import type {
    AdhocChallenge,
    AvailableBadgeChallenge,
    Badge,
    BadgeChallenge,
    BadgeDetail,
    BadgeImageUrls,
    InprogressVirtualChallenge,
    NonCompletedBadgeChallenge,
} from "../types/badges";
import {
    validateNonNegativeInteger,
    validatePositiveInteger,
} from "@/util/validate";

interface BadgesHost {
    readonly client: ApiClient;
}

export function createChallengesApi(host: BadgesHost) {
    async function getEarnedBadges(): Promise<Badge[] | null> {
        return listWithImageUrls(
            await host.client.connectapi<Badge[]>(
                "/badge-service/badge/earned",
            ),
        );
    }

    async function getAvailableBadges(): Promise<Badge[] | null> {
        return listWithImageUrls(
            await host.client.connectapi<Badge[]>(
                "/badge-service/badge/available",
                {
                    params: { showExclusiveBadge: "true" },
                },
            ),
        );
    }

    /**
     * Returns details for earned and unearned badges. Unknown IDs return HTTP 400.
     * Garmin uses `followingLimit=7` for app requests. This method omits that limit.
     */
    async function getBadgeDetail(
        badgeId: number,
    ): Promise<BadgeDetail | null> {
        const id = validatePositiveInteger(badgeId, "badgeId");
        const detail = await host.client.connectapi<BadgeDetail>(
            `/badge-service/badge/detail/v3/${id}`,
        );
        if (!detail || typeof detail !== "object") return detail;
        const related = Array.isArray(detail.relatedBadges)
            ? detail.relatedBadges.map(withImageUrls)
            : detail.relatedBadges;
        return { ...withImageUrls(detail), relatedBadges: related };
    }

    /** Available data takes precedence for matching `badgeId` values. */
    async function getInProgressBadges(): Promise<Badge[]> {
        const [earned, available] = await Promise.all([
            getEarnedBadges(),
            getAvailableBadges(),
        ]);

        const earnedInProgress = (earned ?? []).filter(isBadgeInProgress);
        const availableInProgress = (available ?? []).filter(isBadgeInProgress);

        const combined = new Map<number | undefined, Badge>();
        for (const badge of earnedInProgress)
            combined.set(badge.badgeId, badge);
        for (const badge of availableInProgress)
            combined.set(badge.badgeId, badge);
        return Array.from(combined.values());
    }

    async function getAdhocChallenges(
        start: number,
        limit: number,
    ): Promise<AdhocChallenge[] | null> {
        const validStart = validateNonNegativeInteger(start, "start");
        const validLimit = validatePositiveInteger(limit, "limit");
        return host.client.connectapi<AdhocChallenge[]>(
            "/adhocchallenge-service/adHocChallenge/historical",
            { params: { start: validStart, limit: validLimit } },
        );
    }

    async function getBadgeChallenges(
        start: number,
        limit: number,
    ): Promise<BadgeChallenge[] | null> {
        const validStart = validateNonNegativeInteger(start, "start");
        const validLimit = validatePositiveInteger(limit, "limit");
        return host.client.connectapi<BadgeChallenge[]>(
            "/badgechallenge-service/badgeChallenge/completed",
            { params: { start: validStart, limit: validLimit } },
        );
    }

    async function getAvailableBadgeChallenges(
        start: number,
        limit: number,
    ): Promise<AvailableBadgeChallenge[] | null> {
        const validStart = validateNonNegativeInteger(start, "start");
        const validLimit = validatePositiveInteger(limit, "limit");
        return host.client.connectapi<AvailableBadgeChallenge[]>(
            "/badgechallenge-service/badgeChallenge/available",
            { params: { start: validStart, limit: validLimit } },
        );
    }

    async function getNonCompletedBadgeChallenges(
        start: number,
        limit: number,
    ): Promise<NonCompletedBadgeChallenge[] | null> {
        const validStart = validateNonNegativeInteger(start, "start");
        const validLimit = validatePositiveInteger(limit, "limit");
        return host.client.connectapi<NonCompletedBadgeChallenge[]>(
            "/badgechallenge-service/badgeChallenge/non-completed",
            { params: { start: validStart, limit: validLimit } },
        );
    }

    /** Requires `start` ≥ 1. Other challenge lists accept 0. */
    async function getInprogressVirtualChallenges(
        start: number,
        limit: number,
    ): Promise<InprogressVirtualChallenge[] | null> {
        const validStart = validatePositiveInteger(start, "start");
        const validLimit = validatePositiveInteger(limit, "limit");
        return host.client.connectapi<InprogressVirtualChallenge[]>(
            "/badgechallenge-service/virtualChallenge/inProgress",
            { params: { start: validStart, limit: validLimit } },
        );
    }

    return {
        listEarnedBadges: getEarnedBadges,
        listAvailableBadges: getAvailableBadges,
        getBadge: getBadgeDetail,
        listInProgressBadges: getInProgressBadges,
        listAdhocChallenges: getAdhocChallenges,
        listBadgeChallenges: getBadgeChallenges,
        listAvailableBadgeChallenges: getAvailableBadgeChallenges,
        listNonCompletedBadgeChallenges: getNonCompletedBadgeChallenges,
        listInProgressVirtualChallenges: getInprogressVirtualChallenges,
    };
}

const BADGE_IMAGES = "https://connect.garmin.com/images/badges/xxhdpi";

/** Builds Garmin image URLs from a badge UUID or ID. Rejects non-alphanumeric path values. */
function imageUrls(badge: {
    badgeId?: unknown;
    badgeUuid?: unknown;
}): BadgeImageUrls | undefined {
    const uuid = typeof badge.badgeUuid === "string" ? badge.badgeUuid : "";
    const id =
        typeof badge.badgeId === "number" && Number.isInteger(badge.badgeId)
            ? String(badge.badgeId)
            : "";
    const key = uuid || id;
    if (!/^[A-Za-z0-9]+$/.test(key)) return undefined;
    return {
        small: `${BADGE_IMAGES}/badge_${key}_sml.png`,
        large: `${BADGE_IMAGES}/badge_${key}_lrg.png`,
    };
}

/** Adds `badgeImageUrls` when Garmin provides a usable badge ID or UUID. */
function withImageUrls<T extends { badgeId?: unknown; badgeUuid?: unknown }>(
    badge: T,
): T {
    if (!badge || typeof badge !== "object") return badge;
    const urls = imageUrls(badge);
    return urls ? { ...badge, badgeImageUrls: urls } : badge;
}

function listWithImageUrls(badges: Badge[] | null): Badge[] | null {
    return Array.isArray(badges) ? badges.map(withImageUrls) : badges;
}

/** A badge is in progress below its target or while repeatable awards remain. */
function isBadgeInProgress(badge: Badge): boolean {
    const progress = badge.badgeProgressValue;
    if (!progress) return false;
    const target = badge.badgeTargetValue;
    if (progress === target) {
        if (badge.badgeLimitCount == null) return false;
        return (badge.badgeEarnedNumber ?? 0) < badge.badgeLimitCount;
    }
    return true;
}
