import { eq } from "drizzle-orm";
import type { FootonDb } from "@footon/storage";
import * as z from "zod/v4";
import { athleteProfiles } from "./db/athlete-schema";
import { validateDate } from "./time";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  try { validateDate(value); return true; }
  catch { return false; }
}, "Date must be a valid YYYY-MM-DD date");

export const athleteProfileSchema = z.object({
  runningBackground: z.string().trim().max(2000).nullable().optional(),
  trainingPreferences: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  goals: z.array(z.object({
    description: z.string().trim().min(1).max(300),
    targetDate: dateSchema.optional(),
  }).strict()).max(50).default([]),
  personalRecords: z.array(z.object({
    event: z.string().trim().min(1).max(64),
    durationSeconds: z.number().finite().positive().max(86400),
    achievedOn: dateSchema.optional(),
  }).strict()).max(100).default([]),
  targetRaces: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    event: z.string().trim().min(1).max(64),
    date: dateSchema,
    goalTimeSeconds: z.number().finite().positive().max(86400).optional(),
  }).strict()).max(50).default([]),
}).strict();

export type AthleteProfileInput = z.input<typeof athleteProfileSchema>;
export type AthleteProfile = z.output<typeof athleteProfileSchema>;
export type AthleteProfileRecord = AthleteProfile & { userId: string; updatedAt: string };

export function getAthleteProfile(db: FootonDb, userId: string): AthleteProfileRecord | undefined {
  const row = db.select().from(athleteProfiles).where(eq(athleteProfiles.userId, userId)).get();
  if (!row) return undefined;
  const profile = athleteProfileSchema.parse(JSON.parse(row.profileJson));
  return { ...profile, userId: row.userId, updatedAt: row.updatedAt };
}

export function setAthleteProfile(db: FootonDb, userId: string, rawProfile: AthleteProfileInput): AthleteProfileRecord {
  if (!userId.trim()) throw new Error("userId is required");
  const profile = athleteProfileSchema.parse(rawProfile);
  const updatedAt = new Date().toISOString();
  db.insert(athleteProfiles).values({ userId, profileJson: JSON.stringify(profile), updatedAt })
    .onConflictDoUpdate({
      target: athleteProfiles.userId,
      set: { profileJson: JSON.stringify(profile), updatedAt },
    }).run();
  return { ...profile, userId, updatedAt };
}
