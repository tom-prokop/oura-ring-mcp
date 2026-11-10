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


export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const response = await getProvider(env).fetch(request, env, ctx);
    return new URL(request.url).pathname === PATHS.mcp ? withoutCors(response) : response;
  },
} satisfies ExportedHandler<Env>;
