import { GarminAuthError } from "@/errors";
import { Fetcher } from "../http/fetcher";

export const DI_TOKEN_URL = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
export const DI_CLIENT_ID = "GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2";
export const DI_SERVICE_TICKET_GRANT = "https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket";
export const SSO_CLIENT_ID = "GCM_IOS_DARK";
export const SSO_SERVICE_URL = "https://mobile.integration.garmin.com/gcm/ios";
const diTokenUrl = (domain: string) => `https://diauth.${domain}/di-oauth2-service/oauth/token`;

const SSO_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const SSO_HEADERS = { "User-Agent": SSO_USER_AGENT, Accept: "application/json, text/javascript, */*; q=0.01", "Accept-Language": "en-US,en;q=0.9" };

export interface DiTokens {
  access_token: string;
  refresh_token: string;
  client_id: string;
  expires_at: number;
  refresh_token_expires_at?: number;
  token_type?: string;
}
export interface DiContext { fetcher: Fetcher; domain: string }
export interface MfaChallenge {
  domain: string;
  method: string;
  loginParams: { clientId: string; locale: string; service: string };
}
export type LoginResult =
  | { status: "success"; tokens: DiTokens }
  | { status: "mfa_required"; challenge: MfaChallenge };

interface SsoResponse {
  responseStatus?: { type?: string; message?: string };
  serviceTicketId?: string;
  customerMfaInfo?: { mfaLastMethodUsed?: string };
}
interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  refresh_token_expires_in?: unknown;
}

function ssoUrl(domain: string, path: string): string { return `https://sso.${domain}${path}`; }
async function parseJson<T>(response: Response, label: string): Promise<T> {
  try { return await response.json() as T; }
  catch (cause) { throw new GarminAuthError(`${label} returned an unexpected non-JSON response`, { cause }); }
}
function requireTicket(body: SsoResponse, stage: string): string {
  const type = body.responseStatus?.type ?? "UNKNOWN";
  if (type !== "SUCCESSFUL") {
    const message = body.responseStatus?.message;
    throw new GarminAuthError(`${stage} failed: ${type}${message ? ` (${message})` : ""}`);
  }
  if (!body.serviceTicketId) throw new GarminAuthError(`${stage} succeeded without a service ticket`);
  return body.serviceTicketId;
}
function jwtExpiry(token: string): number | undefined {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return undefined;
    const payload = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : undefined;
  } catch { return undefined; }
}
function expiry(value: unknown, token: string): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(Date.now() / 1000) + value;
  return jwtExpiry(token);
}
function parseTokens(body: TokenResponse, clientId: string, oldRefresh?: string): DiTokens {
  if (typeof body.access_token !== "string" || !body.access_token) throw new GarminAuthError("DI token response is missing access_token");
  const refresh = typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : oldRefresh;
  if (!refresh) throw new GarminAuthError("DI token response is missing refresh_token");
  const expiresAt = expiry(body.expires_in, body.access_token);
  if (!expiresAt) throw new GarminAuthError("DI token response is missing access-token expiry");
  const refreshExpiresAt = expiry(body.refresh_token_expires_in, refresh);
  return {
    access_token: body.access_token,
    refresh_token: refresh,
    client_id: clientId,
    expires_at: expiresAt,
    ...(refreshExpiresAt === undefined ? {} : { refresh_token_expires_at: refreshExpiresAt }),
    token_type: typeof body.token_type === "string" ? body.token_type : "Bearer",
  };
}

async function exchangeTicket(ticket: string, context: DiContext): Promise<DiTokens> {
  const form = new URLSearchParams({
    client_id: DI_CLIENT_ID,
    service_ticket: ticket,
    grant_type: DI_SERVICE_TICKET_GRANT,
    service_url: SSO_SERVICE_URL,
  });
  const response = await context.fetcher.request(diTokenUrl(context.domain), {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${DI_CLIENT_ID}:`)}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: form.toString(),
  });
  return parseTokens(await parseJson<TokenResponse>(response, "DI token exchange"), DI_CLIENT_ID);
}

export async function login(email: string, password: string, context: DiContext): Promise<LoginResult> {
  const params = { clientId: SSO_CLIENT_ID, locale: "en-US", service: SSO_SERVICE_URL };
  await context.fetcher.request(ssoUrl(context.domain, "/mobile/sso/en/sign-in"), {
    params: { clientId: SSO_CLIENT_ID },
    headers: { ...SSO_HEADERS, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
  });
  const response = await context.fetcher.request(ssoUrl(context.domain, "/mobile/api/login"), {
    method: "POST",
    params,
    headers: SSO_HEADERS,
    json: { username: email, password, rememberMe: false, captchaToken: "" },
  });
  const body = await parseJson<SsoResponse>(response, "Garmin SSO login");
  if (body.responseStatus?.type === "MFA_REQUIRED") {
    return {
      status: "mfa_required",
      challenge: { domain: context.domain, method: body.customerMfaInfo?.mfaLastMethodUsed ?? "email", loginParams: params },
    };
  }
  return { status: "success", tokens: await exchangeTicket(requireTicket(body, "Garmin SSO login"), context) };
}

export async function resumeLogin(challenge: MfaChallenge, code: string, context: DiContext): Promise<DiTokens> {
  if (challenge.domain !== context.domain) throw new GarminAuthError("MFA challenge domain does not match this client");
  const response = await context.fetcher.request(ssoUrl(context.domain, "/mobile/api/mfa/verifyCode"), {
    method: "POST",
    params: challenge.loginParams,
    headers: SSO_HEADERS,
    json: { mfaMethod: challenge.method, mfaVerificationCode: code, rememberMyBrowser: false, reconsentList: [], mfaSetup: false },
  });
  const ticket = requireTicket(await parseJson<SsoResponse>(response, "Garmin MFA verification"), "Garmin MFA verification");
  return exchangeTicket(ticket, context);
}

export async function refreshToken(tokens: DiTokens, context: DiContext): Promise<DiTokens> {
  if (tokens.refresh_token_expires_at !== undefined && tokens.refresh_token_expires_at <= Date.now() / 1000) {
    throw new GarminAuthError("Garmin refresh token has expired; log in again");
  }
  const form = new URLSearchParams({ grant_type: "refresh_token", client_id: tokens.client_id, refresh_token: tokens.refresh_token });
  const response = await context.fetcher.request(diTokenUrl(context.domain), {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${tokens.client_id}:`)}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: form.toString(),
  });
  return parseTokens(await parseJson<TokenResponse>(response, "DI token refresh"), tokens.client_id, tokens.refresh_token);
}

export function makeFetcher(fetchImpl?: typeof fetch, timeoutMs = 15_000): Fetcher {
  return new Fetcher({ fetchImpl, timeoutMs, retries: 0 });
}
