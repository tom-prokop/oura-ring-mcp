import { describe, it, expect, vi } from "vitest";
import { OAuthError } from "@cloudflare/workers-oauth-provider";
import { OuraOAuthError, type OuraTokenSet } from "../auth/oura-oauth.js";
import { OURA_REFRESH_MARGIN_MS, isGrantProps, mcpAccessTtl, ouraTokenExchange, type GrantProps } from "./grant.js";
import type { Env } from "./config.js";

const NOW = 1_800_000_000_000;
const env = { OURA_CLIENT_ID: "cid", OURA_CLIENT_SECRET: "secret" } as Env;
const props = (expiresInMs: number): GrantProps => ({
  ouraUserId: "tom",
  ouraAccessToken: "oura-at-1",
  ouraRefreshToken: "oura-rt-1",
  ouraExpiresAt: NOW + expiresInMs,
});
const rotated: OuraTokenSet = {
  access_token: "oura-at-2",
  refresh_token: "oura-rt-2",
  token_type: "Bearer",
  expires_at: NOW + 86_400_000,
};

describe("mcpAccessTtl", () => {
  it("caps at one hour and ends 5 minutes before Oura's token", () => {
    expect(mcpAccessTtl(NOW + 86_400_000, NOW)).toBe(3600);
    expect(mcpAccessTtl(NOW + 30 * 60_000, NOW)).toBe(25 * 60);
    expect(mcpAccessTtl(NOW + 60_000, NOW)).toBe(60); // floor at KV minimum
  });
});

describe("isGrantProps", () => {
  it("validates shape", () => {
    expect(isGrantProps(props(1))).toBe(true);
    expect(isGrantProps({ ...props(1), ouraAccessToken: "" })).toBe(false);
    expect(isGrantProps(null)).toBe(false);
    expect(isGrantProps({ ouraUserId: "x" })).toBe(false);
  });
});

describe("ouraTokenExchange", () => {
  it("on code exchange, caps the MCP token TTL to the Oura token", async () => {
    const refresh = vi.fn();
    const result = await ouraTokenExchange(
      { grantType: "authorization_code" as never, props: props(20 * 60_000), env },
      { now: () => NOW, refresh }
    );
    expect(result).toEqual({ accessTokenTTL: 15 * 60 });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh Oura while its token has plenty of time left", async () => {
    const refresh = vi.fn();
    const result = await ouraTokenExchange(
      { grantType: "refresh_token" as never, props: props(OURA_REFRESH_MARGIN_MS + 60_000), env },
      { now: () => NOW, refresh }
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(result).toEqual({ accessTokenTTL: expect.any(Number) });
  });

  it("refreshes near expiry and stores the ROTATED refresh token in the grant", async () => {
    const refresh = vi.fn().mockResolvedValue(rotated);
    const result = await ouraTokenExchange(
      { grantType: "refresh_token" as never, props: props(60_000), env },
      { now: () => NOW, refresh }
    );
    expect(refresh).toHaveBeenCalledWith({ refreshToken: "oura-rt-1", clientId: "cid", clientSecret: "secret" });
    expect(result).toMatchObject({
      newProps: { ouraUserId: "tom", ouraAccessToken: "oura-at-2", ouraRefreshToken: "oura-rt-2", ouraExpiresAt: rotated.expires_at },
      accessTokenProps: { ouraRefreshToken: "oura-rt-2" },
      accessTokenTTL: 3600,
    });
  });

  it("revokes the grant (invalid_grant) when Oura rejects the refresh token", async () => {
    const refresh = vi.fn().mockRejectedValue(new OuraOAuthError("x", 400, "invalid_grant"));
    const err = await ouraTokenExchange(
      { grantType: "refresh_token" as never, props: props(0), env },
      { now: () => NOW, refresh }
    ).catch((e) => e);
    expect(err).toBeInstanceOf(OAuthError);
    expect(err.code).toBe("invalid_grant");
  });

  it("keeps the grant (temporarily_unavailable) on transient Oura failures", async () => {
    for (const failure of [new OuraOAuthError("x", 503), new TypeError("network")]) {
      const err = await ouraTokenExchange(
        { grantType: "refresh_token" as never, props: props(0), env },
        { now: () => NOW, refresh: vi.fn().mockRejectedValue(failure) }
      ).catch((e) => e);
      expect(err.code).toBe("temporarily_unavailable");
    }
  });

  it("rejects grants without Oura credentials and ignores other grant types", async () => {
    const err = await ouraTokenExchange({ grantType: "refresh_token" as never, props: {}, env }).catch((e) => e);
    expect(err.code).toBe("invalid_grant");
    expect(
      await ouraTokenExchange({ grantType: "urn:ietf:params:oauth:grant-type:token-exchange" as never, props: {}, env })
    ).toBeUndefined();
  });
});
