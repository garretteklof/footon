import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "node:url";

const defaultDatabasePath = fileURLToPath(new URL("./db/foot.sqlite", import.meta.url));
export default defineConfig({
  dialect: "sqlite",
  schema: [
    "../fuel/src/db/schema.ts",
    "../blocks/src/db/schema.ts",
    "../blocks/src/db/refresh-schema.ts",
    "./src/schema.ts",
  ],
  out: "./drizzle",
  dbCredentials: {
    url: process.env.FOOTON_DB_PATH ?? defaultDatabasePath,
  },
});
