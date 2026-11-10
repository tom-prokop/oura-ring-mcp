/**
 * Provider + MCP handler construction (see index.ts for the overview).
 * Kept separate because a Worker entry module may only export handlers.
 */
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";

import { OuraClient } from "../client.js";
import { createOuraMcpServer } from "../server.js";
import { authHandler } from "./auth-handler.js";
import { MCP_SCOPE, PATHS, baseUrl, type Env } from "./config.js";
import { isGrantProps, ouraTokenExchange } from "./grant.js";
import pkg from "../../package.json" with { type: "json" };

const VERSION: string = pkg.version;

/**
 * Build the per-request MCP server. Throws (→ error response) if the request
 * somehow has no valid grant props; /mcp is never served unauthenticated
 * because OAuthProvider rejects it before we get here.
 */
export function createServerForRequest() {
  const props = getMcpAuthContext()?.props;
  if (!isGrantProps(props)) {
    throw new Error("Missing Oura credentials in grant");
  }
  const client = new OuraClient({ accessToken: props.ouraAccessToken });
  return createOuraMcpServer(client, VERSION);
}

const providers = new Map<string, OAuthProvider<Env>>();

export function getProvider(env: Env): OAuthProvider<Env> {
  const base = baseUrl(env);
  let provider = providers.get(base);
  if (provider) return provider;

  const host = new URL(base).hostname;
  const mcpHandler = createMcpHandler(createServerForRequest, {
    route: PATHS.mcp,
    // Server-to-server MCP clients (ChatGPT, Claude.ai) send no Origin; no
    // browser needs cross-origin access, so no CORS headers at all.
    corsOptions: false,
    // Host is not re-checked here: OAuthProvider only routes requests whose
    // URL is exactly ${base}/mcp, and service-binding hops may not carry a
    // Host header. Browser Origins are still validated.
    allowedOriginHostnames: [host],
  });

  provider = new OAuthProvider<Env>({
    apiRoute: `${base}${PATHS.mcp}`,
    apiHandler: {
      fetch(request: Request, env: Env, ctx: ExecutionContext) {
        return mcpHandler(request, env, ctx);
      },
    },
    defaultHandler: authHandler,
    authorizeEndpoint: `${base}${PATHS.authorize}`,
    tokenEndpoint: `${base}${PATHS.token}`,
    clientRegistrationEndpoint: `${base}${PATHS.register}`,
    // ChatGPT registers via Client ID Metadata Documents; Claude.ai via DCR.
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [MCP_SCOPE],
    requiredScopes: [MCP_SCOPE],
    resourceMetadata: {
      resource: `${base}${PATHS.mcp}`,
      resource_name: "Oura MCP",
    },
    // Grants stay alive while used; idle for 30 days → reconnect.
    refreshTokenIdleTTL: 30 * 24 * 3600,
    tokenExchangeCallback: (options) => ouraTokenExchange(options),
    onError({ code, status, internal }) {
      // Never log descriptions/headers wholesale; codes and reasons only.
      console.warn("oauth error", { code, status, reason: internal?.reason });
    },
  });
  providers.set(base, provider);
  return provider;
}

