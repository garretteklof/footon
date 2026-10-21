/**
 * One entry returned by the earned or available badge endpoints. Only fields used by this library
 * are named; other response data remains open.
 */
export interface Badge {
  badgeId?: number;
  badgeProgressValue?: number;
  badgeTargetValue?: number;
  badgeLimitCount?: number;
  badgeEarnedNumber?: number;
  /** Added by this library, not sent by Garmin — see `BadgeImageUrls`. */
  badgeImageUrls?: BadgeImageUrls;
  [key: string]: unknown;
}

/**
 * The badge's artwork. NOT part of Garmin's payload, which carries no image URL at all: this
 * library adds it, built the way Garmin Connect's own web app builds it —
 * `https://connect.garmin.com/images/badges/xxhdpi/badge_<badgeUuid ?? badgeId>_<sml|lrg>.png`.
 * `badgeUuid` is set on newer challenge badges; classic badges use `badgeId`. Absent when a badge has neither id.
 */
export interface BadgeImageUrls {
  small: string;
  large: string;
}

/**
 * One entry of a badge series, with whether the caller has earned it.
 */
export interface RelatedBadge {
  badgeId?: number;
  badgeKey?: string;
  badgeUuid?: string | null;
  badgeName?: string;
  badgeDifficultyId?: number;
  badgePoints?: number;
  badgeTypeIds?: number[];
  earnedByMe?: boolean;
  badgeCategoryId?: number;
  /** Added by this library, not sent by Garmin — see `BadgeImageUrls`. */
  badgeImageUrls?: BadgeImageUrls;
  [key: string]: unknown;
}

/**
 * `GET /badge-service/badge/detail/v3/{badgeId}` response. `badgeImageUrls` is added by this library;
 * Garmin's payload does not include descriptions or image URLs. Badge descriptions are keyed by
 * `badge_description_<badgeKey>` in Garmin's public badges translation bundle.
 */
export interface BadgeDetail extends Badge {
  badgeKey?: string;
  badgeName?: string;
  /** Set on newer challenge badges, null on the classic ones. */
  badgeUuid?: string | null;
  badgeCategoryId?: number;
  badgeDifficultyId?: number;
  badgePoints?: number;
  badgeSeriesId?: number | null;
  /** `YYYY-MM-DDTHH:MM:SS.S`, local; null when the caller hasn't earned it. */
  badgeEarnedDate?: string | null;
  earnedByMe?: boolean;
  /** The window a challenge badge can be earned in; `badgeEndDate` is null for permanent badges. */
  badgeStartDate?: string | null;
  badgeEndDate?: string | null;
  /**
   * What `badgeAssocDataId` points at: `"activityId"` (the activity that earned it, named in
   * `badgeAssocDataName`) or `"none"`. Observed: `"none"` on a challenge badge, whose
   * `badgeAssocDataId` then repeats its `badgeUuid`.
   */
  badgeAssocType?: string;
  badgeAssocDataId?: string | null;
  badgeAssocDataName?: string | null;
  /** The rest of the badge's series; `[]` for a one-off challenge badge. */
  relatedBadges?: RelatedBadge[] | null;
  /** People the caller follows who have this badge. */
  followings?: unknown[];
  followingNumber?: number;
}

/** One entry returned by `GET /adhocchallenge-service/adHocChallenge/historical`. */
export interface AdhocChallenge {
  [key: string]: unknown;
}

/** One entry returned by `GET /badgechallenge-service/badgeChallenge/completed`. */
export interface BadgeChallenge {
  [key: string]: unknown;
}

/** One entry returned by `GET /badgechallenge-service/badgeChallenge/available`. */
export interface AvailableBadgeChallenge {
  [key: string]: unknown;
}

/** One entry returned by `GET /badgechallenge-service/badgeChallenge/non-completed`. */
export interface NonCompletedBadgeChallenge {
  [key: string]: unknown;
}

/** One entry returned by `GET /badgechallenge-service/virtualChallenge/inProgress`. */
export interface InprogressVirtualChallenge {
  [key: string]: unknown;
}
