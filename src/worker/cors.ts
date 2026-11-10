/**
 * The OAuth provider adds permissive CORS to every route it serves. That is
 * fine for public discovery/token/registration endpoints, but /mcp is only
 * called server-to-server (ChatGPT, Claude.ai), so strip CORS there: no
 * browser page on another origin can call the MCP endpoint.
 */
export function withoutCors(response: Response): Response {
  const headers = new Headers(response.headers);
  let changed = false;
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("access-control-")) {
      headers.delete(name);
      changed = true;
    }
  }
  return changed
    ? new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    : response;
}
