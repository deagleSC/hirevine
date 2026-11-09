import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./client";
import { ApiError, unwrap } from "./errors";
import { ensureProfile, profileFromMetadata } from "./profile";

const me = { id: "u1", email: "m@x.test", role: "manager", display_name: "Mia", org_id: "o1", org_name: "Acme" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(handler: (req: Request) => Response) {
  const calls: Request[] = [];
  const fn = vi.fn(async (input: Request) => {
    calls.push(input.clone());
    return handler(input);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("createApiClient", () => {
  it("attaches the bearer token", async () => {
    const f = fakeFetch(() => json(200, me));
    const api = createApiClient({ baseUrl: "http://api.test", getToken: async () => "tok-123", fetch: f.fn });
    await unwrap(api.GET("/v1/me"));
    expect(f.calls[0]?.headers.get("Authorization")).toBe("Bearer tok-123");
  });

  it("sends no Authorization header when signed out", async () => {
    const f = fakeFetch(() => json(200, me));
    const api = createApiClient({ baseUrl: "http://api.test", getToken: async () => null, fetch: f.fn });
    await unwrap(api.GET("/v1/me"));
    expect(f.calls[0]?.headers.get("Authorization")).toBeNull();
  });

  it("calls onWrongApp on 403 wrong_app, and still raises the error", async () => {
    const f = fakeFetch(() =>
      json(403, { error: { code: "wrong_app", message: "For managers.", details: { role: "candidate" } } }),
    );
    const onWrongApp = vi.fn();
    const api = createApiClient({ baseUrl: "http://api.test", getToken: async () => "t", onWrongApp, fetch: f.fn });
    await expect(unwrap(api.GET("/v1/manager/org"))).rejects.toMatchObject({ code: "wrong_app", status: 403 });
    expect(onWrongApp).toHaveBeenCalledWith("candidate");
  });

  it("calls onUnauthenticated on 401", async () => {
    const f = fakeFetch(() => json(401, { error: { code: "token_expired", message: "Expired." } }));
    const onUnauthenticated = vi.fn();
    const api = createApiClient({ baseUrl: "http://api.test", getToken: async () => "t", onUnauthenticated, fetch: f.fn });
    await expect(unwrap(api.GET("/v1/me"))).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it("turns a network failure into network_error", async () => {
    const api = createApiClient({
      baseUrl: "http://api.test",
      getToken: async () => null,
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    });
    await expect(unwrap(api.GET("/v1/me"))).rejects.toMatchObject({ code: "network_error" });
  });
});

describe("ensureProfile", () => {
  it("returns the existing profile without creating one", async () => {
    const f = fakeFetch(() => json(200, me));
    const api = createApiClient({ baseUrl: "http://api.test", getToken: async () => "t", fetch: f.fn });
    const details = vi.fn();
    await expect(ensureProfile(api, details)).resolves.toEqual(me);
    expect(details).not.toHaveBeenCalled();
  });

  it("creates the profile from sign-up details when it is missing", async () => {
    const f = fakeFetch((req) =>
      req.method === "GET"
        ? json(404, { error: { code: "profile_missing", message: "Finish creating your account first." } })
        : json(200, me),
    );
    const api = createApiClient({ baseUrl: "http://api.test", getToken: async () => "t", fetch: f.fn });
    const result = await ensureProfile(api, async () => ({
      role: "manager",
      display_name: "Mia",
      org_name: "Acme",
      adult_confirmed: false,
    }));
    expect(result).toEqual(me);
    const post = f.calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("http://api.test/v1/me/profile");
    expect(await post?.json()).toMatchObject({ role: "manager", org_name: "Acme" });
  });

  it("rethrows errors other than profile_missing", async () => {
    const f = fakeFetch(() => json(401, { error: { code: "invalid_token", message: "Bad token." } }));
    const api = createApiClient({ baseUrl: "http://api.test", getToken: async () => "t", fetch: f.fn });
    await expect(ensureProfile(api, async () => null)).rejects.toMatchObject({ code: "invalid_token" });
  });
});

describe("profileFromMetadata", () => {
  it("reads sign-up metadata", () => {
    expect(profileFromMetadata({ role: "candidate", display_name: "Cam", adult_confirmed: true })).toEqual({
      role: "candidate",
      display_name: "Cam",
      org_name: null,
      adult_confirmed: true,
    });
  });

  it("rejects missing or unknown roles", () => {
    expect(profileFromMetadata({ role: "admin", display_name: "x" })).toBeNull();
    expect(profileFromMetadata(undefined)).toBeNull();
  });
});
