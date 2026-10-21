import { pathSegment } from "@/util/validate";
import type { ApiClient } from "../types/api";
import type {
    AdaptiveTrainingPlanDetail,
    TrainingPlanDetail,
    TrainingPlansResult,
} from "../types/trainingPlans";

interface TrainingPlansHost {
    readonly client: ApiClient;
}

export function createTrainingPlansApi(host: TrainingPlansHost) {

    async function getTrainingPlans(): Promise<TrainingPlansResult | null> {
        return host.client.connectapi<TrainingPlansResult>(
            "/trainingplan-service/trainingplan/plans",
        );
    }

    async function getTrainingPlanById(
        planId: number | string,
    ): Promise<TrainingPlanDetail | null> {
        return host.client.connectapi<TrainingPlanDetail>(
            `/trainingplan-service/trainingplan/phased/${pathSegment(planId)}`,
        );
    }

    /** Adaptive plans use `fbt-adaptive`. Standard plans use `phased`. */
    async function getAdaptiveTrainingPlanById(
        planId: number | string,
    ): Promise<AdaptiveTrainingPlanDetail | null> {
        return host.client.connectapi<AdaptiveTrainingPlanDetail>(
            `/trainingplan-service/trainingplan/fbt-adaptive/${pathSegment(planId)}`,
        );
    }

    /** Quit Plan repeats `trainingplan` in the path. It removes scheduled workouts but keeps completed activities. */
    async function deleteTrainingPlan(
        planId: number | string,
    ): Promise<unknown> {
        return host.client.connectapi(
            `/trainingplan-service/trainingplan/trainingplan/${pathSegment(planId)}`,
            {
                method: "DELETE",
            },
        );
    }

    return {
        listPlans: getTrainingPlans,
        getPlan: getTrainingPlanById,
        getAdaptivePlan: getAdaptiveTrainingPlanById,
        deletePlan: deleteTrainingPlan,
    };
}
