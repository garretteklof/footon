/**
 * `GET /trainingplan-service/trainingplan/plans`. Passes through unchecked.
 *
 * The response is an envelope, not an array. The optional `trainingPlanList` field contains plans;
 * other response fields remain open because the endpoint is undocumented.
 */
export interface TrainingPlansResult {
  /** Where the plans are; empty when the account has none. */
  trainingPlanList?: unknown[];
  [key: string]: unknown;
}

/**
 * `GET /trainingplan-service/trainingplan/phased/{plan_id}`. Passes
 * through unchecked; undocumented shape.
 */
export interface TrainingPlanDetail {
  [key: string]: unknown;
}

/**
 * `GET /trainingplan-service/trainingplan/fbt-adaptive/{plan_id}`.
 * Distinct sub-path (`fbt-adaptive`) from the phased-plan endpoint. Passes through unchecked;
 * undocumented shape.
 */
export interface AdaptiveTrainingPlanDetail {
  [key: string]: unknown;
}
