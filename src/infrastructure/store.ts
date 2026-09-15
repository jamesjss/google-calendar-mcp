import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { hashToken, verifyPkce } from "./crypto.js";

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

export interface PendingGrant {
  id: string;
  clientId: string;
  redirectUri: string;
  clientState: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  expiresAt: number;
}

export interface AuthorizationCode extends Omit<PendingGrant, "id" | "clientState" | "resource" | "expiresAt"> {
  subject: string;
}

export interface RefreshGrant {
  subject: string;
  clientId: string;
  scope: string;
}

export class Store {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close() { this.db.close(); }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY, client_name TEXT NOT NULL,
        redirect_uris TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_grants (
        id_hash TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS google_accounts (
        subject TEXT PRIMARY KEY, email TEXT NOT NULL,
        encrypted_credentials TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS authorization_codes (
        code_hash TEXT PRIMARY KEY, payload TEXT NOT NULL,
        expires_at INTEGER NOT NULL, used_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        token_hash TEXT PRIMARY KEY, payload TEXT NOT NULL,
        expires_at INTEGER NOT NULL, revoked_at INTEGER
      );
    `);
  }

  putClient(client: OAuthClient) {
    this.db.prepare(`INSERT INTO oauth_clients(client_id, client_name, redirect_uris, created_at)
      VALUES (?, ?, ?, ?)`).run(client.clientId, client.clientName, JSON.stringify(client.redirectUris), Date.now());
  }

  getClient(clientId: string): OAuthClient | undefined {
    const row = this.db.prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId) as any;
    return row ? { clientId: row.client_id, clientName: row.client_name, redirectUris: JSON.parse(row.redirect_uris) } : undefined;
  }

  putPendingGrant(token: string, grant: PendingGrant) {
    this.db.prepare("INSERT INTO pending_grants(id_hash, payload, expires_at) VALUES (?, ?, ?)")
      .run(hashToken(token), JSON.stringify(grant), grant.expiresAt);
  }

  takePendingGrant(token: string): PendingGrant | undefined {
    return this.takeOneTime<PendingGrant>("pending_grants", "id_hash", hashToken(token));
  }

  putGoogleAccount(subject: string, email: string, encryptedCredentials: string) {
    this.db.prepare(`INSERT INTO google_accounts(subject, email, encrypted_credentials, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(subject) DO UPDATE SET
      email=excluded.email, encrypted_credentials=excluded.encrypted_credentials, updated_at=excluded.updated_at`)
      .run(subject, email, encryptedCredentials, Date.now());
  }

  getGoogleCredentials(subject: string): string | undefined {
    const row = this.db.prepare("SELECT encrypted_credentials FROM google_accounts WHERE subject = ?").get(subject) as any;
    return row?.encrypted_credentials;
  }

  getGoogleAccount(subject: string): { email: string; encryptedCredentials: string } | undefined {
    const row = this.db.prepare("SELECT email, encrypted_credentials FROM google_accounts WHERE subject = ?").get(subject) as any;
    return row ? { email: row.email, encryptedCredentials: row.encrypted_credentials } : undefined;
  }

  putAuthorizationCode(code: string, grant: AuthorizationCode, expiresAt: number) {
    this.db.prepare("INSERT INTO authorization_codes(code_hash, payload, expires_at) VALUES (?, ?, ?)")
      .run(hashToken(code), JSON.stringify(grant), expiresAt);
  }

  consumeAuthorizationCode(code: string, clientId: string, redirectUri: string, verifier: string): AuthorizationCode | undefined {
    const key = hashToken(code);
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare("SELECT payload, expires_at, used_at FROM authorization_codes WHERE code_hash = ?").get(key) as any;
      if (!row || row.used_at || row.expires_at <= Date.now()) return undefined;
      const grant = JSON.parse(row.payload) as AuthorizationCode;
      if (grant.clientId !== clientId || grant.redirectUri !== redirectUri || !verifyPkce(verifier, grant.codeChallenge)) return undefined;
      this.db.prepare("UPDATE authorization_codes SET used_at = ? WHERE code_hash = ?").run(Date.now(), key);
      return grant;
    });
    return transaction();
  }

  putRefreshToken(token: string, grant: RefreshGrant, expiresAt: number) {
    this.db.prepare("INSERT INTO refresh_tokens(token_hash, payload, expires_at) VALUES (?, ?, ?)")
      .run(hashToken(token), JSON.stringify(grant), expiresAt);
  }

  rotateRefreshToken(token: string, clientId: string): RefreshGrant | undefined {
    const key = hashToken(token);
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare("SELECT payload, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?").get(key) as any;
      if (!row || row.revoked_at || row.expires_at <= Date.now()) return undefined;
      const grant = JSON.parse(row.payload) as RefreshGrant;
      if (grant.clientId !== clientId) return undefined;
      this.db.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?").run(Date.now(), key);
      return grant;
    });
    return transaction();
  }

  revokeRefreshToken(token: string) {
    this.db.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?").run(Date.now(), hashToken(token));
  }

  private takeOneTime<T>(table: "pending_grants", keyColumn: "id_hash", key: string): T | undefined {
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT payload, expires_at FROM ${table} WHERE ${keyColumn} = ?`).get(key) as any;
      this.db.prepare(`DELETE FROM ${table} WHERE ${keyColumn} = ?`).run(key);
      if (!row || row.expires_at <= Date.now()) return undefined;
      return JSON.parse(row.payload) as T;
    });
    return transaction();
  }
}
