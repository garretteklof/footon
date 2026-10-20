import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    databasePath: resolve(projectRoot, env.FUELD_B_PATH || "data/nutrition.sqlite"),
    fdcApiKey: env.FDC_API_KEY ?? "",
  };
}
