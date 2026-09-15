import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { createOAuthRouter } from "../src/auth/oauth-router.js";
import { SessionTokens } from "../src/auth/session.js";
import { SecretBox } from "../src/infrastructure/crypto.js";
import { Store } from "../src/infrastructure/store.js";

const config: AppConfig = {
  NODE_ENV: "test", PUBLIC_BASE_URL: "https://mcp.example.com", HOST: "127.0.0.1", PORT: 3000, DEFAULT_TIME_ZONE: "Europe/Madrid",
  GOOGLE_CLIENT_ID: "google-client", GOOGLE_CLIENT_SECRET: "google-secret",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1), JWT_SECRET: "s".repeat(32), DATABASE_PATH: ":memory:",
  ACCESS_TOKEN_TTL_SECONDS: 900, REFRESH_TOKEN_TTL_DAYS: 30, OAUTH_STATE_TTL_SECONDS: 600,
  ALLOWED_REDIRECT_ORIGINS: ["https://chatgpt.com"],
  ALLOWED_GOOGLE_EMAILS: [],
};

function fixture() {
  const store = new Store(":memory:");
  const app = express();
  app.use(express.json()); app.use(express.urlencoded({ extended: false }));
  app.use(createOAuthRouter(config, store, new SecretBox(config.TOKEN_ENCRYPTION_KEY), new SessionTokens(config)));
  return { app, store };
}

describe("MCP OAuth server", () => {
  it("publishes protected resource and authorization server metadata", async () => {
    const { app } = fixture();
    const resource = await request(app).get("/.well-known/oauth-protected-resource/mcp").expect(200);
    expect(resource.body.resource).toBe("https://mcp.example.com/mcp");
    const issuer = await request(app).get("/.well-known/oauth-authorization-server").expect(200);
    expect(issuer.body.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("registers only allowlisted redirect origins", async () => {
    const { app } = fixture();
    const ok = await request(app).post("/oauth/register").send({
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"], client_name: "ChatGPT",
    }).expect(201);
    expect(ok.body.client_id).toBeTruthy();
    await request(app).post("/oauth/register").send({ redirect_uris: ["https://evil.example/callback"] }).expect(400);
  });

  it("exchanges a one-time authorization code and rotates refresh tokens", async () => {
    const { app, store } = fixture();
    const verifier = "a".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    store.putAuthorizationCode("one-time-code", {
      subject: "google-user", clientId: "chatgpt-client", redirectUri: "https://chatgpt.com/callback",
      codeChallenge: challenge, scope: "calendar.read calendar.write",
    }, Date.now() + 60_000);
    await request(app).post("/oauth/token").type("form").send({
      grant_type: "authorization_code", code: "one-time-code", client_id: "chatgpt-client",
      redirect_uri: "https://chatgpt.com/callback", code_verifier: "z".repeat(64),
    }).expect(400);
    const first = await request(app).post("/oauth/token").type("form").send({
      grant_type: "authorization_code", code: "one-time-code", client_id: "chatgpt-client",
      redirect_uri: "https://chatgpt.com/callback", code_verifier: verifier,
    }).expect(200);
    expect(first.body.access_token).toBeTruthy();
    expect(first.body.refresh_token).toBeTruthy();
    await request(app).post("/oauth/token").type("form").send({
      grant_type: "authorization_code", code: "one-time-code", client_id: "chatgpt-client",
      redirect_uri: "https://chatgpt.com/callback", code_verifier: verifier,
    }).expect(400);
    const rotated = await request(app).post("/oauth/token").type("form").send({
      grant_type: "refresh_token", refresh_token: first.body.refresh_token, client_id: "chatgpt-client",
    }).expect(200);
    expect(rotated.body.refresh_token).not.toBe(first.body.refresh_token);
    await request(app).post("/oauth/token").type("form").send({
      grant_type: "refresh_token", refresh_token: first.body.refresh_token, client_id: "chatgpt-client",
    }).expect(400);
  });
});
