import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "@footon/storage/schema";

export const athleteProfiles = sqliteTable("athlete_profiles", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  profileJson: text("profile_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const completedActivities = sqliteTable("completed_activities", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  activityType: text("activity_type").notNull(),
  startedAt: text("started_at").notNull(),
  localDate: text("local_date").notNull(),
  timezone: text("timezone").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  distanceMeters: real("distance_meters"),
  elevationGainMeters: real("elevation_gain_meters"),
  name: text("name"),
  source: text("source").notNull(),
  sourceKey: text("source_key"),
  note: text("note"),
}, table => [
  index("completed_activities_user_date").on(table.userId, table.localDate, table.activityType),
  uniqueIndex("completed_activities_source_key").on(table.userId, table.source, table.sourceKey)
    .where(sql`${table.sourceKey} IS NOT NULL`),
]);
