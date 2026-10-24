import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { FootonDb } from "@footon/storage";
import { vitalsObservations, type VitalsObservationRow } from "./db/schema";
import {
  observationInputSchema,
  observationUpdateSchema,
  VITALS_METRICS,
  type DateRange,
  type ObservationInput,
  type ObservationUpdate,
  type VitalsMetric,
  type VitalsUnit,
} from "./schema";
import { localDateAt, normalizeTimestamp, validateDateRange } from "./time";

export type Observation = {
  id: string;
  userId: string;
  metric: VitalsMetric;
  value: number;
  unit: VitalsUnit;
  observedAt: string;
  localDate: string;
  timezone: string;
  source: string;
  sourceKey: string | null;
  note: string | null;
};

export type ObservationRange = DateRange & { metric?: VitalsMetric };
export type MetricSummary = {
  metric: VitalsMetric;
  unit: VitalsUnit;
  sampleCount: number;
  mean: number | null;
  first: number | null;
  latest: number | null;
  change: number | null;
  status: "sufficient_data" | "insufficient_data";
};
export type VitalsSummary = { startDate: string; endDate: string; metrics: Record<VitalsMetric, MetricSummary> };

function fromRow(row: VitalsObservationRow): Observation {
  const parsed = observationInputSchema.parse({
    metric: row.metric,
    value: row.value,
    unit: row.unit,
    source: row.source,
    ...(row.sourceKey === null ? {} : { sourceKey: row.sourceKey }),
    ...(row.note === null ? {} : { note: row.note }),
    observedAt: row.observedAt,
  });
  return {
    id: row.id,
    userId: row.userId,
    metric: parsed.metric,
    value: parsed.value,
    unit: parsed.unit,
    observedAt: row.observedAt,
    localDate: row.localDate,
    timezone: row.timezone,
    source: row.source,
    sourceKey: row.sourceKey,
    note: row.note,
  };
}

function getById(db: FootonDb, id: string, userId: string) {
  const row = db.select().from(vitalsObservations).where(and(
    eq(vitalsObservations.id, id),
    eq(vitalsObservations.userId, userId),
  )).get();
  return row ? fromRow(row) : undefined;
}

export function recordObservation(
  db: FootonDb,
  userId: string,
  timezone: string,
  rawInput: ObservationInput,
): Observation {
  const input = observationInputSchema.parse(rawInput);
  if (!userId.trim()) throw new Error("userId is required");
  const observedAt = normalizeTimestamp(input.observedAt);
  const localDate = localDateAt(observedAt, timezone);
  const id = crypto.randomUUID();
  const source = input.source ?? "manual";
  const sourceKey = input.sourceKey ?? null;
  const inserted = db.insert(vitalsObservations).values({
    id,
    userId,
    metric: input.metric,
    value: input.value,
    unit: input.unit,
    observedAt,
    localDate,
    timezone,
    source,
    sourceKey,
    note: input.note ?? null,
  }).onConflictDoNothing().returning().get();
  if (inserted) return fromRow(inserted);
  if (sourceKey !== null) {
    const existing = db.select().from(vitalsObservations).where(and(
      eq(vitalsObservations.userId, userId),
      eq(vitalsObservations.source, source),
      eq(vitalsObservations.sourceKey, sourceKey),
    )).get();
    if (existing) return fromRow(existing);
  }
  throw new Error("Observation could not be recorded");
}

export function getObservations(db: FootonDb, userId: string, range: ObservationRange): Observation[] {
  const { startDate, endDate } = validateDateRange(range);
  const conditions = [
    eq(vitalsObservations.userId, userId),
    gte(vitalsObservations.localDate, startDate),
    lte(vitalsObservations.localDate, endDate),
  ];
  if (range.metric) conditions.push(eq(vitalsObservations.metric, range.metric));
  return db.select().from(vitalsObservations).where(and(...conditions))
    .orderBy(asc(vitalsObservations.observedAt), asc(vitalsObservations.metric), asc(vitalsObservations.id)).all()
    .map(fromRow);
}

export function getLatestObservation(db: FootonDb, userId: string, metric: VitalsMetric): Observation | undefined {
  const row = db.select().from(vitalsObservations).where(and(
    eq(vitalsObservations.userId, userId),
    eq(vitalsObservations.metric, metric),
  )).orderBy(desc(vitalsObservations.observedAt), desc(vitalsObservations.id)).limit(1).get();
  return row ? fromRow(row) : undefined;
}

export function updateManualObservation(
  db: FootonDb,
  userId: string,
  id: string,
  rawChanges: ObservationUpdate,
): Observation {
  const changes = observationUpdateSchema.parse(rawChanges);
  const row = db.select().from(vitalsObservations).where(and(
    eq(vitalsObservations.id, id),
    eq(vitalsObservations.userId, userId),
  )).get();
  if (!row || row.source !== "manual") throw new Error("Only the owner can change a manual observation");
  const candidate = observationInputSchema.parse({
    metric: row.metric,
    value: changes.value ?? row.value,
    unit: row.unit,
    source: row.source,
    ...(row.note === null ? {} : { note: row.note }),
    ...(row.sourceKey === null ? {} : { sourceKey: row.sourceKey }),
    observedAt: changes.observedAt ?? row.observedAt,
  });
  const observedAt = normalizeTimestamp(candidate.observedAt);
  const note = changes.note === undefined ? row.note : changes.note;
  db.update(vitalsObservations).set({
    value: candidate.value,
    observedAt,
    localDate: localDateAt(observedAt, row.timezone),
    note,
  }).where(and(
    eq(vitalsObservations.id, id),
    eq(vitalsObservations.userId, userId),
    eq(vitalsObservations.source, "manual"),
  )).run();
  const updated = getById(db, id, userId);
  if (!updated) throw new Error("Observation could not be updated");
  return updated;
}

export function deleteManualObservation(db: FootonDb, userId: string, id: string): boolean {
  const deleted = db.delete(vitalsObservations).where(and(
    eq(vitalsObservations.id, id),
    eq(vitalsObservations.userId, userId),
    eq(vitalsObservations.source, "manual"),
  )).returning({ id: vitalsObservations.id }).get();
  return deleted !== undefined;
}

export function summarizeVitals(db: FootonDb, userId: string, range: DateRange): VitalsSummary {
  const normalizedRange = validateDateRange(range);
  const rows = getObservations(db, userId, normalizedRange);
  const metrics = {} as Record<VitalsMetric, MetricSummary>;
  for (const metric of VITALS_METRICS) {
    const selected = rows.filter(row => row.metric === metric);
    const values = selected.map(row => row.value);
    const sampleCount = values.length;
    const first = values.at(0) ?? null;
    const latest = values.at(-1) ?? null;
    metrics[metric] = {
      metric,
      unit: selected[0]?.unit ?? unitFor(metric),
      sampleCount,
      mean: sampleCount === 0 ? null : values.reduce((sum, value) => sum + value, 0) / sampleCount,
      first,
      latest,
      change: sampleCount < 2 ? null : (latest ?? 0) - (first ?? 0),
      status: sampleCount < 2 ? "insufficient_data" : "sufficient_data",
    };
  }
  return { ...normalizedRange, metrics };
}

function unitFor(metric: VitalsMetric): VitalsUnit {
  switch (metric) {
    case "body_weight": return "kg";
    case "resting_heart_rate": return "bpm";
    case "hrv_rmssd": return "ms";
    case "sleep_duration": return "minutes";
    case "fatigue":
    case "soreness":
    case "recovery": return "score_0_10";
  }
}
