import { describe, it, expect, vi } from "vitest";
import {
  buildOuraAuthorizeUrl,
  exchangeOuraCode,
  refreshOuraToken,
  revokeOuraToken,
  toTokenSet,
  isTokenExpired,
  OuraOAuthError,
  OURA_SCOPES,
} from "./oura-oauth.js";

const creds = { clientId: "cid", clientSecret: "csecret" };
const ok = (body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

describe("oura-oauth", () => {
  it("builds an authorize URL with scopes, state and PKCE", () => {
    const url = new URL(
      buildOuraAuthorizeUrl({ clientId: "cid", redirectUri: "https://x/cb", state: "s1", codeChallenge: "ch" })
    );
    expect(url.origin + url.pathname).toBe("https://cloud.ouraring.com/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(OURA_SCOPES.join(" "));
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("s1");
  });

  it("omits PKCE params when no challenge is given", () => {
    const url = new URL(buildOuraAuthorizeUrl({ clientId: "c", redirectUri: "r", state: "s", scopes: ["daily"] }));
    expect(url.searchParams.has("code_challenge")).toBe(false);
    expect(url.searchParams.get("scope")).toBe("daily");
  });

  it("exchanges a code (with verifier) for a token set", async () => {
    const f = ok({ access_token: "a", refresh_token: "r", token_type: "bearer", expires_in: 100 });
    const t = await exchangeOuraCode({ ...creds, code: "c", redirectUri: "https://x/cb", codeVerifier: "v" }, f);
    expect(t.access_token).toBe("a");
    expect(t.refresh_token).toBe("r");
    const body = new URLSearchParams(f.mock.calls[0][1].body as URLSearchParams);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("v");
    expect(body.get("client_secret")).toBe("csecret");
  });

  it("refresh returns the rotated refresh token", async () => {
    const f = ok({ access_token: "a2", refresh_token: "r2", expires_in: 100 });
    const t = await refreshOuraToken({ ...creds, refreshToken: "r1" }, f);
    expect(t.refresh_token).toBe("r2");
    const body = new URLSearchParams(f.mock.calls[0][1].body as URLSearchParams);
    expect(body.get("refresh_token")).toBe("r1");
  });

  it("keeps the previous refresh token if Oura omits one", () => {
    expect(toTokenSet({ access_token: "a" }, "old", 0)).toEqual({
      access_token: "a",
      refresh_token: "old",
      token_type: "Bearer",
      expires_at: 86_400_000,
    });
  });

  it("rejects responses without tokens", () => {
    expect(() => toTokenSet({})).toThrow(OuraOAuthError);
    expect(() => toTokenSet({ access_token: "a" })).toThrow(/refresh_token/);
  });

  it("surfaces only the OAuth error code on failure, never the body", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant", detail: "secret-ish" }), { status: 400 })
    );
    const err = await refreshOuraToken({ ...creds, refreshToken: "r" }, f).catch((e) => e);
    expect(err).toBeInstanceOf(OuraOAuthError);
    expect(err.code).toBe("invalid_grant");
    expect(err.message).not.toContain("secret-ish");
  });

  it("handles non-JSON error bodies", async () => {
    const f = vi.fn().mockResolvedValue(new Response("oops", { status: 500 }));
    await expect(exchangeOuraCode({ ...creds, code: "c", redirectUri: "r" }, f)).rejects.toThrow("HTTP 500");
  });

  it("revokes with an encoded query-string token", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await revokeOuraToken("a+b/c", f);
    expect(f.mock.calls[0][0]).toBe("https://api.ouraring.com/oauth/revoke?access_token=a%2Bb%2Fc");
    const bad = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    await expect(revokeOuraToken("x", bad)).rejects.toThrow("HTTP 401");
  });

  it("detects expiry with a buffer", () => {
    expect(isTokenExpired({ expires_at: 1000 }, 0, 999)).toBe(false);
    expect(isTokenExpired({ expires_at: 1000 }, 10, 995)).toBe(true);
  });
});
