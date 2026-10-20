import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidTimeZone } from "./time";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export type ConfiguredUser = {
  id: "user-1" | "user-2";
  name: string;
  phone: string;
  timezone: string;
  finalSurge: { email: string; password: string };
};

export function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, "").replace(/^00/, "+");
  const e164 = compact.startsWith("+") ? compact : /^\d{10}$/.test(compact) ? `+1${compact}` : /^1\d{10}$/.test(compact) ? `+${compact}` : "";
  if (!/^\+[1-9]\d{6,14}$/.test(e164)) throw new Error("Phone numbers must be E.164, or 10/11-digit US numbers");
  return e164;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
}

function configuredUser(env: NodeJS.ProcessEnv, slot: "1" | "2"): ConfiguredUser {
  const timezone = required(env, `USER_${slot}_TIMEZONE`).trim();
  if (!isValidTimeZone(timezone)) throw new Error(`USER_${slot}_TIMEZONE must be a valid IANA timezone`);
  return {
    id: slot === "1" ? "user-1" : "user-2",
    name: required(env, `USER_${slot}_NAME`).trim(),
    phone: normalizePhone(required(env, `USER_${slot}_IMESSAGE_PHONE`)),
    timezone,
    finalSurge: {
      email: required(env, `USER_${slot}_FINAL_SURGE_EMAIL`).trim(),
      password: required(env, `USER_${slot}_FINAL_SURGE_PASSWORD`),
    },
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const users = [configuredUser(env, "1"), configuredUser(env, "2")];
  if (users[0].phone === users[1].phone) throw new Error("Configured iMessage phone numbers must be unique");
  return {
    databasePath: resolve(projectRoot, env.FUELD_B_PATH || "data/nutrition.sqlite"),
    fdcApiKey: env.FDC_API_KEY ?? "",
    users,
  };
}
