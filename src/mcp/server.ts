import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'node:url';

import { getAuthorizedTools, getAuthorizedResources } from './capabilities.ts';
import { handleToolCall, handleResourceRead } from './tools.ts';
import { initGraph, closeGraph } from '../graph.ts';
import { VERSION } from '../version.ts';

export const server = new Server(
  {
    name: 'memex-core-mcp',
    version: VERSION
  },
  {
    capabilities: {
      tools: {},
      resources: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: getAuthorizedTools()
  };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: getAuthorizedResources()
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  return handleResourceRead(request.params.uri, 'stdio');
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args || typeof args !== 'object') {
    throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments');
  }

  return handleToolCall(name, args as Record<string, unknown>);
});

export async function runServer() {
  // Suppress application console.logs to avoid polluting stdout (MCP stdio protocol corruption)
  console.log = (...args) => console.error(...args);

  initGraph(process.env.AGENTMEMORY_DB_PATH, true);

  // Intake DB must be initialized or agentmemory_submit_proposal fails with
  // "Intake DB not initialized" on every call.
  const { initIntake } = await import('../db/intake.ts');
  initIntake(process.env.AGENTMEMORY_INTAKE_DB_PATH);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AgentMemory Hub MCP Server running on stdio');

  // Gracefully close the DB when the connection drops to prevent Windows EBUSY
  process.on('SIGINT', () => { closeGraph(); process.exit(0); });
  process.on('SIGTERM', () => { closeGraph(); process.exit(0); });

  const originalOnClose = transport.onclose;
  transport.onclose = () => {
    closeGraph();
    if (originalOnClose) originalOnClose.call(transport);
  };
}

// Only auto-run if this is the entry script
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runServer().catch((error) => {
    console.error('Fatal error in MCP server:', error);
    process.exit(1);
  });
}
