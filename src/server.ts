/**
 * Shared MCP server factory used by both the local stdio entry point
 * (src/index.ts) and the Cloudflare Worker (src/worker.ts).
 * Runtime-neutral: no node: imports.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { OuraClient } from "./client.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

export const SERVER_NAME = "oura-mcp";

export function createOuraMcpServer(client: OuraClient, version: string): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version });
  registerTools(server, client);
  registerResources(server, client);
  registerPrompts(server);
  return server;
}
