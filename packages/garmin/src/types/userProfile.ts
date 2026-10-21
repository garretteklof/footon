/**
 * A user-profile settings response. Kept opaque because the endpoint has no documented schema.
 */
export interface UserprofileSettings {
  [key: string]: unknown;
}

export interface SocialProfile {
  displayName: string;
  userName: string;
  fullName: string;
  profileId: number;
  [key: string]: unknown;
}

export interface UserSettings {
  id?: number;
  userData?: { measurementSystem?: string; [key: string]: unknown };
  [key: string]: unknown;
}
