/**
 * Node-side OAuth2 helpers for the local (stdio) server and CLI.
 * The HTTP calls live in oura-oauth.ts (runtime-neutral, shared with the
 * Cloudflare Worker); this file adds env config and credential persistence.
 * https://cloud.ouraring.com/docs/authentication
 */

import { saveCredentials, type OuraCredentials } from "./store.js";
import {
  OURA_SCOPES,
  buildOuraAuthorizeUrl,
  exchangeOuraCode,
  refreshOuraToken,
  revokeOuraToken,
} from "./oura-oauth.js";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
}

/**
 * Build the authorization URL for the OAuth flow
 */
export function buildAuthorizationUrl(config: OAuthConfig, state: string): string {
  return buildOuraAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scopes: config.scopes ?? OURA_SCOPES,
    state,
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  config: OAuthConfig
): Promise<OuraCredentials> {
  return exchangeOuraCode({
    code,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  });
}

/**
 * Refresh an expired access token.
 *
 * Oura refresh tokens are single-use: the old one is invalid as soon as the
 * new one is issued, so the new credentials are persisted BEFORE returning.
 * If saving fails the error propagates (better a loud failure than silently
 * keeping a dead refresh token on disk).
 */
export async function refreshAccessToken(
  refreshToken: string,
  config: OAuthConfig
): Promise<OuraCredentials> {
  const credentials = await refreshOuraToken({
    refreshToken,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
  await saveCredentials(credentials);
  return credentials;
}

/**
 * Revoke an access token (Oura only documents the query-string form).
 */
export async function revokeToken(accessToken: string): Promise<void> {
  await revokeOuraToken(accessToken);
}

/**
 * Get the default OAuth config from environment variables
 */
export function getOAuthConfigFromEnv(): OAuthConfig | null {
  const clientId = process.env.OURA_CLIENT_ID;
  const clientSecret = process.env.OURA_CLIENT_SECRET;
  const redirectUri = process.env.OURA_REDIRECT_URI ?? "http://localhost:3000/callback";

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}
