import { chmodSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";
import { normalizePhone } from "./utils/phone";
import { isValidTimeZone } from "./utils/time";

const configPath = fileURLToPath(new URL("../../fueld_b/config.local.json", import.meta.url));
const trainingSchema = z.object({
  provider: z.literal("final-surge"),
  email: z.string().trim().min(1),
  password: z.string().min(1),
}).strict();
const userSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().min(1),
  timezone: z.string().trim().min(1),
  training: trainingSchema.optional(),
}).strict();

export type ConfiguredUser = z.infer<typeof userSchema> & { id: string; phone: string };

const configSchema = z.object({
  fdcApiKey: z.string().default(""),
  users: z.record(
    z.string().regex(/^[a-z][a-z0-9_-]*$/),
    userSchema,
  ).refine(users => Object.keys(users).length === 2, "Configure exactly two users"),
}).strict();

export function parseConfig(value: unknown) {
  const input = configSchema.parse(value);
  const users = Object.entries(input.users).map(([id, user]): ConfiguredUser => {
    if (!isValidTimeZone(user.timezone)) {
      throw new Error(`User ${id} must have a valid IANA timezone`);
    }
    return { ...user, id, phone: normalizePhone(user.phone) };
  });

  if (new Set(users.map(user => user.phone)).size !== users.length) {
    throw new Error("Configured phone numbers must be unique");
  }
  return { fdcApiKey: input.fdcApiKey, users };
}

export function loadConfig() {
  let contents: string;
  try {
    chmodSync(configPath, 0o600);
    contents = readFileSync(configPath, "utf8");
  } catch {
    throw new Error("Create packages/fueld_b/config.local.json");
  }

  try {
    return parseConfig(JSON.parse(contents));
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error("Invalid Footon MCP configuration; check config.local.json fields and values");
    }
    throw error;
  }
}
