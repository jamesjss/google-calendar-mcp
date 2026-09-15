import { hashToken, SecretBox } from "./crypto.js";

export interface GoogleCredentials {
  access_token?: string;
  refresh_token: string;
  expires_at?: number;
  scope?: string;
  token_type?: string;
}

export interface GoogleAccount {
  subject: string;
  email: string;
  credentials: GoogleCredentials;
}

export class D1Store {
  constructor(private readonly db: D1Database, private readonly box: SecretBox) {}

  async putPending<T>(kind: string, token: string, mcpSlug: string, payload: T, expiresAt: number): Promise<void> {
    await this.db.prepare(`INSERT INTO oauth_handoffs(token_hash, kind, mcp_slug, encrypted_payload, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(await hashToken(token), kind, mcpSlug, await this.box.encrypt(payload), expiresAt, Date.now()).run();
  }

  async takePending<T>(kind: string, token: string): Promise<{ mcpSlug: string; payload: T } | undefined> {
    const row = await this.db.prepare(`DELETE FROM oauth_handoffs WHERE token_hash = ? AND kind = ?
      RETURNING mcp_slug, encrypted_payload, expires_at`).bind(await hashToken(token), kind)
      .first<{ mcp_slug: string; encrypted_payload: string; expires_at: number }>();
    if (!row || row.expires_at <= Date.now()) return undefined;
    return { mcpSlug: row.mcp_slug, payload: await this.box.decrypt<T>(row.encrypted_payload) };
  }

  async putGoogleAccount(account: GoogleAccount, mcpSlug: string): Promise<void> {
    await this.db.prepare(`INSERT INTO connected_accounts(provider, subject, mcp_slug, email, encrypted_credentials, updated_at)
      VALUES ('google', ?, ?, ?, ?, ?) ON CONFLICT(provider, subject, mcp_slug) DO UPDATE SET
      email=excluded.email, encrypted_credentials=excluded.encrypted_credentials, updated_at=excluded.updated_at`)
      .bind(account.subject, mcpSlug, account.email, await this.box.encrypt(account.credentials), Date.now()).run();
  }

  async getGoogleAccount(subject: string, mcpSlug: string): Promise<GoogleAccount | undefined> {
    const row = await this.db.prepare(`SELECT email, encrypted_credentials FROM connected_accounts
      WHERE provider = 'google' AND subject = ? AND mcp_slug = ?`).bind(subject, mcpSlug)
      .first<{ email: string; encrypted_credentials: string }>();
    if (!row) return undefined;
    return { subject, email: row.email, credentials: await this.box.decrypt<GoogleCredentials>(row.encrypted_credentials) };
  }

  async cleanupExpired(now = Date.now()): Promise<void> {
    await this.db.prepare("DELETE FROM oauth_handoffs WHERE expires_at <= ?").bind(now).run();
  }
}
