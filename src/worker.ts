import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import type { Env } from "./platform/env.js";
import { ALL_MCP_SCOPES, MCP_REGISTRY } from "./platform/mcp-registry.js";
import { defaultHandler } from "./platform/oauth.js";
import { createGoogleCalendarServer } from "./mcps/google-calendar/server.js";

const googleCalendarHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return createMcpHandler(() => createGoogleCalendarServer(env), {
      route: MCP_REGISTRY["google-calendar"].route,
      corsOptions: false,
    })(request, env, ctx);
  },
};

export default new OAuthProvider<Env>({
  apiHandlers: { [MCP_REGISTRY["google-calendar"].route]: googleCalendarHandler },
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: ALL_MCP_SCOPES,
  resourceMetadata: {
    scopes_supported: ALL_MCP_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Personal MCP platform",
  },
  accessTokenTTL: 3600,
  refreshTokenTTL: 30 * 24 * 60 * 60,
});
