export interface Gear {
  [key: string]: unknown;
}

export interface GearStats {
  [key: string]: unknown;
}

export interface GearDefaults {
  [key: string]: unknown;
}

/** Usage values accepted by `createGear`; duration is represented as `DURATION`. */
export type GearUsageType =
  | "NONE"
  | "DISTANCE"
  | "DURATION"
  | "DATE"
  | Lowercase<"NONE" | "DISTANCE" | "DURATION" | "DATE">;
