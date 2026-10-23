import { integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { users } from "@footon/storage/schema";

export const trainingAccounts = sqliteTable("training_accounts", {
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  accountId: text("account_id").notNull(),
  credentialRef: text("credential_ref").notNull(),
  snapshotJson: text("snapshot_json"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  syncedAt: text("synced_at"),
  refreshVersion: integer("refresh_version").notNull().default(0),
}, table => [
  primaryKey({ columns: [table.userId] }),
  unique("training_accounts_provider_account").on(table.provider, table.accountId),
]);

export type TrainingAccount = typeof trainingAccounts.$inferSelect;
