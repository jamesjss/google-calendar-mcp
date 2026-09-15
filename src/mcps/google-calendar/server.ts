import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import type { Env, AuthProps } from "../../platform/env.js";
import { SecretBox } from "../../platform/crypto.js";
import { D1Store } from "../../platform/d1-store.js";
import { CalendarService } from "./application/calendar-service.js";
import { GoogleCalendarGateway, GoogleTokenManager } from "./google-calendar-gateway.js";
import { registerCalendarTools } from "./tools.js";

export async function createGoogleCalendarServer(env: Env): Promise<McpServer> {
  const auth = getMcpAuthContext();
  const props = auth?.props as Partial<AuthProps> | undefined;
  if (!props?.subject || props.mcpSlug !== "google-calendar") throw new Error("Invalid Google Calendar authorization context");
  const store = new D1Store(env.DB, await SecretBox.fromBase64(env.TOKEN_ENCRYPTION_KEY));
  const service = new CalendarService(new GoogleCalendarGateway(new GoogleTokenManager(env, store, props.subject)));
  const scopes = Array.isArray(props.scopes) ? props.scopes : [];
  const server = new McpServer({ name: "google-calendar-mcp", version: "1.0.0" });
  registerCalendarTools(server, service, scopes);
  return server;
}
