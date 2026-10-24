import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { FootonDb } from "@footon/storage";
import * as z from "zod/v4";
import { completedActivities } from "./db/athlete-schema";
import { localDateAt, validateDate } from "./time";

export const ACTIVITY_TYPES = ["run", "walk", "bike", "swim", "strength", "other"] as const;
const sourceSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/);
const activityBaseSchema = z.object({
  startedAt: z.string().datetime({ offset: true }),
  durationSeconds: z.number().int().positive().max(86400),
  distanceMeters: z.number().finite().min(0).max(1000000).optional(),
  elevationGainMeters: z.number().finite().min(0).max(100000).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  source: sourceSchema.optional(),
  sourceKey: z.string().trim().min(1).max(200).optional(),
  note: z.string().trim().max(1000).optional(),
}).strict();

export const completedActivityInputSchema = z.object({
  ...activityBaseSchema.shape,
  activityType: z.enum(ACTIVITY_TYPES),
}).strict().superRefine((input, context) => {
  if (input.sourceKey && (!input.source || input.source === "manual")) {
    context.addIssue({ code: "custom", message: "sourceKey requires a non-manual source", path: ["sourceKey"] });
  }
});

export type CompletedActivityInput = z.infer<typeof completedActivityInputSchema>;
export type CompletedActivityRange = { startDate: string; endDate: string; activityType?: typeof ACTIVITY_TYPES[number] };
export type CompletedActivity = {
  id: string;
  userId: string;
  activityType: typeof ACTIVITY_TYPES[number];
  startedAt: string;
  localDate: string;
  timezone: string;
  durationSeconds: number;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  name: string | null;
  source: string;
  sourceKey: string | null;
  note: string | null;
};

function fromRow(row: typeof completedActivities.$inferSelect): CompletedActivity {
  const parsed = completedActivityInputSchema.parse({
    activityType: row.activityType,
    startedAt: row.startedAt,
    durationSeconds: row.durationSeconds,
    ...(row.distanceMeters === null ? {} : { distanceMeters: row.distanceMeters }),
    ...(row.elevationGainMeters === null ? {} : { elevationGainMeters: row.elevationGainMeters }),
    ...(row.name === null ? {} : { name: row.name }),
    source: row.source,
    ...(row.sourceKey === null ? {} : { sourceKey: row.sourceKey }),
    ...(row.note === null ? {} : { note: row.note }),
  });
  return {
    id: row.id,
    userId: row.userId,
    activityType: parsed.activityType,
    startedAt: row.startedAt,
    localDate: row.localDate,
    timezone: row.timezone,
    durationSeconds: row.durationSeconds,
    distanceMeters: row.distanceMeters,
    elevationGainMeters: row.elevationGainMeters,
    name: row.name,
    source: row.source,
    sourceKey: row.sourceKey,
    note: row.note,
  };
}

export function recordCompletedActivity(
  db: FootonDb,
  userId: string,
  timezone: string,
  rawInput: CompletedActivityInput,
): CompletedActivity {
  if (!userId.trim()) throw new Error("userId is required");
  const input = completedActivityInputSchema.parse(rawInput);
  const startedAt = new Date(input.startedAt).toISOString();
  const localDate = localDateAt(Date.parse(startedAt), timezone);
  const id = crypto.randomUUID();
  const source = input.source ?? "manual";
  const sourceKey = input.sourceKey ?? null;
  const inserted = db.insert(completedActivities).values({
    id,
    userId,
    activityType: input.activityType,
    startedAt,
    localDate,
    timezone,
    durationSeconds: input.durationSeconds,
    distanceMeters: input.distanceMeters ?? null,
    elevationGainMeters: input.elevationGainMeters ?? null,
    name: input.name ?? null,
    source,
    sourceKey,
    note: input.note ?? null,
  }).onConflictDoNothing().returning().get();
  if (inserted) return fromRow(inserted);
  if (sourceKey !== null) {
    const existing = db.select().from(completedActivities).where(and(
      eq(completedActivities.userId, userId),
      eq(completedActivities.source, source),
      eq(completedActivities.sourceKey, sourceKey),
    )).get();
    if (existing) return fromRow(existing);
  }
  throw new Error("Activity could not be recorded");
}

export function getCompletedActivities(db: FootonDb, userId: string, range: CompletedActivityRange): CompletedActivity[] {
  const startDate = validateDate(range.startDate);
  const endDate = validateDate(range.endDate);
  if (startDate > endDate) throw new Error("startDate must not be after endDate");
  const conditions = [
    eq(completedActivities.userId, userId),
    gte(completedActivities.localDate, startDate),
    lte(completedActivities.localDate, endDate),
  ];
  if (range.activityType) conditions.push(eq(completedActivities.activityType, range.activityType));
  return db.select().from(completedActivities).where(and(...conditions))
    .orderBy(asc(completedActivities.startedAt), asc(completedActivities.activityType), asc(completedActivities.id)).all()
    .map(fromRow);
}
