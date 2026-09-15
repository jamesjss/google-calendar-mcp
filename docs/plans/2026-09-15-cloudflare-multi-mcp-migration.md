# Cloudflare Multi-MCP Migration Implementation Plan

> Execute task-by-task within the authorized scope, preserving applicable explicit approvals.

**Goal:** Run Google Calendar MCP natively on Cloudflare Workers Free with D1, while establishing reusable routing and infrastructure for future MCP services.

**Architecture:** Keep domain rules and application services framework-independent, place each MCP under `src/mcps/<service>`, and route stable resource URLs through a shared registry. Cloudflare provides the fetch runtime and secrets; KV stores the OAuth clients, grants, and rotating tokens managed by the Workers OAuth Provider, while D1 stores encrypted upstream credentials and short-lived authorization handoffs. `/mcp/google-calendar` is the first registered resource and future MCPs receive sibling paths.

**Tech Stack:** TypeScript, Cloudflare Workers, Cloudflare Agents MCP handler, Workers OAuth Provider, D1, Web Crypto, direct Google Calendar REST calls, Vitest, Wrangler.

---

### Task 1: Define stable multi-MCP routes

**Files:**
- Create: `src/platform/mcp-registry.ts`
- Test: `tests/mcp-registry.test.ts`
- Modify: `README.md`

**Steps:**
1. Write failing tests for `/mcp/google-calendar`, unknown MCP paths, and path-aware OAuth resource metadata.
2. Implement a registry whose entries own slug, title, scopes, and server factory.
3. Make route selection exact so a future MCP cannot inherit another MCP's credentials or tools.
4. Document the naming convention `/mcp/<stable-slug>`.

### Task 2: Replace Node persistence with KV + D1

**Files:**
- Create: `migrations/0001_oauth.sql`
- Create: `src/platform/d1-store.ts`
- Create: `src/platform/store-port.ts`
- Test: `tests/d1-store.test.ts`

**Steps:**
1. Delegate MCP client, grant, authorization-code, access-token, and rotating refresh-token storage to the official OAuth Provider KV binding.
2. Store only encrypted Google credentials and short-lived upstream authorization handoffs in D1.
3. Add an `mcp_slug` column to shared D1 records for isolation.
4. Implement atomic one-time handoff consumption and expiry indexes.

### Task 3: Use Worker-compatible cryptography and sessions

**Files:**
- Create: `src/platform/crypto.ts`
- Create: `src/platform/session.ts`
- Test: `tests/worker-crypto.test.ts`

**Steps:**
1. Write failing tests for AES-GCM encryption, S256 PKCE, hashed opaque tokens, and signed short-lived access tokens.
2. Implement all operations with Web Crypto and no Node native APIs.
3. Bind access tokens to a specific MCP resource URL and client ID.

### Task 4: Replace the Google Node SDK with REST fetch

**Files:**
- Create: `src/mcps/google-calendar/google-calendar-gateway.ts`
- Move: domain/application/tool code under `src/mcps/google-calendar/`
- Test: `tests/google-calendar-fetch-gateway.test.ts`

**Steps:**
1. Write failing fetch-mock tests for OAuth refresh, calendar pagination, event pagination, CRUD, ETags, and Google error mapping.
2. Implement direct calls to Google OAuth and Calendar v3.
3. Persist rotated Google credentials encrypted in D1.
4. Re-run existing calendar domain and service tests unchanged in behavior.

### Task 5: Implement Cloudflare OAuth and MCP transport

**Files:**
- Create: `src/worker.ts`
- Create: `src/platform/oauth.ts`
- Create: `src/mcps/google-calendar/server.ts`
- Test: `tests/worker-routes.test.ts`

**Steps:**
1. Write failing tests for discovery endpoints, DCR, authorization routing, token exchange, bearer rejection, and `/mcp/google-calendar` tool discovery.
2. Implement OAuth 2.1 discovery and resource-specific authorization with Google as upstream identity/provider.
3. Serve stateless Streamable HTTP through the Cloudflare MCP handler.
4. Preserve read/write annotations and per-token scope checks.

### Task 6: Configure local and remote Cloudflare environments

**Files:**
- Create: `wrangler.jsonc`
- Create: `.dev.vars.example`
- Modify: `package.json`
- Modify: `.gitignore`
- Remove: `Dockerfile`
- Remove: `docker-compose.yml`
- Remove: `render.yaml`

**Steps:**
1. Configure a D1 binding named `DB` and Worker entrypoint.
2. Add commands for local migration, local development, remote migration, secret upload, deployment, and log tailing.
3. Keep local secrets out of Git and list every required secret in the example file.
4. Remove obsolete Node-server deployment manifests so documentation has one supported path.

### Task 7: Update documentation and verify

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEPLOYMENT.md`

**Steps:**
1. Document the stable ChatGPT endpoint `/mcp/google-calendar` and future MCP registration workflow.
2. Document Workers Free/D1 assumptions, Google callback URLs, secrets, and custom-domain migration.
3. Run type checking, all unit/Worker integration tests, and a production Worker dry-run.
4. Audit the Git diff for secrets and obsolete `/mcp` or Render instructions.
5. Commit and push the Cloudflare migration to `main`.
