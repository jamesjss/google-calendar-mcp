CREATE TABLE IF NOT EXISTS connected_accounts (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  mcp_slug TEXT NOT NULL,
  email TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject, mcp_slug)
);

CREATE TABLE IF NOT EXISTS oauth_handoffs (
  token_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  mcp_slug TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (token_hash, kind)
);

CREATE INDEX IF NOT EXISTS oauth_handoffs_expires_at ON oauth_handoffs(expires_at);
