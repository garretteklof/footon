import { migrateStorage, resolveDatabasePath } from "./client";

if (import.meta.main) {
  try {
    migrateStorage();
    console.info(`Footon database migrations applied at ${resolveDatabasePath()}`);
  } catch (error) {
    console.error("Footon database migration failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
