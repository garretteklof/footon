export type Workout = {
  date: string;
  name: string | null;
  description: string | null;
  status: "planned" | "completed" | "unknown";
  isRace: boolean | null;
  activities: { activityType: string | null; plannedAmount: number | null; plannedAmountUnit: string | null }[];
};

export type TrainingUser = {
  id: string;
  timezone: string;
  training?: { provider: "final-surge"; email: string; password: string };
};
