/**
 * Runtime-neutral Oura OAuth2 helpers (Node 18+ and Cloudflare Workers).
 * Only uses fetch / URLSearchParams — no node: imports.
 *
 * https://cloud.ouraring.com/docs/authentication
 *
 * Important Oura behaviour: refresh tokens are SINGLE-USE. A refresh
 * response carries a new refresh token and the old one stops working
 * immediately, so callers must persist the returned token set every time.
 */

export const OURA_AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
export const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
export const OURA_REVOKE_URL = "https://api.ouraring.com/oauth/revoke";

/**
 * Scopes the tools in this server read from. `email` + `personal` are also
 * used by the remote server's single-user allowlist.
 */
export const OURA_SCOPES = [
  "email",
  "personal",
  "daily",
  "heartrate",
  "workout",
  "tag",
  "session",
  "spo2",
  "ring_configuration",
  "stress",
  "heart_health",
] as const;

export interface OuraTokenSet {
  access_token: string;
  refresh_token: string;
  token_type: string;
  /** Unix timestamp (ms) when the access token expires */
  expires_at: number;
}

interface OuraTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
}

export class OuraOAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** OAuth error code from Oura's response body (e.g. "invalid_grant"), if any */
    public readonly code?: string
  ) {
    super(message);
    this.name = "OuraOAuthError";
  }
}

export interface AuthorizeUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
  /** PKCE S256 challenge (recommended by Oura) */
  codeChallenge?: string;
}

export function buildOuraAuthorizeUrl(params: AuthorizeUrlParams): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: (params.scopes ?? OURA_SCOPES).join(" "),
    state: params.state,
  });
  if (params.codeChallenge) {
    query.set("code_challenge", params.codeChallenge);
    query.set("code_challenge_method", "S256");
  }
  return `${OURA_AUTHORIZE_URL}?${query.toString()}`;
}

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

type FetchLike = typeof fetch;

async function postToken(
  body: Record<string, string>,
  creds: ClientCredentials,
  what: string,
  fetchImpl: FetchLike
): Promise<OuraTokenResponse> {
  const response = await fetchImpl(OURA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      ...body,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });

  if (!response.ok) {
    // Only surface the OAuth error code — never echo the body verbatim.
    let code: string | undefined;
    try {
      const err = (await response.json()) as { error?: unknown };
      if (typeof err.error === "string") code = err.error.slice(0, 64);
    } catch {
      /* non-JSON error body */
    }
    throw new OuraOAuthError(
      `${what} failed: HTTP ${response.status}${code ? ` (${code})` : ""}`,
      response.status,
      code
    );
  }

  return (await response.json()) as OuraTokenResponse;
}

/**
 * Convert an Oura token response into a token set. If Oura (unexpectedly)
 * omits a refresh token we keep the previous one rather than losing it.
 */
export function toTokenSet(
  data: OuraTokenResponse,
  previousRefreshToken?: string,
  now: number = Date.now()
): OuraTokenSet {
  if (!data.access_token) {
    throw new OuraOAuthError("Oura token response missing access_token", 502);
  }
  const refresh = data.refresh_token || previousRefreshToken;
  if (!refresh) {
    throw new OuraOAuthError("Oura token response missing refresh_token", 502);
  }
  return {
    access_token: data.access_token,
    refresh_token: refresh,
    token_type: data.token_type ?? "Bearer",
    // Default to 1 day if Oura omits expires_in
    expires_at: now + (data.expires_in ?? 86400) * 1000,
  };
}

export async function exchangeOuraCode(
  params: ClientCredentials & { code: string; redirectUri: string; codeVerifier?: string },
  fetchImpl: FetchLike = fetch
): Promise<OuraTokenSet> {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
  };
  if (params.codeVerifier) body.code_verifier = params.codeVerifier;
  const data = await postToken(body, params, "Oura token exchange", fetchImpl);
  return toTokenSet(data);
}

/**
 * Refresh an Oura access token. The returned set contains the NEW refresh
 * token; the one passed in is now invalid and must be replaced in storage.
 */
export async function refreshOuraToken(
  params: ClientCredentials & { refreshToken: string },
  fetchImpl: FetchLike = fetch
): Promise<OuraTokenSet> {
  const data = await postToken(
    { grant_type: "refresh_token", refresh_token: params.refreshToken },
    params,
    "Oura token refresh",
    fetchImpl
  );
  return toTokenSet(data, params.refreshToken);
}

/**
 * Revoke an Oura access token.
 *
 * Oura's docs only document the token as a query parameter
 * (`/oauth/revoke?access_token=...`); no body/header form is documented, so
 * we keep that form (URL-encoded) and make sure the URL is never logged.
 */
export async function revokeOuraToken(
  accessToken: string,
  fetchImpl: FetchLike = fetch
): Promise<void> {
  const url = `${OURA_REVOKE_URL}?${new URLSearchParams({ access_token: accessToken })}`;
  const response = await fetchImpl(url, { method: "POST" });
  if (!response.ok) {
    throw new OuraOAuthError(`Oura token revocation failed: HTTP ${response.status}`, response.status);
  }
}

export function isTokenExpired(tokens: Pick<OuraTokenSet, "expires_at">, bufferMs = 60_000, now = Date.now()): boolean {
  return now + bufferMs >= tokens.expires_at;
}
