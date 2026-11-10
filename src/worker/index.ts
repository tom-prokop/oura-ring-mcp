/**
 * Cloudflare Worker: remote MCP server for one Oura account.
 *
 * - @cloudflare/workers-oauth-provider is the MCP OAuth server (DCR + CIMD,
 *   PKCE, token rotation, encrypted grant props in KV).
 * - Oura is the upstream identity provider; its tokens live in grant props.
 * - /mcp is a stateless Streamable HTTP endpoint (agents createMcpHandler,
 *   MCP SDK v2): every request builds a fresh McpServer + OuraClient bound to
 *   that request's grant only.
 *
 * All public URLs derive from PUBLIC_BASE_URL, so the Worker behaves the same
 * when reached through a service binding from another Worker's custom domain.
 */
import { getProvider } from "./provider.js";
import { PATHS, type Env } from "./config.js";
import { withoutCors } from "./cors.js";


/**
 * Discovery paths some MCP clients probe instead of following the WWW-Authenticate hint
 * (ChatGPT reported "Couldn't discover OAuth settings"): answer them with the canonical metadata.
 */
const DISCOVERY_ALIASES: Record<string, string> = {
  "/.well-known/oauth-protected-resource": `/.well-known/oauth-protected-resource${PATHS.mcp}`,
  [`/.well-known/oauth-authorization-server${PATHS.mcp}`]: "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration": "/.well-known/oauth-authorization-server",
};

function canonical(request: Request): Request {
  const url = new URL(request.url);
  const target = DISCOVERY_ALIASES[url.pathname];
  if (!target || (request.method !== "GET" && request.method !== "HEAD")) return request;
  url.pathname = target;
  return new Request(url, request);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const response = await getProvider(env).fetch(canonical(request), env, ctx);
    return new URL(request.url).pathname === PATHS.mcp ? withoutCors(response) : response;
  },
} satisfies ExportedHandler<Env>;
