import { index, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "@footon/storage/schema";

export const vitalsObservations = sqliteTable("vitals_observations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  metric: text("metric").notNull(),
  value: real("value_num").notNull(),
  unit: text("unit").notNull(),
  observedAt: text("observed_at").notNull(),
  localDate: text("local_date").notNull(),
  timezone: text("timezone").notNull(),
  source: text("source").notNull(),
  sourceKey: text("source_key"),
  note: text("note"),
}, table => [
  index("vitals_observations_user_metric_date").on(table.userId, table.metric, table.localDate),
  index("vitals_observations_user_time").on(table.userId, table.observedAt),
  uniqueIndex("vitals_observations_source_key").on(table.userId, table.source, table.sourceKey)
    .where(sql`${table.sourceKey} IS NOT NULL`),
]);

export type VitalsObservationRow = typeof vitalsObservations.$inferSelect;
