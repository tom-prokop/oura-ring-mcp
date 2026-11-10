#!/usr/bin/env node
/**
 * Oura MCP Server
 *
 * An MCP server that exposes Oura Ring data with smart analysis tools.
 * Designed to give LLMs human-readable summaries alongside raw data.
 *
 * CLI Commands:
 *   npx oura-ring-mcp          - Start the MCP server (stdio transport)
 *   npx oura-ring-mcp --http   - Start with HTTP transport (for remote deployment)
 *   npx oura-ring-mcp auth     - Authenticate with Oura via OAuth
 *   npx oura-ring-mcp logout   - Clear stored credentials
 *   npx oura-ring-mcp status   - Show authentication status
 */
import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { OuraClient, type OuraClientConfig } from "./client.js";
import { createOuraMcpServer } from "./server.js";
import { loadCredentials, isExpired } from "./auth/store.js";
import { TokenManager } from "./auth/token-manager.js";
import { refreshAccessToken, getOAuthConfigFromEnv } from "./auth/oauth.js";

// Read version from package.json
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"));
const VERSION: string = pkg.version;

// ─────────────────────────────────────────────────────────────
// CLI Command Handling
// ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];
const useHttpTransport = args.includes("--http") || args.includes("-H");

// Handle CLI subcommands
if (["auth", "logout", "status"].includes(command)) {
  // Dynamic import to avoid loading auth modules unless needed
  const { runAuthFlow, runLogout, showAuthStatus } = await import("./auth/cli.js");

  switch (command) {
    case "auth":
      await runAuthFlow();
      break;
    case "logout":
      await runLogout();
      break;
    case "status":
      await showAuthStatus();
      break;
  }
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────
// Token Resolution
// ─────────────────────────────────────────────────────────────

/**
 * Build the Oura client config from (in order):
 *   1. OURA_ACCESS_TOKEN / OURA_PERSONAL_ACCESS_TOKEN (legacy PATs; Oura stopped
 *      issuing these in Dec 2025, but existing ones may still work)
 *   2. Stored OAuth credentials (~/.oura-mcp/credentials.json). When
 *      OURA_CLIENT_ID/SECRET are set, tokens are refreshed on demand for the
 *      lifetime of the process and each rotated refresh token is saved.
 *
 * Returns null if no token is found (HTTP mode can start without one).
 */
async function resolveClientConfig(): Promise<OuraClientConfig | null> {
  const envToken = process.env.OURA_ACCESS_TOKEN || process.env.OURA_PERSONAL_ACCESS_TOKEN;
  if (envToken) {
    return { accessToken: envToken };
  }

  const credentials = await loadCredentials();
  if (!credentials) {
    return null;
  }

  const oauthConfig = getOAuthConfigFromEnv();
  if (!oauthConfig) {
    if (isExpired(credentials)) {
      console.error(
        "Warning: Token expired and cannot refresh without OAuth credentials.\n" +
          "Please set OURA_CLIENT_ID and OURA_CLIENT_SECRET, or run:\n" +
          "  npx oura-ring-mcp auth"
      );
      return null;
    }
    return { accessToken: credentials.access_token };
  }

  // refreshAccessToken persists the rotated credentials before returning.
  const tokens = new TokenManager({
    initial: credentials,
    refresh: (refreshToken) => refreshAccessToken(refreshToken, oauthConfig),
  });

  if (isExpired(credentials)) {
    console.error("Access token expired, refreshing...");
    try {
      await tokens.forceRefresh();
      console.error("Token refreshed successfully.");
    } catch (error) {
      console.error(
        `Token refresh failed: ${error instanceof Error ? error.message : error}\n` +
          "Please re-authenticate: npx oura-ring-mcp auth"
      );
      return null;
    }
  }

  return {
    accessToken: tokens.current.access_token,
    getAccessToken: () => tokens.getAccessToken(),
  };
}

// ─────────────────────────────────────────────────────────────
// Server Setup
// ─────────────────────────────────────────────────────────────

const clientConfig = await resolveClientConfig();

// For stdio transport, a token is required upfront
if (!clientConfig && !useHttpTransport) {
  console.error(
    "Error: No Oura credentials found.\n\n" +
      "Recommended: authenticate via OAuth\n" +
      "  1. Create an app at https://developer.ouraring.com/applications\n" +
      "  2. Set OURA_CLIENT_ID and OURA_CLIENT_SECRET\n" +
      "  3. Run: npx oura-ring-mcp auth\n\n" +
      "Legacy: set OURA_ACCESS_TOKEN to an existing personal access token\n" +
      "  (Oura stopped issuing new PATs in December 2025)"
  );
  process.exit(1);
}

if (!clientConfig && useHttpTransport) {
  console.error(
    "Warning: No Oura credentials found. Server will start but API calls will fail.\n" +
      "Set OURA_ACCESS_TOKEN environment variable to enable data access."
  );
}

const ouraClient = new OuraClient(clientConfig ?? { accessToken: "" });
const server = createOuraMcpServer(ouraClient, VERSION);

// ─────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────

async function main() {
  if (useHttpTransport) {
    // HTTP transport for remote deployment
    const { startHttpServer } = await import("./transports/http.js");
    await startHttpServer(server, { ouraClient });
  } else {
    // Stdio transport for local use (Claude Desktop)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Oura MCP server running on stdio");
  }
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
