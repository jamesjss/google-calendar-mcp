import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const validEnv = {
  NODE_ENV: "test",
  PUBLIC_BASE_URL: "https://mcp.example.com/",
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  JWT_SECRET: "x".repeat(32),
};

describe("loadConfig", () => {
  it("normalizes the public URL and defaults to Europe/Madrid", () => {
    const config = loadConfig(validEnv);
    expect(config.PUBLIC_BASE_URL).toBe("https://mcp.example.com");
    expect(config.DEFAULT_TIME_ZONE).toBe("Europe/Madrid");
  });

  it("rejects an encryption key with the wrong decoded length", () => {
    expect(() => loadConfig({ ...validEnv, TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }))
      .toThrow(/32 bytes/);
  });

  it("requires HTTPS in production", () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: "production", PUBLIC_BASE_URL: "http://example.com" }))
      .toThrow(/HTTPS/);
  });
});

