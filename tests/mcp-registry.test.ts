import { describe, expect, it } from "vitest";
import { MCP_REGISTRY, mcpByPath, mcpByResource } from "../src/platform/mcp-registry.js";

describe("multi-MCP registry", () => {
  it("assigns Google Calendar its stable route", () => { expect(MCP_REGISTRY["google-calendar"].route).toBe("/mcp/google-calendar"); });
  it("matches only an exact registered path", () => {
    expect(mcpByPath("/mcp/google-calendar")?.slug).toBe("google-calendar");
    expect(mcpByPath("/mcp/google-calendar/other")).toBeUndefined();
  });
  it("resolves a path-aware OAuth resource", () => {
    expect(mcpByResource("https://example.workers.dev/mcp/google-calendar")?.slug).toBe("google-calendar");
    expect(mcpByResource("https://example.workers.dev/mcp/unknown")).toBeUndefined();
  });
});
