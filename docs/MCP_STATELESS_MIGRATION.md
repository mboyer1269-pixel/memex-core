# MCP Stateless Migration

## What changed

`src/mcp/server.ts` (stdio) and `src/mcp/gateway.ts` (SSE) were two parallel
transports. Tool logic was already shared via `src/mcp/tools.ts`; the transport
wiring, auth, and lifecycle were still duplicated. Both files are now thin
shims over a single module:

```
src/mcp/unified-server.ts   ← all transport wiring, auth, access gate
src/mcp/tools.ts            ← all tool/resource logic (unchanged)
src/mcp/access.ts           ← decideAccess(): read/write policy per tool
src/mcp/handles.ts          ← signed, expirable per-agent credentials
```

## Endpoints

| Endpoint | Mode | State |
|---|---|---|
| stdio | local clients (Claude Desktop, Cursor) | per-process |
| `POST /mcp` | **stateless JSON-RPC** (Streamable-HTTP-compatible subset: single JSON response, no server-initiated stream) | none |
| `GET /sse` + `POST /message?sessionId=` | legacy stateful SSE | per-session map |

`POST /mcp` handles `initialize`, `ping`, `tools/list`, `tools/call`,
`resources/list`, `resources/read`, notifications, and batch arrays. Every
request is self-contained: parse → authenticate → `decideAccess()` → dispatch.
No session table, so restarts and horizontal scaling need zero coordination.
The SDK stays at 1.0.1 — no upgrade risk; the stateless endpoint speaks plain
JSON-RPC over HTTP.

## Access control

Every tool call on every transport goes through `decideAccess(access, tool)`:

- `none` → all tools denied
- `read_only` → the 8 read tools; writes (`agentmemory_write_vault_file`,
  `agentmemory_submit_proposal`) denied
- `read_write` → everything
- unknown/future tools are treated as **writes** (fail closed)

Access level resolution:

- **stdio**: `AGENTMEMORY_ACCESS` env (default `read_write` — operator machine)
- **HTTP bearer token** (`GATEWAY_TOKEN`): `GATEWAY_DEFAULT_ACCESS` (default `read_write`)
- **HTTP handle**: the scope embedded in the handle, which may only
  *downgrade* the gateway default — never escalate (403 otherwise)

## Handles

Format: `amh1.<payload-base64url>.<hmac-sha256-base64url>`, signed with
`AGENTMEMORY_HANDLE_SECRET` (≥16 chars). Payload: `{ sub, access, exp, iat }`.
Verification is stateless (signature + expiry only, constant-time compare).
TTL is capped at 30 days; `admin` cannot be minted. Mint one per agent:

```bash
AGENTMEMORY_HANDLE_SECRET=... npm run mint-handle -- hermes_agent read_only 86400
```

The `sub` claim identifies the agent — it is the identity the trust ledger
and audit logs see, instead of one shared anonymous token for everything.

## Client migration

| Client | Before | After |
|---|---|---|
| Claude Desktop / Cursor (stdio) | `src/mcp/server.ts` | unchanged (shim delegates) |
| Remote SSE clients | `GET /sse` with `Bearer <GATEWAY_TOKEN>` | unchanged (legacy kept) |
| New remote clients | — | `POST /mcp` with `Bearer <handle>` |

## Tests

`tests/mcp-access.test.ts` — negative-path coverage: `read_only` denied both
write tools, `none` denied everything, expired/tampered/forged handles
rejected, escalation attempts → 403, denial surfaced as JSON-RPC error.
`tests/mcp-parity.test.ts` — enforces that both entry files stay shims and
that `decideAccess` guards the unified server.
