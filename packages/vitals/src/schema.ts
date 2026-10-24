import * as z from "zod/v4";

export const VITALS_METRICS = [
  "body_weight",
  "resting_heart_rate",
  "hrv_rmssd",
  "sleep_duration",
  "fatigue",
  "soreness",
  "recovery",
] as const;

export type VitalsMetric = typeof VITALS_METRICS[number];
export type VitalsUnit = "kg" | "bpm" | "ms" | "minutes" | "score_0_10";

const sourceSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/);
const sourceKeySchema = z.string().trim().min(1).max(200);
const baseInputSchema = z.object({
  value: z.number().finite(),
  observedAt: z.string().datetime({ offset: true }).optional(),
  source: sourceSchema.optional(),
  sourceKey: sourceKeySchema.optional(),
  note: z.string().trim().max(1000).optional(),
}).strict();

export const observationInputSchema = z.discriminatedUnion("metric", [
  baseInputSchema.extend({ metric: z.literal("body_weight"), value: z.number().finite().positive().max(500), unit: z.literal("kg") }),
  baseInputSchema.extend({ metric: z.literal("resting_heart_rate"), value: z.number().finite().positive().max(250), unit: z.literal("bpm") }),
  baseInputSchema.extend({ metric: z.literal("hrv_rmssd"), value: z.number().finite().positive().max(500), unit: z.literal("ms") }),
  baseInputSchema.extend({ metric: z.literal("sleep_duration"), value: z.number().finite().min(0).max(1440), unit: z.literal("minutes") }),
  baseInputSchema.extend({ metric: z.literal("fatigue"), value: z.number().finite().min(0).max(10), unit: z.literal("score_0_10") }),
  baseInputSchema.extend({ metric: z.literal("soreness"), value: z.number().finite().min(0).max(10), unit: z.literal("score_0_10") }),
  baseInputSchema.extend({ metric: z.literal("recovery"), value: z.number().finite().min(0).max(10), unit: z.literal("score_0_10") }),
]).superRefine((input, context) => {
  if (input.sourceKey && (!input.source || input.source === "manual")) {
    context.addIssue({ code: "custom", message: "sourceKey requires a non-manual source", path: ["sourceKey"] });
  }
});

export type ObservationInput = z.infer<typeof observationInputSchema>;

export const observationUpdateSchema = z.object({
  value: z.number().finite().optional(),
  observedAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(1000).nullable().optional(),
}).strict().refine(
  changes => changes.value !== undefined || changes.observedAt !== undefined || changes.note !== undefined,
  { message: "Provide at least one field to update" },
);

export type ObservationUpdate = z.infer<typeof observationUpdateSchema>;
export type DateRange = { startDate: string; endDate: string };
