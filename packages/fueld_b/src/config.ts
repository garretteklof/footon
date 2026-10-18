import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export interface Config {
  databasePath: string;
  fdcApiKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const configuredDatabasePath = env.FUELD_B_PATH;
  return {
    databasePath: configuredDatabasePath
      ? isAbsolute(configuredDatabasePath) ? configuredDatabasePath : resolve(projectRoot, configuredDatabasePath)
      : join(projectRoot, "data", "nutrition.sqlite"),
    fdcApiKey: env.FDC_API_KEY ?? "",
  };
}
