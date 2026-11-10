/**
 * Worker environment and derived configuration.
 *
 * Secrets (wrangler secret put): OURA_CLIENT_ID, OURA_CLIENT_SECRET,
 *   ALLOWED_OURA_USER_ID and/or ALLOWED_OURA_EMAIL.
 * Vars (wrangler.jsonc): PUBLIC_BASE_URL, optional OURA_SCOPES,
 *   optional ALLOW_ANY_OURA_USER ("true" disables the allowlist).
 */
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { OURA_SCOPES } from "../auth/oura-oauth.js";

export interface Env {
  OAUTH_KV: KVNamespace;
  /** Injected by OAuthProvider into the default handler's env. */
  OAUTH_PROVIDER: OAuthHelpers;

  OURA_CLIENT_ID: string;
  OURA_CLIENT_SECRET: string;

  /** Public origin MCP clients use, e.g. https://dixi.lulolabs.co (no trailing slash). */
  PUBLIC_BASE_URL: string;
  /** Space-separated Oura scopes; defaults to OURA_SCOPES. */
  OURA_SCOPES?: string;

  ALLOWED_OURA_USER_ID?: string;
  ALLOWED_OURA_EMAIL?: string;
  ALLOW_ANY_OURA_USER?: string;
}

/** Paths this Worker owns. Everything else is 404 (the static site owns it). */
export const PATHS = {
  mcp: "/mcp",
  authorize: "/oauth/authorize",
  token: "/oauth/token",
  register: "/oauth/register",
  ouraCallback: "/oura/callback",
} as const;

/** The single scope MCP clients receive. Tools only read, so one scope is enough. */
export const MCP_SCOPE = "oura:read";

export function baseUrl(env: Pick<Env, "PUBLIC_BASE_URL">): string {
  const raw = (env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be an absolute URL such as https://dixi.lulolabs.co");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("PUBLIC_BASE_URL must use https (http is allowed only for localhost)");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PUBLIC_BASE_URL must be an origin without a path");
  }
  return url.origin;
}

export function ouraScopes(env: Pick<Env, "OURA_SCOPES">): string[] {
  const configured = env.OURA_SCOPES?.split(/[\s,]+/).filter(Boolean);
  return configured && configured.length > 0 ? configured : [...OURA_SCOPES];
}

export function ouraRedirectUri(env: Pick<Env, "PUBLIC_BASE_URL">): string {
  return `${baseUrl(env)}${PATHS.ouraCallback}`;
}
