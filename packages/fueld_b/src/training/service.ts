import { addDays, localToday, validateDate, type TrainingAccount, type TrainingPlanProvider } from "./model";
import { TrainingRepository } from "./repository";
export interface Sender {
    platform: string;
    externalId: string;
}
export type TrainingUser = Sender | string;
export class TrainingPlanService {
    private pending = new Map<string, Promise<void>>();
    constructor(private readonly repository: TrainingRepository, private readonly providerFor: (account: TrainingAccount) => TrainingPlanProvider, private readonly now: () => Date = () => new Date()) { }
    private account(user: TrainingUser): TrainingAccount {
        return typeof user === "string" ? this.repository.accountForUser(user) : this.repository.accountForSender(user);
    }
    private week(a: TrainingAccount) {
        const today = localToday(this.now(), a.timezone);
        const monday = addDays(today, -((new Date(today).getUTCDay() + 6) % 7));
        return { start: monday, end: addDays(monday, 13) };
    }
    private async range(sender: TrainingUser, start: string, end: string, force = false) {
        const a = this.account(sender);
        // Resolve before reading cache; an unsupported configured provider must not
        // silently fall back to Final Surge or a previous account's cached schedule.
        const provider = this.providerFor(a);
        const weeks = this.week(a);
        const syncStart = start < weeks.start ? start : weeks.start, syncEnd = end > weeks.end ? end : weeks.end;
        const current = this.repository.lastSync(a, start, end);
        let stale = false;
        if (force || !current || this.now().getTime() - Date.parse(current) >= 30 * 60000) {
            const key = JSON.stringify([a.userId, a.provider, a.accountId, syncStart, syncEnd]);
            try {
                let pending = this.pending.get(key);
                if (!pending) {
                    pending = (async () => {
                        const rows = await provider.getWorkouts(a, syncStart, syncEnd);
                        this.repository.replaceRange(a, syncStart, syncEnd, rows, this.now().toISOString());
                    })();
                    this.pending.set(key, pending);
                }
                try {
                    await pending;
                }
                finally {
                    if (this.pending.get(key) === pending)
                        this.pending.delete(key);
                }
            }
            catch {
                // No upstream errors or response bodies reach the agent.
                stale = true;
            }
        }
        return { provider: a.provider, timezone: a.timezone, start, end, stale,
            warning: stale ? "Training provider unavailable; cached data may be incomplete or outdated" : null,
            syncedAt: this.repository.lastSync(a, start, end), workouts: this.repository.read(a, start, end) };
    }
    getWeeklyTrainingPlan(sender: TrainingUser) {
        const a = this.account(sender), { start } = this.week(a);
        return this.range(sender, start, addDays(start, 6));
    }
    getUpcomingWorkouts(sender: TrainingUser, days = 14) {
        if (!Number.isInteger(days) || days < 1 || days > 90)
            throw new Error("days must be an integer from 1 to 90");
        const a = this.account(sender), today = localToday(this.now(), a.timezone);
        return this.range(sender, today, addDays(today, days - 1));
    }
    getWorkoutForDate(sender: TrainingUser, date: string) { validateDate(date); return this.range(sender, date, date); }
    refreshTrainingPlan(sender: TrainingUser) {
        const a = this.account(sender), { start, end } = this.week(a);
        return this.range(sender, start, end, true);
    }
}
