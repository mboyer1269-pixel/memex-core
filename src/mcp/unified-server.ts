/**
 * Unified MCP server — single entry point for every transport.
 * -------------------------------------------------------------
 * Replaces the server.ts / gateway.ts split (both are now thin shims over
 * this module). One place wires:
 *
 *   stdio            local clients (Claude Desktop, Cursor)
 *   POST /mcp        STATELESS Streamable-HTTP-compatible JSON-RPC:
 *                    no session, no server-side state — each POST carries
 *                    everything needed (auth handle included). Survives
 *                    restarts and horizontal scaling by construction.
 *   GET /sse         legacy stateful SSE (kept for older remote clients)
 *
 * Access control: EVERY tool call goes through decideAccess() with the
 * caller's resolved access level:
 *   - stdio: AGENTMEMORY_ACCESS env (operator machine, default read_write)
 *   - HTTP:  GATEWAY_TOKEN bearer → GATEWAY_DEFAULT_ACCESS (default
 *            read_write), or a signed expirable handle (amh1.*) whose
 *            scope may only DOWNGRADE the gateway default, never escalate.
 */

import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';

import { getAuthorizedTools, getAuthorizedResources } from './capabilities.ts';
import { handleToolCall, handleResourceRead, type ToolResult } from './tools.ts';
import { decideAccess, defaultStdioAccess, canDowngradeTo, isAccessLevel, type AccessLevel } from './access.ts';
import { verifyHandle, getHandleSecret } from './handles.ts';
import { initGraph, closeGraph } from '../graph.ts';
import { VERSION } from '../version.ts';

// ── Guarded tool execution (the ONLY path to handleToolCall) ─────────

export interface CallerIdentity {
  access: AccessLevel;
  subject: string;
}

/**
 * Single choke point: access is decided BEFORE any tool logic runs, on
 * every transport. Denials are protocol errors (InvalidRequest) carrying
 * the precise reason — agents can self-correct instead of retrying.
 */
export async function guardedToolCall(
  caller: CallerIdentity,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const decision = decideAccess(caller.access, name);
  if (!decision.allowed) {
    throw new McpError(ErrorCode.InvalidRequest, `Access denied for '${caller.subject}': ${decision.reason}`);
  }
  return handleToolCall(name, args);
}

// ── Shared Server factory (stdio + SSE reuse identical wiring) ───────

export function createMcpServer(caller: CallerIdentity, transportLabel: 'stdio' | 'sse'): Server {
  const srv = new Server(
    { name: 'memex-core-mcp', version: VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: getAuthorizedTools() }));
  srv.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: getAuthorizedResources() }));
  srv.setRequestHandler(ReadResourceRequestSchema, async (request) =>
    handleResourceRead(request.params.uri, transportLabel)
  );
  srv.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (!args || typeof args !== 'object') {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments');
    }
    return guardedToolCall(caller, name, args as Record<string, unknown>);
  });

  return srv;
}

// ── Shared DB bootstrap ──────────────────────────────────────────────

async function bootstrapStorage(): Promise<void> {
  initGraph(process.env.AGENTMEMORY_DB_PATH, true);
  // Intake DB must be initialized or agentmemory_submit_proposal fails.
  const { initIntake } = await import('../db/intake.ts');
  initIntake(process.env.AGENTMEMORY_INTAKE_DB_PATH);
}

// ── stdio transport ──────────────────────────────────────────────────

export async function runStdio(): Promise<void> {
  // Suppress console.log to avoid corrupting the MCP stdio protocol
  console.log = (...args) => console.error(...args);

  await bootstrapStorage();

  const caller: CallerIdentity = { access: defaultStdioAccess(), subject: 'stdio-operator' };
  const server = createMcpServer(caller, 'stdio');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`AgentMemory Hub MCP Server running on stdio (access: ${caller.access})`);

  process.on('SIGINT', () => { closeGraph(); process.exit(0); });
  process.on('SIGTERM', () => { closeGraph(); process.exit(0); });

  const originalOnClose = transport.onclose;
  transport.onclose = () => {
    closeGraph();
    if (originalOnClose) originalOnClose.call(transport);
  };
}

// ── HTTP auth: bearer token OR signed handle ─────────────────────────

function gatewayDefaultAccess(): AccessLevel {
  const env = process.env.GATEWAY_DEFAULT_ACCESS;
  return isAccessLevel(env) && env !== 'admin' ? env : 'read_write';
}

type AuthResult = { ok: true; caller: CallerIdentity } | { ok: false; status: number; error: string };

export function resolveHttpCaller(authHeader: string | undefined): AuthResult {
  const token = process.env.GATEWAY_TOKEN || '';
  if (!token) {
    return { ok: false, status: 500, error: 'GATEWAY_TOKEN is not configured. Set it in your environment.' };
  }
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Unauthorized: missing Bearer credential.' };
  }
  const credential = authHeader.slice('Bearer '.length).trim();

  // 1. Signed expirable handle (amh1.*) — per-agent identity and scope
  if (credential.startsWith('amh1.')) {
    const secret = getHandleSecret();
    if (!secret) {
      return { ok: false, status: 500, error: 'AGENTMEMORY_HANDLE_SECRET is not configured (>=16 chars required).' };
    }
    const verdict = verifyHandle(credential, secret);
    if (!verdict.ok) {
      return { ok: false, status: 401, error: `Unauthorized: ${verdict.error}` };
    }
    // Handles may only downgrade the gateway default, never escalate.
    if (!canDowngradeTo(gatewayDefaultAccess(), verdict.payload.access)) {
      return {
        ok: false,
        status: 403,
        error: `Forbidden: handle scope '${verdict.payload.access}' exceeds gateway default '${gatewayDefaultAccess()}'.`
      };
    }
    return { ok: true, caller: { access: verdict.payload.access, subject: verdict.payload.sub } };
  }

  // 2. Shared gateway token — operator-level default access
  if (credential === token) {
    return { ok: true, caller: { access: gatewayDefaultAccess(), subject: 'gateway-token' } };
  }

  return { ok: false, status: 401, error: 'Unauthorized: invalid Bearer token.' };
}

// ── Stateless JSON-RPC endpoint (Streamable-HTTP compatible subset) ──
//
// Each POST /mcp is fully self-contained: parse → auth → dispatch →
// respond. No session map, no transport object retained. This is the
// stateless mode of the Streamable HTTP transport (single JSON response,
// no server-initiated stream).

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: any;
}

function rpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function rpcResult(id: number | string | null, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

export async function dispatchStatelessRpc(caller: CallerIdentity, msg: JsonRpcRequest): Promise<object | null> {
  const id = msg.id ?? null;

  // Notifications (no id) get no response body
  if (msg.id === undefined || msg.id === null) return null;

  try {
    switch (msg.method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-03-26',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'memex-core-mcp', version: VERSION }
        });
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, { tools: getAuthorizedTools() });
      case 'resources/list':
        return rpcResult(id, { resources: getAuthorizedResources() });
      case 'resources/read': {
        const uri = msg.params?.uri;
        if (typeof uri !== 'string') return rpcError(id, ErrorCode.InvalidParams, 'uri is required');
        return rpcResult(id, handleResourceRead(uri, 'sse'));
      }
      case 'tools/call': {
        const name = msg.params?.name;
        const args = msg.params?.arguments;
        if (typeof name !== 'string' || !args || typeof args !== 'object') {
          return rpcError(id, ErrorCode.InvalidParams, 'name and arguments are required');
        }
        const result = await guardedToolCall(caller, name, args as Record<string, unknown>);
        return rpcResult(id, result);
      }
      default:
        return rpcError(id, ErrorCode.MethodNotFound, `Method not found: ${msg.method}`);
    }
  } catch (err: any) {
    if (err instanceof McpError) return rpcError(id, err.code, err.message);
    return rpcError(id, ErrorCode.InternalError, err?.message ?? 'Internal error');
  }
}

// ── HTTP app assembly ────────────────────────────────────────────────

export function createHttpApp(): express.Express {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: VERSION, transports: ['stateless-http', 'sse'] });
  });

  // ── Stateless endpoint ──
  app.post('/mcp', express.json({ limit: '1mb' }), async (req: Request, res: Response) => {
    const auth = resolveHttpCaller(req.headers.authorization);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const body = req.body;
    if (Array.isArray(body)) {
      const responses = [];
      for (const msg of body) {
        const out = await dispatchStatelessRpc(auth.caller, msg);
        if (out) responses.push(out);
      }
      if (responses.length === 0) { res.status(202).end(); return; }
      res.json(responses);
      return;
    }

    if (!body || typeof body !== 'object') {
      res.status(400).json(rpcError(null, ErrorCode.ParseError ?? -32700, 'Invalid JSON-RPC payload'));
      return;
    }

    const out = await dispatchStatelessRpc(auth.caller, body);
    if (out === null) { res.status(202).end(); return; }
    res.json(out);
  });

  // ── Legacy stateful SSE (kept for older remote clients) ──
  const activeTransports = new Map<string, { server: Server; transport: SSEServerTransport }>();

  app.get('/sse', async (req, res) => {
    const auth = resolveHttpCaller(req.headers.authorization);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const srv = createMcpServer(auth.caller, 'sse');
    const transport = new SSEServerTransport('/message', res);
    const sessionId = transport.sessionId;
    activeTransports.set(sessionId, { server: srv, transport });
    console.log(`[Gateway] New SSE connection: ${sessionId} (${auth.caller.subject}, ${auth.caller.access})`);

    res.on('close', () => {
      console.log(`[Gateway] Client disconnected: ${sessionId}`);
      activeTransports.delete(sessionId);
      srv.close().catch(() => {});
    });

    await srv.connect(transport);
  });

  // NOTE: no express.json() here — SSEServerTransport reads the raw body itself.
  app.post('/message', async (req, res) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId query parameter.' });
      return;
    }
    const entry = activeTransports.get(sessionId);
    if (!entry) {
      res.status(404).json({ error: `No active SSE session found for sessionId: ${sessionId}` });
      return;
    }
    try {
      await entry.transport.handlePostMessage(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message ?? 'Internal error handling message.' });
      }
    }
  });

  (app as any).__activeTransports = activeTransports;
  return app;
}

export async function runHttp(): Promise<void> {
  await bootstrapStorage();

  const app = createHttpApp();
  const PORT = Number(process.env.GATEWAY_PORT) || 3000;

  app.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════════════╗`);
    console.log(`  ║  AgentMemory Hub MCP (unified) v${VERSION}        ║`);
    console.log(`  ║  Stateless: POST http://localhost:${PORT}/mcp    ║`);
    console.log(`  ║  Legacy SSE: GET http://localhost:${PORT}/sse    ║`);
    console.log(`  ║  Auth: Bearer token or signed handle         ║`);
    console.log(`  ╚══════════════════════════════════════════════╝\n`);
  });

  const shutdown = () => {
    console.log('[Gateway] Shutting down...');
    const transports = (app as any).__activeTransports as Map<string, { server: Server }>;
    for (const [id, entry] of transports) {
      entry.server.close().catch(() => {});
      transports.delete(id);
    }
    closeGraph();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Auto-run: `--http` (or GATEWAY_MODE=http) starts the HTTP server,
// otherwise stdio.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const wantsHttp = process.argv.includes('--http') || process.env.GATEWAY_MODE === 'http';
  (wantsHttp ? runHttp() : runStdio()).catch((error) => {
    console.error('Fatal error in unified MCP server:', error);
    process.exit(1);
  });
}
