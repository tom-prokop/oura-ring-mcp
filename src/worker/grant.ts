/**
 * Oura tokens live in the MCP grant's props, which workers-oauth-provider
 * encrypts with a key only the MCP token holder can unwrap.
 *
 * Refresh strategy: MCP access tokens are capped so they always expire
 * before the Oura access token they carry. When the MCP client refreshes and
 * the Oura token is close to expiry, we refresh at Oura and store the NEW
 * Oura refresh token in the grant (Oura refresh tokens are single-use).
 */
import { OAuthError, type TokenExchangeCallbackOptions, type TokenExchangeCallbackResult } from "@cloudflare/workers-oauth-provider";
import { OuraOAuthError, refreshOuraToken, type OuraTokenSet } from "../auth/oura-oauth.js";
import type { Env } from "./config.js";

export interface GrantProps {
  ouraUserId: string;
  ouraAccessToken: string;
  ouraRefreshToken: string;
  /** ms since epoch */
  ouraExpiresAt: number;
}

/** Refresh at Oura when its token has less than this left. */
export const OURA_REFRESH_MARGIN_MS = 10 * 60_000;
/** MCP access tokens end at least this long before the Oura token does. */
const SAFETY_MS = 5 * 60_000;
const MAX_MCP_ACCESS_TTL_S = 3600;
const MIN_MCP_ACCESS_TTL_S = 60;

export function isGrantProps(value: unknown): value is GrantProps {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.ouraUserId === "string" &&
    typeof p.ouraAccessToken === "string" &&
    p.ouraAccessToken.length > 0 &&
    typeof p.ouraRefreshToken === "string" &&
    typeof p.ouraExpiresAt === "number"
  );
}

export function grantPropsFromTokens(ouraUserId: string, tokens: OuraTokenSet): GrantProps {
  return {
    ouraUserId,
    ouraAccessToken: tokens.access_token,
    ouraRefreshToken: tokens.refresh_token,
    ouraExpiresAt: tokens.expires_at,
  };
}

/** MCP access-token lifetime (seconds) that ends before the Oura token does. */
export function mcpAccessTtl(ouraExpiresAt: number, now: number): number {
  const remaining = Math.floor((ouraExpiresAt - now - SAFETY_MS) / 1000);
  return Math.max(MIN_MCP_ACCESS_TTL_S, Math.min(MAX_MCP_ACCESS_TTL_S, remaining));
}

export interface ExchangeDeps {
  now?: () => number;
  refresh?: typeof refreshOuraToken;
}

export async function ouraTokenExchange(
  options: Pick<TokenExchangeCallbackOptions<Env>, "grantType" | "props" | "env">,
  deps: ExchangeDeps = {}
): Promise<TokenExchangeCallbackResult | void> {
  const now = deps.now?.() ?? Date.now();
  const refresh = deps.refresh ?? refreshOuraToken;
  const props = options.props;

  if (options.grantType !== "authorization_code" && options.grantType !== "refresh_token") {
    return;
  }
  if (!isGrantProps(props)) {
    throw new OAuthError("invalid_grant", { description: "Grant is missing Oura credentials; reconnect." });
  }

  if (options.grantType === "authorization_code" || props.ouraExpiresAt - now > OURA_REFRESH_MARGIN_MS) {
    return { accessTokenTTL: mcpAccessTtl(props.ouraExpiresAt, now) };
  }

  let tokens: OuraTokenSet;
  try {
    tokens = await refresh({
      refreshToken: props.ouraRefreshToken,
      clientId: options.env.OURA_CLIENT_ID,
      clientSecret: options.env.OURA_CLIENT_SECRET,
    });
  } catch (error) {
    // 400/401 from Oura's token endpoint: the refresh token is gone for good
    // (revoked in the Oura app, or already rotated). Revoke this grant so the
    // client re-authorizes instead of retrying forever.
    if (error instanceof OuraOAuthError && (error.code === "invalid_grant" || error.status === 400 || error.status === 401)) {
      throw new OAuthError("invalid_grant", { description: "Oura access was revoked or expired; reconnect." });
    }
    throw new OAuthError("temporarily_unavailable", {
      description: "Oura is unavailable; try again shortly.",
      statusCode: 503,
    });
  }

  const newProps: GrantProps = { ...props, ...grantPropsFromTokens(props.ouraUserId, tokens) };
  return {
    newProps,
    accessTokenProps: newProps,
    accessTokenTTL: mcpAccessTtl(newProps.ouraExpiresAt, now),
  };
}
