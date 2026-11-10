/**
 * End-to-end tests through the real MCP SDK (in-memory transport):
 * tool annotations are advertised, and structuredContent validates against
 * each tool's outputSchema (the SDK client rejects mismatches).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createOuraMcpServer } from "./server.js";
import type { OuraClient } from "./client.js";
import { createMockOuraClient } from "../tests/helpers/mockOuraClient.js";

async function connect(ouraClient: unknown) {
  const server = createOuraMcpServer(ouraClient as OuraClient, "test");
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("MCP server (end to end)", () => {
  let client: Client;
  let mock: ReturnType<typeof createMockOuraClient>;

  beforeEach(async () => {
    mock = createMockOuraClient();
    client = await connect(mock);
  });

  afterEach(async () => {
    await client.close();
  });

  it("advertises title and read-only annotations on every tool", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(29);
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
  });

  it("declares output schemas on the main data tools", async () => {
    const { tools } = await client.listTools();
    const withSchema = tools.filter((t) => t.outputSchema).map((t) => t.name).sort();
    expect(withSchema).toEqual(["get_activity", "get_heart_rate", "get_readiness", "get_sleep"]);
  });

  it.each([
    ["get_sleep", "sessions"],
    ["get_readiness", "days"],
    ["get_activity", "days"],
    ["get_heart_rate", "overall"],
  ])("%s returns text plus valid structuredContent", async (name, key) => {
    const result = await client.callTool({ name, arguments: { start_date: "2024-01-15", end_date: "2024-01-15" } });
    expect(result.isError).toBeFalsy();
    expect((result.content as Array<{ type: string }>)[0].type).toBe("text");
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.start_date).toBe("2024-01-15");
    expect(structured[key]).toBeDefined();
  });

  it("heart rate structured output aggregates by source and day", async () => {
    const result = await client.callTool({ name: "get_heart_rate", arguments: { start_date: "2024-01-15" } });
    const s = result.structuredContent as {
      overall: { count: number; min_bpm: number; max_bpm: number };
      by_source: Record<string, { count: number }>;
      by_day: Record<string, { count: number }>;
    };
    expect(s.overall.count).toBe(6);
    expect(s.overall.min_bpm).toBeLessThanOrEqual(s.overall.max_bpm);
    const sourceTotal = Object.values(s.by_source).reduce((a, b) => a + b.count, 0);
    expect(sourceTotal).toBe(6);
    expect(Object.keys(s.by_day).every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
  });

  it("returns valid empty structured content when there is no data", async () => {
    const empty = { data: [] };
    mock.getSleep.mockResolvedValue(empty);
    mock.getDailySleep.mockResolvedValue(empty);
    mock.getDailyReadiness.mockResolvedValue(empty);
    for (const name of ["get_sleep", "get_readiness"]) {
      const result = await client.callTool({ name, arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
    }
  });

  it("marks API failures as isError (no structured content required)", async () => {
    mock.getDailyActivity.mockRejectedValue(new Error("boom"));
    const result = await client.callTool({ name: "get_activity", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it("reads every resource without error", async () => {
    const { resources } = await client.listResources();
    expect(resources.length).toBe(7);
    for (const r of resources) {
      const result = await client.readResource({ uri: r.uri });
      const first = result.contents[0] as { text?: string };
      expect(first.text, r.uri).toBeTruthy();
    }
  });

  it("reads every resource when Oura returns no data", async () => {
    for (const key of Object.keys(mock) as Array<keyof typeof mock>) {
      if (key.startsWith("get")) mock[key].mockResolvedValue({ data: [] });
    }
    const { resources } = await client.listResources();
    for (const r of resources) {
      const result = await client.readResource({ uri: r.uri });
      expect((result.contents[0] as { text?: string }).text, r.uri).toBeTruthy();
    }
  });

  it("renders every prompt", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.length).toBe(7);
    for (const p of prompts) {
      const args = Object.fromEntries((p.arguments ?? []).map((a) => [a.name, "alcohol"]));
      const result = await client.getPrompt({ name: p.name, arguments: args });
      expect(result.messages.length, p.name).toBeGreaterThan(0);
    }
  });
});
