import { GarminAuthError } from "@/errors";
import type { DiTokens } from "./di";

export type Tokens = DiTokens;

export function isExpired(token: DiTokens, marginSeconds = 60, nowMs = Date.now()): boolean {
  return !Number.isFinite(token.expires_at) || token.expires_at - marginSeconds <= Math.floor(nowMs / 1000);
}

export function refreshExpired(token: DiTokens, nowMs = Date.now()): boolean {
  return token.refresh_token_expires_at !== undefined &&
    (!Number.isFinite(token.refresh_token_expires_at) || token.refresh_token_expires_at <= Math.floor(nowMs / 1000));
}

export function validateTokens(value: unknown): DiTokens | null {
  if (!value || typeof value !== "object") return null;
  const token = value as Record<string, unknown>;
  if (
    typeof token.access_token !== "string" || !token.access_token ||
    typeof token.refresh_token !== "string" || !token.refresh_token ||
    typeof token.client_id !== "string" || !token.client_id ||
    typeof token.expires_at !== "number" || !Number.isFinite(token.expires_at) ||
    (token.refresh_token_expires_at !== undefined &&
      (typeof token.refresh_token_expires_at !== "number" || !Number.isFinite(token.refresh_token_expires_at)))
  ) return null;
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    client_id: token.client_id,
    expires_at: token.expires_at,
    ...(typeof token.refresh_token_expires_at === "number" ? { refresh_token_expires_at: token.refresh_token_expires_at } : {}),
    token_type: typeof token.token_type === "string" ? token.token_type : "Bearer",
  };
}

export function authorizationHeader(token: DiTokens): string {
  if (!token.access_token) throw new GarminAuthError("No DI access token is available");
  return `${token.token_type ?? "Bearer"} ${token.access_token}`;
}
