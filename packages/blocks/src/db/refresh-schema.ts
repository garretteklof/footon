import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "@footon/storage/schema";

export const trainingRefreshState = sqliteTable("training_refresh_state", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  refreshVersion: integer("refresh_version").notNull().default(0),
});
