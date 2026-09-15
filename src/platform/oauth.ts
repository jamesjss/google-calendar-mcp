import { AuthorizationError, type AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env, AuthProps } from "./env.js";
import { allowedGoogleEmails } from "./env.js";
import { constantTimeEqual, randomToken, SecretBox } from "./crypto.js";
import { D1Store, type GoogleCredentials } from "./d1-store.js";
import { mcpByResource } from "./mcp-registry.js";

const GOOGLE_SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;
const HANDOFF_TTL_MS = 10 * 60_000;

interface ApprovalPayload { oauthRequest: AuthRequest; clientName: string }

export const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/healthz") return json({ status: "ok", mcps: ["/mcp/google-calendar"] });
      if (url.pathname === "/") return new Response("MCP platform is running", { headers: securityHeaders("text/plain; charset=utf-8") });
      if (url.pathname === "/authorize" && request.method === "GET") return beginConsent(request, env);
      if (url.pathname === "/authorize/approve" && request.method === "POST") return approveConsent(request, env);
      if (url.pathname === "/oauth/google/callback" && request.method === "GET") return finishGoogleAuthorization(request, env);
      return new Response("Not found", { status: 404, headers: securityHeaders("text/plain; charset=utf-8") });
    } catch (error) {
      console.error("Request failed", error instanceof Error ? error.message : "unknown error");
      return json({ error: "request_failed", error_description: "The authorization request could not be completed" }, 400);
    }
  },
};

async function services(env: Env) {
  const box = await SecretBox.fromBase64(env.TOKEN_ENCRYPTION_KEY);
  return { store: new D1Store(env.DB, box) };
}

async function beginConsent(request: Request, env: Env): Promise<Response> {
  let oauthRequest: AuthRequest;
  try { oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request); }
  catch (error) { return authorizationError(error); }
  const definition = mcpByResource(oauthRequest.resource);
  if (!definition) return new Response("Unknown or missing MCP resource", { status: 400 });
  const resources = oauthRequest.resource ? (Array.isArray(oauthRequest.resource) ? oauthRequest.resource : [oauthRequest.resource]) : [];
  if (resources.some((resource) => new URL(resource).origin !== new URL(request.url).origin)) return new Response("MCP resource origin does not match this server", { status: 400 });
  const requestedScopes = oauthRequest.scope.length ? oauthRequest.scope : [...definition.scopes];
  if (requestedScopes.some((scope) => !definition.scopes.includes(scope as never))) return new Response("Unsupported scope", { status: 400 });
  oauthRequest = { ...oauthRequest, scope: requestedScopes };
  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  if (!client) return new Response("Unknown OAuth client", { status: 400 });
  const csrf = randomToken();
  const approval = randomToken();
  const { store } = await services(env);
  await store.putPending<ApprovalPayload>("approval", approval, definition.slug, { oauthRequest, clientName: client.clientName ?? "ChatGPT" }, Date.now() + HANDOFF_TTL_MS);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Autorizar ${escapeHtml(definition.title)}</title>
    <style>body{font:16px system-ui;max-width:620px;margin:10vh auto;padding:24px;color:#17202a}button{background:#176b4d;color:white;border:0;border-radius:8px;padding:12px 18px;font-weight:650}li{margin:.5rem 0}.card{border:1px solid #d8dee4;border-radius:14px;padding:24px}</style>
    <div class="card"><h1>Conectar ${escapeHtml(definition.title)}</h1><p><strong>${escapeHtml(client.clientName ?? "ChatGPT")}</strong> solicita usar este MCP con tu cuenta de Google.</p>
    <ul>${requestedScopes.map((scope) => `<li>${scope.endsWith(".write") ? "Crear, modificar y borrar eventos" : "Leer calendarios y eventos"}</li>`).join("")}</ul>
    <p>Los tokens de Google se guardarán cifrados y nunca se entregarán a ChatGPT.</p><form method="post" action="/authorize/approve">
    <input type="hidden" name="approval" value="${escapeHtml(approval)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit">Continuar con Google</button></form></div></html>`;
  return new Response(html, { headers: { ...securityHeaders("text/html; charset=utf-8"), "Set-Cookie": `mcp_csrf=${csrf}; HttpOnly; SameSite=Lax; Path=/authorize; Max-Age=600${secure}` } });
}

async function approveConsent(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const approval = String(form.get("approval") ?? "");
  const csrf = String(form.get("csrf") ?? "");
  const cookie = request.headers.get("Cookie")?.match(/(?:^|;\s*)mcp_csrf=([^;]+)/)?.[1] ?? "";
  if (!approval || !csrf || !constantTimeEqual(csrf, cookie)) return new Response("Consent form expired", { status: 400 });
  const { store } = await services(env);
  const pending = await store.takePending<ApprovalPayload>("approval", approval);
  if (!pending) return new Response("Consent form expired", { status: 400 });
  const definition = mcpByResource(pending.payload.oauthRequest.resource);
  if (!definition || definition.slug !== pending.mcpSlug) return new Response("Invalid MCP resource", { status: 400 });
  const state = randomToken();
  await store.putPending("google", state, definition.slug, pending.payload, Date.now() + HANDOFF_TTL_MS);
  const redirectUri = `${new URL(request.url).origin}/oauth/google/callback`;
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "true", scope: GOOGLE_SCOPES.join(" "), state }).toString();
  return new Response(null, { status: 302, headers: { Location: google.toString(), "Set-Cookie": "mcp_csrf=; HttpOnly; SameSite=Lax; Path=/authorize; Max-Age=0" } });
}

async function finishGoogleAuthorization(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code) return new Response("Google authorization was cancelled or invalid", { status: 400 });
  const { store } = await services(env);
  const pending = await store.takePending<ApprovalPayload>("google", state);
  if (!pending) return new Response("Authorization request expired or was already used", { status: 400 });
  const definition = mcpByResource(pending.payload.oauthRequest.resource);
  if (!definition || definition.slug !== pending.mcpSlug) return new Response("Invalid MCP resource", { status: 400 });
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${url.origin}/oauth/google/callback`, grant_type: "authorization_code" }),
  });
  const tokens = await tokenResponse.json<Partial<GoogleCredentials> & { expires_in?: number }>();
  if (!tokenResponse.ok || !tokens.access_token) throw new Error("Google token exchange failed");
  const identityResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const identity = await identityResponse.json<{ sub?: string; email?: string }>();
  if (!identityResponse.ok || !identity.sub || !identity.email) throw new Error("Google identity lookup failed");
  const allowed = allowedGoogleEmails(env);
  if (allowed.size && !allowed.has(identity.email.toLowerCase())) return new Response("This Google account is not allowed", { status: 403 });
  const previous = await store.getGoogleAccount(identity.sub, definition.slug);
  const refreshToken = tokens.refresh_token ?? previous?.credentials.refresh_token;
  if (!refreshToken) throw new Error("Google did not issue a refresh token; revoke the previous grant and reconnect");
  await store.putGoogleAccount({ subject: identity.sub, email: identity.email, credentials: {
    ...previous?.credentials, ...tokens, refresh_token: refreshToken, expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  } }, definition.slug);
  const scopes = pending.payload.oauthRequest.scope.filter((scope) => definition.scopes.includes(scope as never));
  const props: AuthProps = { provider: "google", subject: identity.sub, email: identity.email, mcpSlug: definition.slug, scopes };
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: pending.payload.oauthRequest, userId: `google-${identity.sub}`, metadata: { clientName: pending.payload.clientName, email: identity.email, mcpSlug: definition.slug }, scope: scopes, props,
  });
  return Response.redirect(redirectTo, 302);
}

function authorizationError(error: unknown): Response {
  if (!(error instanceof AuthorizationError)) throw error;
  if (!error.redirectUri) return new Response(error.description, { status: 400 });
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set("error", error.code);
  redirect.searchParams.set("error_description", error.description);
  if (error.state) redirect.searchParams.set("state", error.state);
  if (error.issuer) redirect.searchParams.set("iss", error.issuer);
  return Response.redirect(redirect, 302);
}

function securityHeaders(contentType: string): Record<string, string> {
  return { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" };
}
function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers: securityHeaders("application/json; charset=utf-8") }); }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!); }
