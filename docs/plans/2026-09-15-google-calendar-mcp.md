# Google Calendar MCP Implementation Plan

> Execute task-by-task within the authorized scope, preserving applicable explicit approvals.

**Goal:** Build a secure remote MCP server for ChatGPT web that can list calendars and create, read, update, and delete timed or all-day Google Calendar events.

**Architecture:** Use a small hexagonal design: pure validation and duplicate-detection rules in the domain layer, application services depending on a calendar port, and adapters for Google Calendar, SQLite persistence, OAuth, and MCP-over-HTTP. The service acts as an OAuth 2.1 authorization server for ChatGPT and as an OAuth client of Google, keeping the two token domains separate and encrypting Google credentials at rest.

**Tech Stack:** Node.js 22, TypeScript, official MCP TypeScript SDK, Express, Google APIs client, Zod, JOSE, SQLite, Vitest, Docker.

---

### Task 1: Scaffold and configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Steps:**
1. Write tests for required secrets, public HTTPS URL normalization, and the `Europe/Madrid` default.
2. Run the focused test and verify it fails before the configuration module exists.
3. Implement strict environment parsing without logging secrets.
4. Run the focused test and verify it passes.

### Task 2: Calendar domain model and validation

**Files:**
- Create: `src/domain/calendar.ts`
- Create: `src/domain/errors.ts`
- Test: `tests/calendar-domain.test.ts`

**Steps:**
1. Write failing tests for exclusive all-day end dates, timed event offsets, DST-invalid local times, date/dateTime mutual exclusion, and patch validation.
2. Implement Zod schemas and conversions to Google event payloads.
3. Add deterministic duplicate fingerprints and overlap windows.
4. Run tests and verify all domain cases pass.

### Task 3: Ports and application service

**Files:**
- Create: `src/application/calendar-port.ts`
- Create: `src/application/calendar-service.ts`
- Test: `tests/calendar-service.test.ts`

**Steps:**
1. Write failing tests with an in-memory adapter for calendar selection, CRUD, and duplicate prevention.
2. Define the calendar gateway port and typed application errors.
3. Implement calendar resolution by immutable ID first and unambiguous display name second.
4. Implement create/read/update/delete orchestration, rejecting duplicates unless explicitly allowed.
5. Run focused tests and verify they pass.

### Task 4: Google Calendar adapter

**Files:**
- Create: `src/adapters/google-calendar-gateway.ts`
- Test: `tests/google-calendar-gateway.test.ts`

**Steps:**
1. Write tests around mocked Google API methods for calendar listing, event mapping, pagination, and CRUD parameters.
2. Implement the adapter with `calendar.events` and `calendar.calendarlist.readonly` as the only Calendar scopes.
3. Preserve Google ETags and use them on destructive or overwriting changes when supplied.
4. Run adapter tests and verify they pass.

### Task 5: OAuth bridge and encrypted persistence

**Files:**
- Create: `src/infrastructure/store.ts`
- Create: `src/infrastructure/crypto.ts`
- Create: `src/auth/oauth-router.ts`
- Create: `src/auth/session.ts`
- Test: `tests/crypto.test.ts`
- Test: `tests/oauth.test.ts`

**Steps:**
1. Write failing tests for AES-GCM round trips, PKCE verification, one-time authorization codes, refresh-token rotation, redirect URI validation, and expired state.
2. Implement SQLite tables for registered MCP clients, pending grants, encrypted Google credentials, authorization codes, and MCP refresh tokens.
3. Implement OAuth protected-resource and authorization-server metadata plus dynamic client registration.
4. Implement `/authorize`, Google callback, `/oauth/token`, and `/oauth/revoke`, using Google offline access and encrypted refresh tokens.
5. Issue short-lived signed MCP access tokens and opaque rotating refresh tokens.
6. Run security-focused tests and verify they pass.

### Task 6: MCP tools and HTTP transport

**Files:**
- Create: `src/mcp/tools.ts`
- Create: `src/mcp/server.ts`
- Create: `src/index.ts`
- Test: `tests/mcp-tools.test.ts`

**Steps:**
1. Write failing tests for tool schemas and read/write annotations.
2. Implement `list_calendars`, `list_events`, `get_event`, `create_event`, `update_event`, and `delete_event`.
3. Require bearer authentication on `/mcp`, bind the Google account to the MCP token subject, and return OAuth discovery details on 401.
4. Run MCP integration tests and verify they pass.

### Task 7: Deployment and operator documentation

**Files:**
- Create: `README.md`
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/DEPLOYMENT.md`
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `render.yaml`

**Steps:**
1. Document Google Cloud OAuth setup, exact scopes, redirect URIs, secrets, backups, and token revocation.
2. Document ChatGPT web Developer Mode setup, current plan limitations, tool refresh behavior, and write confirmations.
3. Add container health checks and a persistent data volume.
4. Explain local testing through a secure tunnel without treating localhost as directly reachable by ChatGPT.

### Task 8: Final verification

**Files:**
- Modify as needed: project files above

**Steps:**
1. Install locked dependencies and run type checking.
2. Run the full unit/integration test suite.
3. Build the production artifact.
4. Audit tracked files for secrets and ensure only `.env.example` is included.
5. Compare README behavior and deployment instructions with the implementation.
