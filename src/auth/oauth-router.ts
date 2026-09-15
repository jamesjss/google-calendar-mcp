import { Router, type Request, type Response } from "express";
import { google, type Auth } from "googleapis";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { SecretBox, randomToken } from "../infrastructure/crypto.js";
import { Store, type RefreshGrant } from "../infrastructure/store.js";
import { SessionTokens } from "./session.js";

const MCP_SCOPES = ["calendar.read", "calendar.write"] as const;
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

const RegistrationSchema = z.object({
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  client_name: z.string().min(1).max(200).default("ChatGPT MCP client"),
  token_endpoint_auth_method: z.literal("none").default("none"),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).default(["authorization_code", "refresh_token"])
    .refine((values) => values.includes("authorization_code"), "authorization_code is required"),
  response_types: z.array(z.literal("code")).default(["code"]),
});

const AuthorizeSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  state: z.string().min(8),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  scope: z.string().default(MCP_SCOPES.join(" ")),
  resource: z.string().url().optional(),
});

function oauthError(res: Response, status: number, error: string, description: string) {
  res.status(status).json({ error, error_description: description });
}

function isAllowedRedirect(uri: string, allowlist: string[]): boolean {
  const url = new URL(uri);
  if (allowlist.length > 0) return allowlist.includes(url.origin);
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
}

export function createGoogleOAuthClient(config: AppConfig): Auth.OAuth2Client {
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    `${config.PUBLIC_BASE_URL}/oauth/google/callback`,
  );
}

export function createOAuthRouter(config: AppConfig, store: Store, box: SecretBox, sessions: SessionTokens): Router {
  const router = Router();
  const resource = `${config.PUBLIC_BASE_URL}/mcp`;

  const protectedResourceMetadata = (_req: Request, res: Response) => {
    res.json({
      resource,
      authorization_servers: [config.PUBLIC_BASE_URL],
      scopes_supported: MCP_SCOPES,
      bearer_methods_supported: ["header"],
    });
  };
  // RFC 9728 path-aware location plus the root alias used by older MCP clients.
  router.get("/.well-known/oauth-protected-resource/mcp", protectedResourceMetadata);
  router.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);

  router.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer: config.PUBLIC_BASE_URL,
      authorization_endpoint: `${config.PUBLIC_BASE_URL}/oauth/authorize`,
      token_endpoint: `${config.PUBLIC_BASE_URL}/oauth/token`,
      registration_endpoint: `${config.PUBLIC_BASE_URL}/oauth/register`,
      revocation_endpoint: `${config.PUBLIC_BASE_URL}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: MCP_SCOPES,
    });
  });

  router.post("/oauth/register", (req, res) => {
    const parsed = RegistrationSchema.safeParse(req.body);
    if (!parsed.success) return oauthError(res, 400, "invalid_client_metadata", parsed.error.message);
    if (parsed.data.redirect_uris.some((uri) => !isAllowedRedirect(uri, config.ALLOWED_REDIRECT_ORIGINS))) {
      return oauthError(res, 400, "invalid_redirect_uri", "A redirect URI origin is not allowed");
    }
    const clientId = randomToken(24);
    store.putClient({ clientId, clientName: parsed.data.client_name, redirectUris: parsed.data.redirect_uris });
    res.status(201).json({
      client_id: clientId,
      client_name: parsed.data.client_name,
      redirect_uris: parsed.data.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  router.get("/oauth/authorize", (req, res) => {
    const parsed = AuthorizeSchema.safeParse(req.query);
    if (!parsed.success) return oauthError(res, 400, "invalid_request", parsed.error.message);
    const request = parsed.data;
    const client = store.getClient(request.client_id);
    if (!client || !client.redirectUris.includes(request.redirect_uri)) {
      return oauthError(res, 400, "invalid_client", "Unknown client or redirect URI");
    }
    const requestedScopes = request.scope.split(/\s+/).filter(Boolean);
    if (requestedScopes.some((scope) => !MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number]))) {
      return oauthError(res, 400, "invalid_scope", "Only calendar.read and calendar.write are supported");
    }
    if (request.resource && request.resource !== resource) {
      return oauthError(res, 400, "invalid_target", "The requested resource does not match this MCP server");
    }
    const grantId = randomToken();
    store.putPendingGrant(grantId, {
      id: grantId,
      clientId: request.client_id,
      redirectUri: request.redirect_uri,
      clientState: request.state,
      codeChallenge: request.code_challenge,
      scope: requestedScopes.join(" ") || MCP_SCOPES.join(" "),
      resource,
      expiresAt: Date.now() + config.OAUTH_STATE_TTL_SECONDS * 1000,
    });
    const googleClient = createGoogleOAuthClient(config);
    res.redirect(googleClient.generateAuthUrl({
      access_type: "offline",
      include_granted_scopes: true,
      prompt: "consent",
      scope: [...GOOGLE_SCOPES],
      state: grantId,
    }));
  });

  router.get("/oauth/google/callback", async (req, res) => {
    try {
      const state = z.string().min(1).parse(req.query.state);
      const code = z.string().min(1).parse(req.query.code);
      const grant = store.takePendingGrant(state);
      if (!grant) return oauthError(res, 400, "invalid_grant", "Authorization request expired or was already used");
      const googleClient = createGoogleOAuthClient(config);
      const { tokens } = await googleClient.getToken(code);
      googleClient.setCredentials(tokens);
      const userInfo = await google.oauth2({ version: "v2", auth: googleClient }).userinfo.get();
      if (!userInfo.data.id || !userInfo.data.email) throw new Error("Google did not return an account identity");
      if (config.ALLOWED_GOOGLE_EMAILS.length > 0 && !config.ALLOWED_GOOGLE_EMAILS.includes(userInfo.data.email.toLocaleLowerCase("en"))) {
        throw new Error("This Google account is not allowed to use the server");
      }
      const previousEncrypted = store.getGoogleCredentials(userInfo.data.id);
      const previous = previousEncrypted ? box.decrypt<Auth.Credentials>(previousEncrypted) : undefined;
      const merged = { ...previous, ...tokens, refresh_token: tokens.refresh_token ?? previous?.refresh_token };
      if (!merged.refresh_token) throw new Error("Google did not issue a refresh token; revoke the app grant and reconnect");
      store.putGoogleAccount(userInfo.data.id, userInfo.data.email, box.encrypt(merged));

      const authorizationCode = randomToken();
      store.putAuthorizationCode(authorizationCode, {
        subject: userInfo.data.id,
        clientId: grant.clientId,
        redirectUri: grant.redirectUri,
        codeChallenge: grant.codeChallenge,
        scope: grant.scope,
      }, Date.now() + 5 * 60_000);
      const callback = new URL(grant.redirectUri);
      callback.searchParams.set("code", authorizationCode);
      callback.searchParams.set("state", grant.clientState);
      res.redirect(callback.toString());
    } catch (error) {
      oauthError(res, 400, "invalid_grant", error instanceof Error ? error.message : "Google authorization failed");
    }
  });

  router.post("/oauth/token", async (req: Request, res: Response) => {
    try {
      const grantType = z.string().parse(req.body.grant_type);
      let grant: RefreshGrant;
      if (grantType === "authorization_code") {
        const body = z.object({
          code: z.string(), client_id: z.string(), redirect_uri: z.string().url(), code_verifier: z.string().min(43).max(128),
        }).parse(req.body);
        const codeGrant = store.consumeAuthorizationCode(body.code, body.client_id, body.redirect_uri, body.code_verifier);
        if (!codeGrant) {
          return oauthError(res, 400, "invalid_grant", "Authorization code or PKCE verifier is invalid");
        }
        grant = { subject: codeGrant.subject, clientId: codeGrant.clientId, scope: codeGrant.scope };
      } else if (grantType === "refresh_token") {
        const body = z.object({ refresh_token: z.string(), client_id: z.string() }).parse(req.body);
        const refreshed = store.rotateRefreshToken(body.refresh_token, body.client_id);
        if (!refreshed) {
          return oauthError(res, 400, "invalid_grant", "Refresh token is invalid or expired");
        }
        grant = refreshed;
      } else {
        return oauthError(res, 400, "unsupported_grant_type", "Use authorization_code or refresh_token");
      }
      const refreshToken = randomToken();
      store.putRefreshToken(refreshToken, grant, Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
      res.set("Cache-Control", "no-store").json({
        access_token: await sessions.issueAccessToken(grant),
        token_type: "Bearer",
        expires_in: config.ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: refreshToken,
        scope: grant.scope,
      });
    } catch (error) {
      oauthError(res, 400, "invalid_request", error instanceof Error ? error.message : "Invalid token request");
    }
  });

  router.post("/oauth/revoke", (req, res) => {
    const parsed = z.object({ token: z.string() }).safeParse(req.body);
    if (parsed.success) store.revokeRefreshToken(parsed.data.token);
    res.status(200).end();
  });

  return router;
}
