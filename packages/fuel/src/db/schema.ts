import { check, index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "@footon/storage/schema";

export const foodLogs = sqliteTable("food_logs", {
  id: text("id"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fdcId: integer("fdc_id").notNull(),
  foodName: text("food_name").notNull(),
  quantityG: real("quantity_g").notNull(),
  consumedAt: text("consumed_at").notNull(),
  nutrientsJson: text("nutrients_json").notNull(),
}, table => [
  primaryKey({ columns: [table.id] }),
  check("food_logs_quantity_positive", sql`${table.quantityG} > 0`),
  index("food_logs_user_day").on(table.userId, table.consumedAt),
]);

export type FoodLog = typeof foodLogs.$inferSelect;
export type NewFoodLog = typeof foodLogs.$inferInsert;
