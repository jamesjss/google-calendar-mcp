import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { type Auth } from "googleapis";
import { loadConfig, type AppConfig } from "./config.js";
import { GoogleCalendarGateway } from "./adapters/google-calendar-gateway.js";
import { CalendarService } from "./application/calendar-service.js";
import { createGoogleOAuthClient, createOAuthRouter } from "./auth/oauth-router.js";
import { SessionTokens } from "./auth/session.js";
import { SecretBox } from "./infrastructure/crypto.js";
import { Store } from "./infrastructure/store.js";
import { handleMcpRequest } from "./mcp/server.js";

type AuthenticatedRequest = Request & { mcpAuth?: { subject: string; clientId: string; scope: string } };

export function createApp(config: AppConfig, store = new Store(config.DATABASE_PATH)) {
  const app = express();
  const box = new SecretBox(config.TOKEN_ENCRYPTION_KEY);
  const sessions = new SessionTokens(config);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    });
    next();
  });
  app.use(createOAuthRouter(config, store, box, sessions));
  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

  const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const match = req.header("authorization")?.match(/^Bearer (.+)$/i);
    if (!match?.[1]) return unauthorized(res, config);
    try {
      req.mcpAuth = await sessions.verifyAccessToken(match[1]);
      next();
    } catch {
      unauthorized(res, config);
    }
  };

  app.all("/mcp", authenticate, async (req: AuthenticatedRequest, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
      return;
    }
    const auth = req.mcpAuth!;
    const account = store.getGoogleAccount(auth.subject);
    if (!account) return unauthorized(res, config);
    const credentials = box.decrypt<Auth.Credentials>(account.encryptedCredentials);
    const googleAuth = createGoogleOAuthClient(config);
    googleAuth.setCredentials(credentials);
    googleAuth.on("tokens", (newTokens) => {
      Object.assign(credentials, newTokens);
      store.putGoogleAccount(auth.subject, account.email, box.encrypt(credentials));
    });
    const service = new CalendarService(new GoogleCalendarGateway(googleAuth));
    try {
      await handleMcpRequest(req, res, service, auth.scope);
    } catch (error) {
      console.error("MCP request failed", error instanceof Error ? error.message : "unknown error");
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  return app;
}

function unauthorized(res: Response, config: AppConfig) {
  res.set("WWW-Authenticate", `Bearer resource_metadata="${config.PUBLIC_BASE_URL}/.well-known/oauth-protected-resource/mcp", scope="calendar.read calendar.write"`);
  return res.status(401).json({ error: "unauthorized", error_description: "A valid MCP access token is required" });
}

if (process.env.NODE_ENV !== "test") {
  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.PORT, config.HOST, () => {
    console.log(`Google Calendar MCP listening on ${config.HOST}:${config.PORT}`);
  });
}
