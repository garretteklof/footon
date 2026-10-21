import { describe, expect, test } from "bun:test";
import { Garmin, GarminError, GarminHttpError, MemoryTokenStore, type Tokens } from "../src/index";
import { parseJsonResponse } from "../src/http/fetcher";

function futureTokens(): Tokens {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: "mock-access",
    refresh_token: "mock-refresh",
    client_id: "mock-client",
    expires_at: expires,
    refresh_token_expires_at: expires + 7200,
  };
}

async function authenticated(fetchImpl: typeof fetch): Promise<Garmin> {
  const tokenStore = new MemoryTokenStore();
  await tokenStore.save(futureTokens());
  const garmin = new Garmin({ tokenStore, fetchImpl, retries: 0 });
  await garmin.loadTokens();
  return garmin;
}

describe("authenticated requests", () => {
  test("parses JSON and empty HTTP response bodies", async () => {
    expect(await parseJsonResponse<{ ok: boolean }>(Response.json({ ok: true }))).toEqual({ ok: true });
    expect(await parseJsonResponse(new Response(null, { status: 204 }))).toBeNull();
    expect(await parseJsonResponse(new Response(""))).toBeNull();
  });

  test("sends JSON, query parameters, caller headers, and bearer authentication", async () => {
    let sent: Request | undefined;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      sent = new Request(String(input), init);
      return Response.json({ accepted: true });
    }) as unknown as typeof fetch;
    const garmin = await authenticated(fetchImpl);

    expect(await garmin.request<{ accepted: boolean }>("/example", {
      method: "POST",
      params: { q: "a b" },
      json: { value: 3 },
      headers: { "x-trace-id": "test" },
    })).toEqual({ accepted: true });

    expect(sent).toBeDefined();
    expect(new URL(sent!.url).searchParams.get("q")).toBe("a b");
    expect(sent!.method).toBe("POST");
    expect(sent!.headers.get("authorization")).toBe("Bearer mock-access");
    expect(sent!.headers.get("accept")).toBe("application/json");
    expect(sent!.headers.get("content-type")).toBe("application/json");
    expect(sent!.headers.get("user-agent")).toBeTruthy();
    expect(sent!.headers.get("x-trace-id")).toBe("test");
    expect(await sent!.json()).toEqual({ value: 3 });
  });

  test("returns null for an empty success and rejects malformed JSON", async () => {
    const fetchImpl = (async (input: string | URL | Request) =>
      new URL(String(input)).pathname === "/empty"
        ? new Response(null, { status: 204 })
        : new Response("not JSON", { status: 200 })) as unknown as typeof fetch;
    const garmin = await authenticated(fetchImpl);

    expect(await garmin.request("/empty")).toBeNull();
    let malformedError: unknown;
    try {
      await garmin.request("/malformed");
    } catch (error) {
      malformedError = error;
    }
    expect(malformedError).toBeInstanceOf(GarminError);
  });

  test("preserves HTTP error details without leaking query values", async () => {
    const fetchImpl = (async () => new Response("invalid request", { status: 400 })) as unknown as typeof fetch;
    const garmin = await authenticated(fetchImpl);
    let error: unknown;
    try {
      await garmin.request("/private", { params: { token: "must-not-appear" } });
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(GarminHttpError);
    if (error instanceof GarminHttpError) {
      expect(error.status).toBe(400);
      expect(error.body).toBe("invalid request");
      expect(error.url).toContain("/private");
      expect(error.url).not.toContain("must-not-appear");
    }
  });
});
