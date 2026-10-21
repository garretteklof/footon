import {
    pathSegment,
    validateNonNegativeInteger,
    validatePositiveInteger,
} from "@/util/validate";
import {
    GarminAuthError,
    GarminConnectPlusRequiredError,
    GarminError,
} from "@/errors";
import type { ApiClient } from "../types/api";
import type { ConnectPlusMethod } from "../types/nutrition";

import { formatDate } from "@/util/date";
import type {
    CustomFoodInput,
    CustomFoodList,
    Food,
    FoodLogInput,
    FoodSearchResult,
    MealName,
    NutritionFoodLogRange,
    QuickAddInput,
    NutritionDailyFoodLog,
    NutritionDailyMeals,
    NutritionDailySettings,
} from "../types/nutrition";

interface NutritionHost {
    readonly client: ApiClient;
    hasConnectPlus(): Promise<boolean>;
}

export function createNutritionApi(host: NutritionHost) {
    /** Maps HTTP 403 to a Connect+ error only when the profile lacks Connect+. */
    async function connectPlusCall<T>(
        method: ConnectPlusMethod,
        call: () => Promise<T>,
    ): Promise<T> {
        try {
            return await call();
        } catch (error) {
            if (
                error instanceof GarminAuthError &&
                /\(403\)$/.test(error.message)
            ) {
                const subscribed = await host.hasConnectPlus().catch(() => true);
                if (!subscribed)
                    throw new GarminConnectPlusRequiredError(method, {
                        cause: error,
                    });
            }
            throw error;
        }
    }

    async function getNutritionDailyFoodLog(
        cdate: string | Date,
    ): Promise<NutritionDailyFoodLog | null> {
        return host.client.connectapi<NutritionDailyFoodLog>(
            `/nutrition-service/food/logs/${pathSegment(formatDate(cdate))}`,
        );
    }

    async function getNutritionDailyMeals(
        cdate: string | Date,
    ): Promise<NutritionDailyMeals | null> {
        return host.client.connectapi<NutritionDailyMeals>(
            `/nutrition-service/meals/${pathSegment(formatDate(cdate))}`,
        );
    }

    async function getNutritionDailySettings(
        cdate: string | Date,
    ): Promise<NutritionDailySettings | null> {
        return host.client.connectapi<NutritionDailySettings>(
            `/nutrition-service/settings/${pathSegment(formatDate(cdate))}`,
        );
    }

    /**
     * With an explicit time, uses the named meal, matching meal, or `SNACKS`.
     * Without a time, uses the named meal or `LUNCH` and selects an available time.
     * Garmin rejects `SNACKS` times that overlap another meal.
     */
    async function resolveMeal(
        method: ConnectPlusMethod,
        date: string,
        time: string | undefined,
        meal?: MealName,
    ): Promise<{ mealId: number; time: string }> {
        if (meal !== undefined && !MEAL_NAMES.has(meal)) {
            throw new GarminError(
                `meal must be BREAKFAST, LUNCH, DINNER or SNACKS; got "${String(meal)}"`,
            );
        }
        const day = await host.client.connectapi<MealDay>(
            `/nutrition-service/meals/${pathSegment(date)}`,
        );
        const meals = day?.meals ?? [];
        if (meals.length === 0) {
            // Garmin returns no meal settings when the account lacks Connect+.
            if (!(await host.hasConnectPlus().catch(() => true)))
                throw new GarminConnectPlusRequiredError(method);
            throw new GarminError(
                `No meals are set up for ${date}. Garmin creates them during the nutrition setup in the ` +
                    "Garmin Connect app; until then every food log is rejected.",
            );
        }
        const pad = (t: string) => (t.length === 5 ? `${t}:00` : t);
        const within = (
            m: MealDay["meals"] extends (infer M)[] | undefined ? M : never,
            t: string,
        ) =>
            Boolean(
                m.startTime &&
                m.endTime &&
                pad(m.startTime) <= t &&
                t <= pad(m.endTime),
            );

        if (time !== undefined) {
            const chosen =
                meal !== undefined
                    ? meals.find((m) => m.mealName === meal)
                    : (meals.find(
                          (m) => m.mealName !== "SNACKS" && within(m, time),
                      ) ?? meals.find((m) => m.mealName === "SNACKS"));
            if (!chosen)
                throw new GarminError(`No ${meal ?? "matching"} meal on ${date}`);
            return { mealId: chosen.mealId, time };
        }

        const chosen =
            meals.find((m) => m.mealName === (meal ?? "LUNCH")) ?? meals[0]!;
        const others = meals.filter((m) => m !== chosen);
        const fits = (t: string) =>
            !others.some(
                (m) =>
                    (chosen.mealName === "SNACKS" || m.mealName !== "SNACKS") &&
                    within(m, t),
            );
        const ownStart = chosen.startTime ? [pad(chosen.startTime)] : [];
        const gaps = others
            .filter((m) => m.endTime)
            .map((m) => addMinute(pad(m.endTime!)))
            .sort();
        const candidates =
            chosen.mealName === "SNACKS"
                ? [...gaps, ...ownStart]
                : [...ownStart, ...gaps];
        const picked = candidates.find(
            (t) =>
                (chosen.startTime && chosen.endTime ? within(chosen, t) : true) &&
                fits(t),
        );
        if (!picked)
            throw new GarminError(
                `Could not find a time for ${chosen.mealName} on ${date}; pass time explicitly`,
            );
        return { mealId: chosen.mealId, time: picked };
    }

    /** Food catalogue search requires Connect+. */
    async function searchFoods(
        query: string,
        start = 0,
        limit = 20,
    ): Promise<FoodSearchResult | null> {
        if (!query.trim())
            throw new GarminError("searchFoods needs a non-empty query");
        validateNonNegativeInteger(start, "start");
        validatePositiveInteger(limit, "limit");
        return connectPlusCall("searchFoods", () =>
            host.client.connectapi<FoodSearchResult>(
                "/nutrition-service/food/search",
                {
                    params: { searchExpression: query, start, limit },
                },
            ),
        );
    }

    /** Returns daily food logs without requiring Connect+. */
    async function getNutritionFoodLogRange(
        startdate: string | Date,
        enddate: string | Date,
    ): Promise<NutritionFoodLogRange | null> {
        const startDate = formatDate(startdate);
        const endDate = formatDate(enddate);
        if (startDate > endDate)
            throw new GarminError(
                "getNutritionFoodLogRange: start date must not be after end date",
            );
        return host.client.connectapi<NutritionFoodLogRange>(
            "/nutrition-service/food/logs/range",
            {
                params: { startDate, endDate },
            },
        );
    }

    /**
     * Garmin caps `limit` at 20. GET by ID returns HTTP 405. Search by name to find a food.
     */
    async function getCustomFoods(
        search = "",
        start = 0,
        limit = 20,
    ): Promise<CustomFoodList | null> {
        validateNonNegativeInteger(start, "start");
        validatePositiveInteger(limit, "limit");
        if (limit > 20)
            throw new GarminError("limit must be at most 20; Garmin rejects more");
        return connectPlusCall("getCustomFoods", () =>
            host.client.connectapi<CustomFoodList>(
                "/nutrition-service/customFood",
                {
                    params: {
                        searchExpression: search,
                        start,
                        limit,
                        includeContent: "true",
                    },
                },
            ),
        );
    }

    async function getCustomFoodServingUnits(): Promise<{ servingUnits: { name: string }[] } | null> {
        return connectPlusCall("getCustomFoodServingUnits", () =>
            host.client.connectapi<{ servingUnits: { name: string }[] }>(
                "/nutrition-service/metadata/customFoodServingUnits",
            ),
        );
    }

    /**
     * Uses PUT. The response includes `foodId` and `servingId` for `logFood`.
     */
    async function createCustomFood(
        input: CustomFoodInput,
    ): Promise<Food | null> {
        const json = customFoodBody(input);
        return connectPlusCall("createCustomFood", () =>
            host.client.connectapi<Food>("/nutrition-service/customFood", {
                method: "PUT",
                json,
            }),
        );
    }

    /**
     * PUT replaces the full definition. Omitted nutrients are removed.
     */
    async function updateCustomFood(
        foodId: string,
        servingId: string,
        input: CustomFoodInput,
    ): Promise<Food | null> {
        if (!foodId || !servingId)
            throw new GarminError(
                "updateCustomFood needs both foodId and servingId",
            );
        const json = customFoodBody(input, { foodId, servingId });
        return connectPlusCall("updateCustomFood", () =>
            host.client.connectapi<Food>("/nutrition-service/customFood", {
                method: "PUT",
                json,
            }),
        );
    }

    /** Custom-food deletion cannot be undone. */
    async function deleteCustomFood(
        foodId: string,
    ): Promise<unknown> {
        return connectPlusCall("deleteCustomFood", () =>
            host.client.connectapi(
                `/nutrition-service/customFood/${pathSegment(foodId)}`,
                { method: "DELETE" },
            ),
        );
    }

    /**
     * Use `source` from catalogue-food metadata. Custom foods default to `GARMIN`.
     * Fractional servings are supported.
     */
    async function logFood(
        input: FoodLogInput,
    ): Promise<NutritionDailyFoodLog | null> {
        const date = formatDate(input.date);
        const servings = input.servings ?? 1;
        if (!Number.isFinite(servings) || servings <= 0) {
            throw new GarminError(
                `servings must be a positive number; got ${String(servings)}`,
            );
        }
        if (!input.foodId || !input.servingId)
            throw new GarminError("logFood needs both foodId and servingId");
        const { mealId, time } = await resolveMeal(
            "logFood",
            date,
            input.time === undefined ? undefined : clockTime(input.time),
            input.meal,
        );
        return connectPlusCall("logFood", () =>
            host.client.connectapi<NutritionDailyFoodLog>(
                "/nutrition-service/food/logs",
                {
                    method: "PUT",
                    json: {
                        mealDate: date,
                        foodLogItems: [
                            {
                                logTimestamp: logTimestamp(),
                                logSource: "GCW",
                                logCategory: "REGULAR_LOG",
                                mealTime: time,
                                action: "ADD",
                                mealId,
                                foodId: input.foodId,
                                servingId: input.servingId,
                                source: input.source ?? "GARMIN",
                                regionCode: input.regionCode ?? "US",
                                languageCode: input.languageCode ?? "en",
                                servingQty: servings,
                            },
                        ],
                    },
                },
            ),
        );
    }

    /** Adds an entry by name and macros without a catalogue food. */
    async function quickAddFood(
        input: QuickAddInput,
    ): Promise<NutritionDailyFoodLog | null> {
        if (!input.name.trim())
            throw new GarminError("quickAddFood needs a non-empty name");
        const date = formatDate(input.date);
        const body = {
            calories: num(input.calories, "calories"),
            carbs: num(input.carbs, "carbs"),
            protein: num(input.protein, "protein"),
            fat: num(input.fat, "fat"),
        };
        const { mealId, time } = await resolveMeal(
            "quickAddFood",
            date,
            input.time === undefined ? undefined : clockTime(input.time),
            input.meal,
        );
        return connectPlusCall("quickAddFood", () =>
            host.client.connectapi<NutritionDailyFoodLog>(
                "/nutrition-service/food/logs/quickAdd",
                {
                    method: "PUT",
                    json: {
                        mealDate: date,
                        quickAddItems: [
                            {
                                name: input.name,
                                logId: null,
                                logTimestamp: logTimestamp(),
                                logSource: "GCW",
                                logCategory: "QUICK_ADD",
                                mealTime: time,
                                mealId,
                                action: "ADD",
                                ...body,
                            },
                        ],
                    },
                },
            ),
        );
    }

    /**
     * Sends `logIds` in the DELETE body. Works for regular and quick-add entries.
     * This action cannot be undone.
     */
    async function deleteFoodLogs(
        date: string | Date,
        logIds: string[],
    ): Promise<unknown> {
        if (
            !Array.isArray(logIds) ||
            logIds.length === 0 ||
            logIds.some((id) => typeof id !== "string" || !id)
        ) {
            throw new GarminError("deleteFoodLogs needs at least one logId");
        }
        const path = `/nutrition-service/food/logs/${pathSegment(formatDate(date))}`;
        return connectPlusCall("deleteFoodLogs", () =>
            host.client.connectapi(path, { method: "DELETE", json: { logIds } }),
        );
    }

    return {
        dailyLog: getNutritionDailyFoodLog,
        dailyMeals: getNutritionDailyMeals,
        dailySettings: getNutritionDailySettings,
        listFoodLogs: getNutritionFoodLogRange,
        searchFoods,
        listCustomFoods: getCustomFoods,
        listServingUnits: getCustomFoodServingUnits,
        createCustomFood,
        updateCustomFood,
        deleteCustomFood,
        logFood,
        quickAdd: quickAddFood,
        deleteFoodLogs: deleteFoodLogs,
    };
}

// Food logging and custom foods require Connect+. Food logs also require an account meal ID.

const MEAL_NAMES: ReadonlySet<string> = new Set<MealName>([
    "BREAKFAST",
    "LUNCH",
    "DINNER",
    "SNACKS",
]);

function clockTime(value: string): string {
    const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
    if (!m)
        throw new GarminError(
            `time must be "HH:MM" or "HH:MM:SS" (24-hour); got "${value}"`,
        );
    return `${m[1]!}:${m[2]!}:${m[3] ?? "00"}`;
}

/** Formats Garmin log timestamps in UTC with `.000` milliseconds. */
function logTimestamp(): string {
    return `${new Date().toISOString().slice(0, 19)}.000Z`;
}

/** Converts a number to Garmin's decimal string format without adding trailing zeros. */
function num(value: number, name: string): string {
    if (!Number.isFinite(value) || value < 0) {
        throw new GarminError(
            `${name} must be a non-negative number; got ${String(value)}`,
        );
    }
    return String(value);
}

interface MealDay {
    meals?: {
        mealId: number;
        mealName: string;
        startTime?: string;
        endTime?: string;
    }[];
}

function addMinute(t: string): string {
    const [h, m] = t.split(":").map(Number) as [number, number];
    const total = Math.min(h * 60 + m + 1, 23 * 60 + 59);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
}

function customFoodBody(
    input: CustomFoodInput,
    ids?: { foodId: string; servingId: string },
) {
    if (!input.name.trim())
        throw new GarminError("A custom food needs a non-empty name");
    const serving: Record<string, string> = {
        ...(ids && { servingId: ids.servingId }),
        servingUnit: input.servingUnit ?? "G",
        numberOfUnits: num(input.servingSize ?? 100, "servingSize"),
        calories: num(input.calories, "calories"),
    };
    const optional: [keyof CustomFoodInput, string][] = [
        ["carbs", "carbs"],
        ["protein", "protein"],
        ["fat", "fat"],
        ["fiber", "fiber"],
        ["sugar", "sugar"],
        ["saturatedFat", "saturatedFat"],
        ["transFat", "transFat"],
        ["sodium", "sodium"],
        ["cholesterol", "cholesterol"],
        ["potassium", "potassium"],
        ["calcium", "calcium"],
        ["iron", "iron"],
        ["vitaminD", "vitaminD"],
    ];
    for (const [key, field] of optional) {
        const value = input[key];
        if (typeof value === "number") serving[field] = num(value, key);
    }
    return {
        foodMetaData: {
            ...(ids && { foodId: ids.foodId }),
            foodName: input.name,
            foodType: "GENERIC",
            source: "GARMIN",
            regionCode: "US",
            languageCode: "en",
            ...(input.brand !== undefined && { brandName: input.brand }),
        },
        nutritionContents: [serving],
    };
}
