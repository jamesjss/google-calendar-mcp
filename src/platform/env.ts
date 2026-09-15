import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface AuthProps {
  provider: "google";
  subject: string;
  email: string;
  mcpSlug: string;
  scopes: string[];
}

export interface Env {
  OAUTH_KV: KVNamespace;
  DB: D1Database;
  OAUTH_PROVIDER: OAuthHelpers;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  ALLOWED_GOOGLE_EMAILS?: string;
}

export function allowedGoogleEmails(env: Env): Set<string> {
  return new Set((env.ALLOWED_GOOGLE_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
}
