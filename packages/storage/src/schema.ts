import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id"),
  createdAt: text("created_at").notNull(),
  displayName: text("display_name"),
  timezone: text("timezone").notNull().default("UTC"),
}, table => [
  primaryKey({ columns: [table.id] }),
]);

export const identities = sqliteTable("identities", {
  platform: text("platform").notNull(),
  externalId: text("external_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, table => [
  primaryKey({ columns: [table.platform, table.externalId] }),
  index("identities_user").on(table.userId),
]);
