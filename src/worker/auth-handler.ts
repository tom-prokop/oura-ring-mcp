/**
 * Non-API routes of the Worker (OAuthProvider's defaultHandler):
 *
 *   GET  /oauth/authorize  validate the MCP client's request, show consent
 *   POST /oauth/authorize  on approval, redirect to Oura (state + PKCE)
 *   GET  /oura/callback    exchange Oura's code, enforce the allowlist,
 *                          complete the MCP authorization
 *
 * Anything else is a 404: the static site in front of us owns other paths.
 * Nothing here logs tokens, codes or Oura data.
 */
import {
  AuthorizationError,
  CimdFetchError,
  authorizationErrorRedirect,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { OuraClient } from "../client.js";
import { buildOuraAuthorizeUrl, exchangeOuraCode, revokeOuraToken } from "../auth/oura-oauth.js";
import { checkAllowlist } from "./allowlist.js";
import { MCP_SCOPE, PATHS, ouraRedirectUri, ouraScopes, type Env } from "./config.js";
import { grantPropsFromTokens } from "./grant.js";
import { consentPage, htmlHeaders, messagePage, setupNeededPage } from "./html.js";

interface UpstreamData {
  verifier: string;
}

function html(body: string, status = 200, headers?: Headers): Response {
  return new Response(body, { status, headers: htmlHeaders(headers) });
}

function redirect(location: string, headers?: Headers): Response {
  const h = new Headers(headers);
  h.set("Location", location);
  h.set("Cache-Control", "no-store");
  return new Response(null, { status: 302, headers: h });
}

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newPkceVerifier(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

async function authorizeGet(request: Request, oauth: OAuthHelpers): Promise<Response> {
  const authRequest = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(authRequest); // before beginConsent: a failed lookup leaves nothing in KV
  const consent = await oauth.beginConsent(authRequest);
  return html(consentPage(details, consent.handle), 200, consent.headers);
}

async function authorizePost(request: Request, env: Env, oauth: OAuthHelpers): Promise<Response> {
  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");
  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }

  const approved = await oauth.approveConsent(request, handle, { scope: [MCP_SCOPE] });
  const verifier = newPkceVerifier();
  const { state, headers } = await oauth.beginUpstream(approved.request, {
    data: { verifier } satisfies UpstreamData,
    headers: approved.headers,
  });
  const location = buildOuraAuthorizeUrl({
    clientId: env.OURA_CLIENT_ID,
    redirectUri: ouraRedirectUri(env),
    scopes: ouraScopes(env),
    state,
    codeChallenge: await pkceChallenge(verifier),
  });
  return redirect(location, headers);
}

async function ouraCallback(
  request: Request,
  env: Env,
  oauth: OAuthHelpers,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const { request: original, data, headers } = await oauth.finishUpstream<UpstreamData>(request);

  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) {
    return redirect(authorizationErrorRedirect(original, "access_denied"), headers);
  }

  const tokens = await exchangeOuraCode({
    code,
    codeVerifier: data.verifier,
    redirectUri: ouraRedirectUri(env),
    clientId: env.OURA_CLIENT_ID,
    clientSecret: env.OURA_CLIENT_SECRET,
  });

  const info = await new OuraClient({ accessToken: tokens.access_token }).getPersonalInfo();
  const decision = checkAllowlist(info, env);
  if (!decision.allowed) {
    // Don't keep a token for an account we won't serve.
    ctx.waitUntil(revokeOuraToken(tokens.access_token).catch(() => undefined));
    if (decision.reason === "not_configured") {
      return html(setupNeededPage(info), 403, headers);
    }
    return html(
      messagePage("Not allowed", "This Oura account is not allowed to use this server."),
      403,
      headers
    );
  }

  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: encodeURIComponent(info.id),
    metadata: {},
    scope: [MCP_SCOPE],
    props: grantPropsFromTokens(info.id, tokens),
  });
  return redirect(redirectTo, headers);
}

export const authHandler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const oauth = env.OAUTH_PROVIDER;
    try {
      if (url.pathname === PATHS.authorize) {
        if (request.method === "GET") return await authorizeGet(request, oauth);
        if (request.method === "POST") return await authorizePost(request, env, oauth);
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, POST" } });
      }
      if (url.pathname === PATHS.ouraCallback && request.method === "GET") {
        return await ouraCallback(request, env, oauth, ctx);
      }
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo) {
        return redirect(error.redirectTo);
      }
      if (error instanceof AuthorizationError) {
        return html(messagePage("Sign-in could not continue", error.description || "Please start again from your app."), 400);
      }
      if (error instanceof CimdFetchError) {
        return html(messagePage("Sign-in could not continue", "This app could not be verified."), 400);
      }
      // Log only the error class; messages could echo upstream responses.
      console.error("auth handler error:", error instanceof Error ? error.name : typeof error);
      return html(messagePage("Something went wrong", "Please try connecting again."), 500);
    }
  },
};
