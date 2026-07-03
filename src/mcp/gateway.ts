import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
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
import { handleToolCall, handleResourceRead } from './tools.ts';
import { initGraph, closeGraph } from '../graph.ts';
import { VERSION } from '../version.ts';

const app = express();
const PORT = Number(process.env.GATEWAY_PORT) || 3000;
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';

// ── Authentication Middleware ──
app.use((req, res, next) => {
  // Health endpoint is unauthenticated for monitoring
  if (req.path === '/health') return next();

  if (!GATEWAY_TOKEN) {
    res.status(500).json({ error: 'GATEWAY_TOKEN is not configured. Set it in your environment.' });
    return;
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${GATEWAY_TOKEN}`) {
    res.status(401).json({ error: 'Unauthorized: Invalid or missing Bearer token.' });
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: VERSION, transport: 'sse' });
});

// ── Per-client SSE connections ──
// Each client gets its own Server + Transport instance. Tool handlers are
// shared with the stdio server via ./tools.ts — full parity by construction.

function createMcpServer(): Server {
  const srv = new Server(
    { name: 'memex-core-gateway', version: VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getAuthorizedTools()
  }));

  srv.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: getAuthorizedResources()
  }));

  srv.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return handleResourceRead(request.params.uri, 'sse');
  });

  srv.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (!args || typeof args !== 'object') {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments');
    }
    return handleToolCall(name, args as Record<string, unknown>);
  });

  return srv;
}

// Track active transports, keyed by the transport's OWN sessionId.
// The SSE transport advertises `/message?sessionId=<uuid>` to its client,
// so POSTs can be routed deterministically — never broadcast to the first
// transport that doesn't throw (that leaked responses across sessions).
const activeTransports = new Map<string, { server: Server; transport: SSEServerTransport }>();

app.get('/sse', async (_req, res) => {
  const srv = createMcpServer();
  const transport = new SSEServerTransport('/message', res);
  const sessionId = transport.sessionId;
  activeTransports.set(sessionId, { server: srv, transport });
  console.log(`[Gateway] New SSE connection: ${sessionId}`);

  // Cleanup on disconnect
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

export async function runGateway() {
  initGraph(process.env.AGENTMEMORY_DB_PATH, true);

  // Same intake bootstrap as the stdio server — parity includes side effects.
  const { initIntake } = await import('../db/intake.ts');
  initIntake(process.env.AGENTMEMORY_INTAKE_DB_PATH);

  app.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════════════╗`);
    console.log(`  ║  AgentMemory Hub MCP Gateway v${VERSION}          ║`);
    console.log(`  ║  SSE: http://localhost:${PORT}/sse              ║`);
    console.log(`  ║  Auth: Bearer Token required                 ║`);
    console.log(`  ╚══════════════════════════════════════════════╝\n`);
  });

  const shutdown = () => {
    console.log('[Gateway] Shutting down...');
    for (const [id, entry] of activeTransports) {
      entry.server.close().catch(() => {});
      activeTransports.delete(id);
    }
    closeGraph();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Auto-run if this is the entry script
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runGateway().catch((error) => {
    console.error('Fatal error in MCP gateway:', error);
    process.exit(1);
  });
}
