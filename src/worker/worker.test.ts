/**
 * End-to-end tests of the Worker inside workerd: MCP OAuth (DCR + PKCE) →
 * consent → Oura (stubbed) → callback/allowlist → token → /mcp tool call,
 * then MCP refresh with Oura refresh-token rotation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "./index.js";

const BASE = "http://localhost:8787";
const CLIENT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";

// ── Stub Oura ──────────────────────────────────────────────────────────────
interface OuraStub {
  user: { id: string; email: string };
  expiresIn: number;
  issued: number;
  refreshCalls: string[];
  revoked: number;
  validAccessTokens: Set<string>;
  validRefreshTokens: Set<string>;
  readinessAuth: string[];
}
let oura: OuraStub;
const realFetch = globalThis.fetch;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function issue() {
  oura.issued++;
  const tokens = { access_token: `oura-at-${oura.issued}`, refresh_token: `oura-rt-${oura.issued}` };
  oura.validAccessTokens.add(tokens.access_token);
  oura.validRefreshTokens.add(tokens.refresh_token);
  return json({ ...tokens, token_type: "bearer", expires_in: oura.expiresIn });
}

async function ouraFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.origin !== "https://api.ouraring.com") return realFetch(input, init);

  if (url.pathname === "/oauth/token") {
    const body = new URLSearchParams(await req.text());
    if (body.get("client_secret") !== "test-oura-secret") return json({ error: "invalid_client" }, 401);
    if (body.get("grant_type") === "authorization_code") {
      if (body.get("code") !== "oura-code" || !body.get("code_verifier")) return json({ error: "invalid_grant" }, 400);
      if (body.get("redirect_uri") !== `${BASE}/oura/callback`) return json({ error: "invalid_grant" }, 400);
      return issue();
    }
    const rt = body.get("refresh_token")!;
    oura.refreshCalls.push(rt);
    if (!oura.validRefreshTokens.has(rt)) return json({ error: "invalid_grant" }, 400);
    oura.validRefreshTokens.delete(rt); // single-use, like Oura
    return issue();
  }
  if (url.pathname === "/oauth/revoke") {
    oura.revoked++;
    return new Response(null, { status: 200 });
  }
  const auth = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  if (!oura.validAccessTokens.has(auth)) return json({ detail: "unauthorized" }, 401);
  if (url.pathname === "/v2/usercollection/personal_info") return json({ ...oura.user, age: 40 });
  if (url.pathname === "/v2/usercollection/daily_readiness") {
    oura.readinessAuth.push(auth);
    return json({
      data: [
        {
          id: "r1",
          day: url.searchParams.get("start_date"),
          score: 84,
          temperature_deviation: 0.1,
          temperature_trend_deviation: 0,
          timestamp: "2026-11-10T00:00:00+00:00",
          contributors: { hrv_balance: 80, resting_heart_rate: 90 },
        },
      ],
      next_token: null,
    });
  }
  return json({ data: [] });
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function call(path: string, init: RequestInit = {}, cookies?: Map<string, string>) {
  const headers = new Headers(init.headers);
  headers.set("host", new URL(BASE).host); // real clients always send Host
  if (cookies?.size) headers.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${BASE}${path}`, { ...init, headers, redirect: "manual" }), env as never, ctx);
  await waitOnExecutionContext(ctx);
  if (cookies) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  return res;
}

async function pkce() {
  const verifier = "v".repeat(20) + crypto.randomUUID();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

function decode(s: string) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Runs the browser part of the flow; returns the final callback response. */
async function signIn() {
  const reg = await call("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "ChatGPT",
      redirect_uris: [CLIENT_REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(reg.status).toBe(201);
  const { client_id } = (await reg.json()) as { client_id: string };

  const { verifier, challenge } = await pkce();
  const q = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: CLIENT_REDIRECT,
    state: "client-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${BASE}/mcp`,
  });
  const cookies = new Map<string, string>();
  const consent = await call(`/oauth/authorize?${q}`, {}, cookies);
  expect(consent.status).toBe(200);
  const page = await consent.text();
  expect(page).toContain("Allow ChatGPT to read your Oura data?");
  const handle = decode(page.match(/name="handle" value="([^"]+)"/)![1]);

  const approve = await call(
    `/oauth/authorize?${q}`,
    { method: "POST", body: new URLSearchParams({ handle, decision: "approve" }) },
    cookies
  );
  expect(approve.status).toBe(302);
  const toOura = new URL(approve.headers.get("location")!);
  expect(toOura.origin + toOura.pathname).toBe("https://cloud.ouraring.com/oauth/authorize");
  expect(toOura.searchParams.get("client_id")).toBe("test-oura-client");
  expect(toOura.searchParams.get("redirect_uri")).toBe(`${BASE}/oura/callback`);
  expect(toOura.searchParams.get("code_challenge_method")).toBe("S256");

  const callback = await call(
    `/oura/callback?${new URLSearchParams({ code: "oura-code", state: toOura.searchParams.get("state")! })}`,
    {},
    cookies
  );
  return { callback, client_id, verifier };
}

async function tokenRequest(params: Record<string, string>) {
  const res = await call("/oauth/token", { method: "POST", body: new URLSearchParams(params) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function mcp(token: string, body: unknown) {
  const res = await call("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const payload = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? text;
  return { status: res.status, headers: res.headers, json: JSON.parse(payload) };
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe("worker", () => {
  beforeEach(() => {
    oura = {
      user: { id: "tom-oura-id", email: "tom@example.com" },
      expiresIn: 86400,
      issued: 0,
      refreshCalls: [],
      revoked: 0,
      validAccessTokens: new Set(),
      validRefreshTokens: new Set(),
      readinessAuth: [],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(ouraFetch);
  });
  afterEach(() => vi.restoreAllMocks());

  it("serves OAuth metadata from PUBLIC_BASE_URL", async () => {
    const as = (await (await call("/.well-known/oauth-authorization-server")).json()) as Record<string, string>;
    expect(as.issuer).toBe(BASE);
    expect(as.authorization_endpoint).toBe(`${BASE}/oauth/authorize`);
    expect(as.token_endpoint).toBe(`${BASE}/oauth/token`);
    expect(as.registration_endpoint).toBe(`${BASE}/oauth/register`);
    const prm = (await (await call("/.well-known/oauth-protected-resource/mcp")).json()) as Record<string, unknown>;
    expect(prm.resource).toBe(`${BASE}/mcp`);
  });

  it("serves the same metadata at the root and alternate discovery paths clients probe", async () => {
    // ChatGPT and Claude.ai don't all follow the WWW-Authenticate hint; some look at the root.
    const prm = (await (await call("/.well-known/oauth-protected-resource")).json()) as Record<string, unknown>;
    expect(prm.resource).toBe(`${BASE}/mcp`);
    expect(prm.authorization_servers).toEqual([BASE]);
    for (const p of ["/.well-known/oauth-authorization-server/mcp", "/.well-known/openid-configuration"]) {
      const res = await call(p);
      expect(res.status, p).toBe(200);
      const as = (await res.json()) as Record<string, string>;
      expect(as.issuer, p).toBe(BASE);
      expect(as.registration_endpoint, p).toBe(`${BASE}/oauth/register`);
    }
  });

  it("refuses /mcp without a valid token and sends the discovery challenge, without CORS", async () => {
    const res = await call("/mcp", { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect((await call("/mcp", { method: "POST", headers: { authorization: "Bearer a:b:c" } })).status).toBe(401);
  });

  it("owns only its own paths", async () => {
    for (const p of ["/", "/privacy", "/style.css", "/robots.txt"]) {
      expect((await call(p)).status, p).toBe(404);
    }
  });

  it("completes sign-in for the allowed account and serves tools with that account's Oura token", async () => {
    const { callback, client_id, verifier } = await signIn();
    expect(callback.status).toBe(302);
    const back = new URL(callback.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(CLIENT_REDIRECT);
    expect(back.searchParams.get("state")).toBe("client-state");
    expect(back.searchParams.get("iss")).toBe(BASE);

    const tok = await tokenRequest({
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      client_id,
      redirect_uri: CLIENT_REDIRECT,
      code_verifier: verifier,
      resource: `${BASE}/mcp`,
    });
    expect(tok.status).toBe(200);
    expect(tok.body.token_type).toBe("bearer");
    expect(tok.body.expires_in).toBeLessThanOrEqual(3600);
    // MCP tokens are the provider's, never Oura's.
    expect(String(tok.body.access_token)).not.toContain("oura-at-");
    expect(String(tok.body.refresh_token)).not.toContain("oura-rt-");

    const init = await mcp(String(tok.body.access_token), {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(init.status).toBe(200);
    expect(init.json.result.serverInfo.name).toBe("oura-mcp");
    expect(init.headers.get("access-control-allow-origin")).toBeNull();

    const list = await mcp(String(tok.body.access_token), { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const tools = list.json.result.tools as Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>;
    expect(tools.length).toBe(29);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);

    const result = await mcp(String(tok.body.access_token), {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_readiness", arguments: { start_date: "2026-11-10" } },
    });
    expect(result.json.result.content[0].text).toContain("84");
    expect(result.json.result.structuredContent.days[0].score).toBe(84);
    expect(oura.readinessAuth).toEqual(["oura-at-1"]);
  });

  it("refreshes Oura near expiry on MCP refresh and persists the rotated Oura refresh token", async () => {
    oura.expiresIn = 120; // Oura token expires within the refresh margin
    const { callback, client_id, verifier } = await signIn();
    const code = new URL(callback.headers.get("location")!).searchParams.get("code")!;
    const first = await tokenRequest({
      grant_type: "authorization_code",
      code,
      client_id,
      redirect_uri: CLIENT_REDIRECT,
      code_verifier: verifier,
    });
    expect(first.status).toBe(200);
    expect(first.body.expires_in).toBe(60); // never outlives the Oura token

    // 1st MCP refresh → Oura refresh with oura-rt-1 → stores oura-rt-2
    const r1 = await tokenRequest({ grant_type: "refresh_token", refresh_token: String(first.body.refresh_token), client_id });
    expect(r1.status).toBe(200);
    // 2nd MCP refresh → must use the ROTATED token oura-rt-2 (oura-rt-1 is dead)
    const r2 = await tokenRequest({ grant_type: "refresh_token", refresh_token: String(r1.body.refresh_token), client_id });
    expect(r2.status).toBe(200);
    expect(oura.refreshCalls).toEqual(["oura-rt-1", "oura-rt-2"]);

    const after = await mcp(String(r2.body.access_token), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_readiness", arguments: { start_date: "2026-11-10" } },
    });
    expect(after.status, JSON.stringify(after.json)).toBe(200);
    expect(oura.readinessAuth).toEqual(["oura-at-3"]);
  });

  it("revokes the MCP grant when Oura no longer accepts the refresh token", async () => {
    oura.expiresIn = 120;
    const { callback, client_id, verifier } = await signIn();
    const code = new URL(callback.headers.get("location")!).searchParams.get("code")!;
    const first = await tokenRequest({ grant_type: "authorization_code", code, client_id, redirect_uri: CLIENT_REDIRECT, code_verifier: verifier });
    oura.validRefreshTokens.clear(); // user revoked access in the Oura app
    const r = await tokenRequest({ grant_type: "refresh_token", refresh_token: String(first.body.refresh_token), client_id });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_grant");
  });

  it("rejects other Oura accounts, revokes their Oura token and issues no MCP code", async () => {
    oura.user = { id: "someone-else", email: "else@example.com" };
    const { callback } = await signIn();
    expect(callback.status).toBe(403);
    const body = await callback.text();
    expect(body).toContain("not allowed");
    expect(body).not.toContain("someone-else"); // don't echo identities when an allowlist is set
    expect(callback.headers.get("location")).toBeNull();
    expect(oura.revoked).toBe(1);
  });

  it("refuses a forged or replayed callback state", async () => {
    const res = await call("/oura/callback?code=oura-code&state=forged");
    expect(res.status).toBe(400);
    expect(oura.issued).toBe(0);
  });

  it("sends the client access_denied when the user denies consent", async () => {
    const reg = await call("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "X", redirect_uris: [CLIENT_REDIRECT], token_endpoint_auth_method: "none" }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    const { challenge } = await pkce();
    const q = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: CLIENT_REDIRECT,
      state: "s",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const cookies = new Map<string, string>();
    const page = await (await call(`/oauth/authorize?${q}`, {}, cookies)).text();
    const handle = decode(page.match(/name="handle" value="([^"]+)"/)![1]);
    const res = await call(`/oauth/authorize?${q}`, { method: "POST", body: new URLSearchParams({ handle, decision: "deny" }) }, cookies);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
  });
});
