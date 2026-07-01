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
import { getMemoryContext } from '../memory/context-provider.ts';
import { buildMemoryPromptSection } from '../memory/prompt-context.ts';
import { queryEntities } from '../graph.ts';
import { initGraph, closeGraph } from '../graph.ts';

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
  res.json({ status: 'ok', version: '0.7.0', transport: 'sse' });
});

// ── Per-client SSE connections ──
// Each client gets its own Server + Transport instance.
// This is critical: a single shared `server` variable means only ONE client
// can connect at a time. The correct MCP SSE pattern creates a fresh
// Server instance per SSE connection.

function createMcpServer(): Server {
  const srv = new Server(
    { name: 'memex-core-gateway', version: '0.7.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getAuthorizedTools()
  }));

  srv.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: getAuthorizedResources()
  }));

  srv.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri === 'agentmemory://health') {
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ status: 'ok', version: '0.7.0', transport: 'sse' }, null, 2)
        }]
      };
    }
    throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${uri}`);
  });

  // Register tool handlers — mirrors server.ts but avoids the stdio import 
  srv.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (!args || typeof args !== 'object') {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments');
    }

    try {
      // Vault tools (the new v4 ones)
      if (name === 'agentmemory_read_vault_file') {
        const { readVaultFile } = await import('../vault/index.ts');
        const filepath = args.filepath as string;
        if (!filepath) throw new McpError(ErrorCode.InvalidParams, 'filepath is required');
        return { content: [{ type: 'text', text: readVaultFile(filepath) }] };
      }

      if (name === 'agentmemory_write_vault_file') {
        const { writeVaultFile } = await import('../vault/index.ts');
        const filepath = args.filepath as string;
        const content = args.content as string;
        if (!filepath || !content) throw new McpError(ErrorCode.InvalidParams, 'filepath and content are required');
        return { content: [{ type: 'text', text: writeVaultFile(filepath, content) }] };
      }

      if (name === 'agentmemory_search_vault') {
        const { searchVault } = await import('../vault/index.ts');
        const query = args.query as string;
        if (!query) throw new McpError(ErrorCode.InvalidParams, 'query is required');
        return { content: [{ type: 'text', text: JSON.stringify(searchVault(query), null, 2) }] };
      }

      // Graph tools
      if (name === 'agentmemory_graph_query') {
        const namespace = args.namespace as string;
        if (!namespace) throw new McpError(ErrorCode.InvalidParams, 'namespace is required');
        const entityType = args.entityType as string | undefined;
        const limit = Math.max(1, Math.min(Number(args.limit) || 50, 50));
        const rows = entityType
          ? queryEntities({ type: entityType, namespace, limit })
          : queryEntities({ namespace, limit });
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
      }

      if (name === 'agentmemory_context_pack') {
        const { searchVault } = await import('../vault/index.ts');
        const namespace = args.namespace as string;
        const centerEntityId = args.centerEntityId as string;
        if (!namespace || !centerEntityId) throw new McpError(ErrorCode.InvalidParams, 'namespace and centerEntityId are required');
        const maxEntities = Math.max(1, Math.min(Number(args.maxEntities) || 50, 50));
        const maxRelations = Math.max(1, Math.min(Number(args.maxRelations) || 50, 50));
        const format = args.format === 'markdown' ? 'markdown' : 'json';

        const memoryContext = getMemoryContext({ tenant: namespace, namespace, centerEntityId, maxEntities, maxRelations });

        if (format === 'markdown') {
          let md = buildMemoryPromptSection(memoryContext);
          const vaultFacts = searchVault(centerEntityId, false);
          if (vaultFacts.length > 0) {
            md += '\n\n### Archival Memory (Obsidian Vault)\n';
            for (const fact of vaultFacts) {
              md += `- **${fact.filepath}**: ${fact.preview}\n`;
            }
          }
          return { content: [{ type: 'text', text: md }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(memoryContext, null, 2) }] };
      }

      // Librarian tools
      if (name === 'agentmemory_librarian_brief') {
        const { agentmemory_librarian_brief } = await import('../memory/librarian.ts');
        const namespace = args.namespace as string;
        const task = args.task as string;
        const tokenBudget = Number(args.tokenBudget);
        if (!namespace || !task || isNaN(tokenBudget)) throw new McpError(ErrorCode.InvalidParams, 'namespace, task, and tokenBudget are required');
        return { content: [{ type: 'text', text: agentmemory_librarian_brief(namespace, task, tokenBudget) }] };
      }

      throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
    } catch (err: any) {
      if (err instanceof McpError) throw err;
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: err.message }, null, 2) }]
      };
    }
  });

  return srv;
}

// Track active transports for cleanup
const activeTransports = new Map<string, { server: Server; transport: SSEServerTransport }>();

app.get('/sse', async (req, res) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[Gateway] New SSE connection: ${clientId}`);
  
  const srv = createMcpServer();
  const transport = new SSEServerTransport('/message', res);
  activeTransports.set(clientId, { server: srv, transport });

  // Cleanup on disconnect
  res.on('close', () => {
    console.log(`[Gateway] Client disconnected: ${clientId}`);
    activeTransports.delete(clientId);
    srv.close().catch(() => {});
  });

  await srv.connect(transport);
});

app.post('/message', express.json(), async (req, res) => {
  // The SSE transport handles routing based on the sessionId query param
  // We need to find the right transport for this message
  for (const [, entry] of activeTransports) {
    try {
      await entry.transport.handlePostMessage(req, res);
      return;
    } catch {
      // Not the right transport, try next
    }
  }
  res.status(404).json({ error: 'No active SSE session found.' });
});

export async function runGateway() {
  initGraph(process.env.AGENTMEMORY_DB_PATH, true);

  app.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════════════╗`);
    console.log(`  ║  AgentMemory Hub MCP Gateway v0.7.0          ║`);
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
