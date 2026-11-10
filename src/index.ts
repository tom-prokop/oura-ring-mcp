#!/usr/bin/env node
/**
 * Oura MCP Server
 *
 * An MCP server that exposes Oura Ring data with smart analysis tools.
 * Designed to give LLMs human-readable summaries alongside raw data.
 *
 * CLI Commands:
 *   npx oura-ring-mcp          - Start the MCP server (stdio transport)
 *   npx oura-ring-mcp auth     - Authenticate with Oura via OAuth
 *   npx oura-ring-mcp logout   - Clear stored credentials
 *   npx oura-ring-mcp status   - Show authentication status
 */
import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

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
 * Returns null if no token is found.
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

if (!clientConfig) {
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

const ouraClient = new OuraClient(clientConfig!);
const server = createOuraMcpServer(ouraClient, VERSION);

// ─────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────

async function main() {
  // Stdio transport for local use (Claude Desktop). Remote access is the
  // Cloudflare Worker in src/worker.ts.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Oura MCP server running on stdio");
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
