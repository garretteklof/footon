import { describe, expect, test } from "bun:test";
import { Garmin, GarminAuthError, MemoryTokenStore, type TokenStore } from "../src/index";

function json(value: unknown): Response { return Response.json(value); }

describe("DI sign-in", () => {
  test("refreshes before a protected request and saves rotated tokens", async () => {
    const store = new MemoryTokenStore();
    const expiresAt = Math.floor(Date.now() / 1000) + 5;
    await store.save({
      access_token: "old-access", refresh_token: "old-refresh", client_id: "mock-client",
      expires_at: expiresAt, refresh_token_expires_at: expiresAt + 7200,
    });
    const requests: Request[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(String(input), init);
      requests.push(request);
      if (request.url.endsWith("/oauth/token")) return json({
        access_token: "new-access", refresh_token: "rotated-refresh", expires_in: 3600,
        refresh_token_expires_in: 7200,
      });
      return json({ ok: true });
    }) as typeof fetch;
    const garmin = new Garmin({ tokenStore: store, fetchImpl, retries: 0 });
    expect(await garmin.loadTokens()).toBe(true);

    expect(await garmin.request<{ ok: boolean }>("/test")).toEqual({ ok: true });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.headers.get("authorization")).toBe("Bearer new-access");
    expect(await store.load()).toMatchObject({
      access_token: "new-access", refresh_token: "rotated-refresh",
    });
  });

  test("coalesces concurrent requests behind one token refresh", async () => {
    const store = new MemoryTokenStore();
    const expiresAt = Math.floor(Date.now() / 1000) + 5;
    await store.save({
      access_token: "old-access", refresh_token: "old-refresh", client_id: "mock-client",
      expires_at: expiresAt, refresh_token_expires_at: expiresAt + 7200,
    });

    let releaseRefresh!: () => void;
    let markRefreshStarted!: () => void;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const refreshStarted = new Promise<void>((resolve) => { markRefreshStarted = resolve; });
    let refreshCount = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (new URL(String(input)).pathname.endsWith("/oauth/token")) {
        refreshCount++;
        markRefreshStarted();
        await refreshGate;
        return json({
          access_token: "new-access", refresh_token: "rotated-refresh", expires_in: 3600,
          refresh_token_expires_in: 7200,
        });
      }
      return json({ ok: true });
    }) as typeof fetch;
    const garmin = new Garmin({ tokenStore: store, fetchImpl, retries: 0 });
    expect(await garmin.loadTokens()).toBe(true);

    const requests = [garmin.request("/one"), garmin.request("/two")];
    await refreshStarted;
    releaseRefresh();
    expect(await Promise.all(requests)).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshCount).toBe(1);
    expect(await store.load()).toMatchObject({ access_token: "new-access", refresh_token: "rotated-refresh" });
  });

  test("does not restore tokens when logout races with refresh", async () => {
    const store = new MemoryTokenStore();
    const expiresAt = Math.floor(Date.now() / 1000) + 5;
    await store.save({
      access_token: "old-access", refresh_token: "old-refresh", client_id: "mock-client",
      expires_at: expiresAt, refresh_token_expires_at: expiresAt + 7200,
    });
    let releaseRefresh!: () => void;
    let markRefreshStarted!: () => void;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const refreshStarted = new Promise<void>((resolve) => { markRefreshStarted = resolve; });
    let protectedRequests = 0;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(String(input), init);
      if (request.url.endsWith("/oauth/token")) {
        markRefreshStarted();
        await refreshGate;
        return json({
          access_token: "stale-access", refresh_token: "stale-refresh", expires_in: 3600,
          refresh_token_expires_in: 7200,
        });
      }
      protectedRequests++;
      return json({ ok: true });
    }) as typeof fetch;
    const garmin = new Garmin({ tokenStore: store, fetchImpl, retries: 0 });
    expect(await garmin.loadTokens()).toBe(true);

    const request = garmin.request("/must-not-run");
    await refreshStarted;
    await garmin.logout();
    releaseRefresh();
    let error: unknown;
    try {
      await request;
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(GarminAuthError);
    expect(await store.load()).toBeNull();
    expect(protectedRequests).toBe(0);
  });

  test("clears stored tokens after a refresh write already started", async () => {
    const backing = new MemoryTokenStore();
    const expiresAt = Math.floor(Date.now() / 1000) + 5;
    await backing.save({
      access_token: "old-access", refresh_token: "old-refresh", client_id: "mock-client",
      expires_at: expiresAt, refresh_token_expires_at: expiresAt + 7200,
    });
    let releaseSave!: () => void;
    let markSaveStarted!: () => void;
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
    const store: TokenStore = {
      load: () => backing.load(),
      clear: () => backing.clear(),
      save: async (tokens) => {
        if (tokens.access_token === "stale-access") {
          markSaveStarted();
          await saveGate;
        }
        await backing.save(tokens);
      },
    };
    let protectedRequests = 0;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(String(input), init);
      if (request.url.endsWith("/oauth/token")) {
        return json({
          access_token: "stale-access", refresh_token: "stale-refresh", expires_in: 3600,
          refresh_token_expires_in: 7200,
        });
      }
      protectedRequests++;
      return json({ ok: true });
    }) as typeof fetch;
    const garmin = new Garmin({ tokenStore: store, fetchImpl, retries: 0 });
    expect(await garmin.loadTokens()).toBe(true);

    const request = garmin.request("/must-not-run");
    await saveStarted;
    const logout = garmin.logout();
    releaseSave();
    let error: unknown;
    try {
      await request;
    } catch (cause) {
      error = cause;
    }
    await logout;

    expect(error).toBeInstanceOf(GarminAuthError);
    expect(await backing.load()).toBeNull();
    expect(protectedRequests).toBe(0);
  });

  test("does not replace a new login with an older in-flight refresh", async () => {
    const store = new MemoryTokenStore();
    const expiresAt = Math.floor(Date.now() / 1000) + 5;
    await store.save({
      access_token: "account-a-access", refresh_token: "account-a-refresh", client_id: "mock-client",
      expires_at: expiresAt, refresh_token_expires_at: expiresAt + 7200,
    });
    let releaseRefresh!: () => void;
    let markRefreshStarted!: () => void;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const refreshStarted = new Promise<void>((resolve) => { markRefreshStarted = resolve; });
    const apiAuthorizations: (string | null)[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/oauth/token")) {
        const body = await request.clone().text();
        if (body.includes("grant_type=refresh_token")) {
          markRefreshStarted();
          await refreshGate;
          return json({
            access_token: "stale-account-a-access", refresh_token: "stale-account-a-refresh",
            expires_in: 3600, refresh_token_expires_in: 7200,
          });
        }
        return json({
          access_token: "account-b-access", refresh_token: "account-b-refresh", expires_in: 3600,
          refresh_token_expires_in: 7200,
        });
      }
      if (url.pathname.endsWith("/mobile/sso/en/sign-in")) return new Response("sign-in page");
      if (url.pathname.endsWith("/mobile/api/login")) {
        return json({ responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "account-b-ticket" });
      }
      apiAuthorizations.push(request.headers.get("authorization"));
      return json({ ok: true });
    }) as typeof fetch;
    const garmin = new Garmin({ tokenStore: store, fetchImpl, retries: 0 });
    expect(await garmin.loadTokens()).toBe(true);

    const staleRequest = garmin.request("/must-not-run");
    await refreshStarted;
    const login = await garmin.login("fake@example.invalid", "not-a-real-password");
    expect(login.status).toBe("success");
    releaseRefresh();
    let error: unknown;
    try {
      await staleRequest;
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(GarminAuthError);
    expect(await store.load()).toMatchObject({
      access_token: "account-b-access", refresh_token: "account-b-refresh",
    });
    expect(await garmin.request("/account-b")).toEqual({ ok: true });
    expect(apiAuthorizations).toEqual(["Bearer account-b-access"]);
  });

  test("logout clears saved tokens and cached profile data", async () => {
    const store = new MemoryTokenStore();
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    await store.save({
      access_token: "mock-access", refresh_token: "mock-refresh", client_id: "mock-client",
      expires_at: expiresAt, refresh_token_expires_at: expiresAt + 7200,
    });
    let profileRequests = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      if (new URL(String(input)).pathname === "/userprofile-service/socialProfile") {
        profileRequests++;
        return json({ displayName: "runner", userName: "runner", fullName: "Runner", profileId: 1 });
      }
      return json({});
    }) as typeof fetch;
    const garmin = new Garmin({ tokenStore: store, fetchImpl, retries: 0 });
    expect(await garmin.loadTokens()).toBe(true);
    await garmin.profile.get();

    await garmin.logout();

    expect(await store.load()).toBeNull();
    let error: unknown;
    try {
      await garmin.profile.get();
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(GarminAuthError);
    expect(profileRequests).toBe(1);
  });

  test("keeps an MFA challenge on the client and persists the exchanged DI tokens", async () => {
    const requests: { url: URL; init?: RequestInit }[] = [];
    const store = new MemoryTokenStore();
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(String(input), init);
      const url = new URL(request.url);
      requests.push({ url, init });
      if (url.pathname.endsWith("/sign-in")) return new Response("sign-in page");
      if (url.pathname.endsWith("/login")) return json({
        responseStatus: { type: "MFA_REQUIRED" },
        customerMfaInfo: { mfaLastMethodUsed: "email" },
      });
      if (url.pathname.endsWith("/verifyCode")) return json({
        responseStatus: { type: "SUCCESSFUL" }, serviceTicketId: "mock-ticket",
      });
      if (url.pathname.endsWith("/oauth/token")) return json({
        access_token: "mock-access", refresh_token: "mock-refresh", expires_in: 3600,
        refresh_token_expires_in: 7200,
      });
      return new Response("unexpected request", { status: 404 });
    }) as typeof fetch;
    const garmin = new Garmin({ tokenStore: store, fetchImpl, retries: 0 });

    const result = await garmin.login("fake@example.invalid", "not-a-real-password");
    expect(result.status).toBe("mfa_required");
    if (result.status !== "mfa_required") throw new Error("Expected MFA challenge");
    await garmin.resumeLogin("000000");

    expect(await store.load()).toMatchObject({
      access_token: "mock-access", refresh_token: "mock-refresh",
    });
    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/mobile/sso/en/sign-in", "/mobile/api/login", "/mobile/api/mfa/verifyCode",
      "/di-oauth2-service/oauth/token",
    ]);
    const loginRequest = requests[1];
    expect(loginRequest?.init?.body).toContain("fake@example.invalid");
    const mfaRequest = requests[2];
    expect(mfaRequest?.init?.body).toContain("000000");
  });
});
