export interface TrainingAccount {
    userId: string;
    provider: string;
    accountId: string;
    credentialsEnv?: string;
    credentialRef?: string;
    timezone: string;
}
export interface WorkoutActivity {
    activityType: string | null;
    plannedAmount: number | null;
    plannedAmountUnit: string | null;
}
export interface Workout {
    date: string;
    name: string | null;
    description: string | null;
    status: "planned" | "completed" | "unknown";
    isRace: boolean | null;
    activities: WorkoutActivity[];
}
export interface ProviderWorkout {
    /** Provider source key used only for cache identity and reconciliation. */
    sourceId: string;
    /** Internal ownership fields checked before storing provider results. */
    provider: string;
    accountId: string;
    workout: Workout;
    /** Small provider-native cache projection, separate from normalized output. */
    raw: Record<string, unknown>;
}
export interface TrainingPlanProvider {
    getWorkouts(account: TrainingAccount, start: string, end: string): Promise<ProviderWorkout[]>;
}
export function validateDate(date: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
        throw new Error("Invalid YYYY-MM-DD date");
    return date;
}
export const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
export function localToday(now: Date, timezone: string): string {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map(p => [p.type, p.value]));
    return `${p.year}-${p.month}-${p.day}`;
}
