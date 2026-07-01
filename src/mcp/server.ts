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

import { getAuthorizedTools, getAuthorizedResources } from './capabilities.ts';
import { getMemoryContext } from '../memory/context-provider.ts';
import { buildMemoryPromptSection } from '../memory/prompt-context.ts';
import { queryEntities } from '../graph.ts';
import { initGraph, closeGraph } from '../graph.ts';

export const server = new Server(
  {
    name: 'memex-core-mcp',
    version: '0.7.0'
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
  const uri = request.params.uri;
  
  if (uri === 'agentmemory://health') {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          status: 'ok',
          version: '0.6.1',
          readOnly: true,
          transport: 'stdio'
        }, null, 2)
      }]
    };
  }

  if (uri === 'agentmemory://schema') {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          tools: getAuthorizedTools().map(t => t.name),
          resources: getAuthorizedResources().map(r => r.uri),
          formats: ['json', 'markdown'],
          limits: { maxEntities: 50, maxRelations: 50 },
          nonGoals: ['No Auto-Write', 'No Network Calls', 'No Mutation']
        }, null, 2)
      }]
    };
  }

  throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${uri}`);
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  if (!args || typeof args !== 'object') {
    throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments');
  }

  try {
    if (name === 'agentmemory_graph_query') {
      const namespace = args.namespace as string;
      const entityType = args.entityType as string | undefined;
      const limit = Math.max(1, Math.min(Number(args.limit) || 50, 50));

      if (!namespace) {
        throw new McpError(ErrorCode.InvalidParams, 'namespace is required');
      }

      const rows = entityType 
        ? queryEntities({ type: entityType, namespace, limit })
        : queryEntities({ namespace, limit });
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    }

    if (name === 'agentmemory_context_pack') {
      const namespace = args.namespace as string;
      const centerEntityId = args.centerEntityId as string;
      const maxEntities = Math.max(1, Math.min(Number(args.maxEntities) || 50, 50));
      const maxRelations = Math.max(1, Math.min(Number(args.maxRelations) || 50, 50));
      const format = args.format === 'markdown' ? 'markdown' : 'json';

      if (!namespace || !centerEntityId) {
        throw new McpError(ErrorCode.InvalidParams, 'namespace and centerEntityId are required');
      }

      const memoryContext = getMemoryContext({
        tenant: namespace,
        namespace,
        centerEntityId,
        maxEntities,
        maxRelations
      });

      if (format === 'markdown') {
        const { searchVault } = await import('../vault/index.ts');
        let markdownContent = buildMemoryPromptSection(memoryContext);
        
        // Sifter: Grab active facts from Vault related to this entity
        const vaultFacts = searchVault(centerEntityId, false);
        if (vaultFacts.length > 0) {
          markdownContent += `\n\n### Archival Memory (Obsidian Vault)\n`;
          for (const fact of vaultFacts) {
            markdownContent += `- **${fact.filepath}**: ${fact.preview}\n`;
          }
        }
        
        return {
          content: [{
            type: 'text',
            text: markdownContent
          }]
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(memoryContext, null, 2)
        }]
      };
    }

    if (name === 'agentmemory_librarian_brief') {
      const { agentmemory_librarian_brief } = await import('../memory/librarian.ts');
      const namespace = args.namespace as string;
      const task = args.task as string;
      const tokenBudget = Number(args.tokenBudget);
      if (!namespace || !task || isNaN(tokenBudget)) {
        throw new McpError(ErrorCode.InvalidParams, 'namespace, task, and tokenBudget are required');
      }
      const result = agentmemory_librarian_brief(namespace, task, tokenBudget);
      return { content: [{ type: 'text', text: result }] };
    }

    if (name === 'agentmemory_latest_updates') {
      const { agentmemory_latest_updates } = await import('../memory/librarian.ts');
      const namespace = args.namespace as string;
      const tokenBudget = args.tokenBudget !== undefined ? Number(args.tokenBudget) : undefined;
      if (tokenBudget !== undefined && isNaN(tokenBudget)) {
        throw new McpError(ErrorCode.InvalidParams, 'tokenBudget must be a valid number');
      }
      if (!namespace) {
        throw new McpError(ErrorCode.InvalidParams, 'namespace is required');
      }
      const result = agentmemory_latest_updates(namespace, tokenBudget);
      return { content: [{ type: 'text', text: result }] };
    }

    if (name === 'agentmemory_project_state') {
      const { agentmemory_project_state } = await import('../memory/librarian.ts');
      const namespace = args.namespace as string;
      const tokenBudget = args.tokenBudget !== undefined ? Number(args.tokenBudget) : undefined;
      if (tokenBudget !== undefined && isNaN(tokenBudget)) {
        throw new McpError(ErrorCode.InvalidParams, 'tokenBudget must be a valid number');
      }
      if (!namespace) {
        throw new McpError(ErrorCode.InvalidParams, 'namespace is required');
      }
      const result = agentmemory_project_state(namespace, tokenBudget);
      return { content: [{ type: 'text', text: result }] };
    }

    if (name === 'agentmemory_tool_catalog_search') {
      const { agentmemory_tool_catalog_search } = await import('../memory/librarian.ts');
      const namespace = args.namespace as string;
      const intent = args.intent as string;
      const tokenBudget = args.tokenBudget !== undefined ? Number(args.tokenBudget) : undefined;
      if (tokenBudget !== undefined && isNaN(tokenBudget)) {
        throw new McpError(ErrorCode.InvalidParams, 'tokenBudget must be a valid number');
      }
      if (!namespace || !intent) {
        throw new McpError(ErrorCode.InvalidParams, 'namespace and intent are required');
      }
      const result = agentmemory_tool_catalog_search(namespace, intent, tokenBudget);
      return { content: [{ type: 'text', text: result }] };
    }

    if (name === 'agentmemory_submit_proposal') {
      const { submitProposal } = await import('../intake/index.ts');
      const { getEntity } = await import('../graph.ts');

      const tenant = args.tenant as string;
      const namespace = args.namespace as string;
      const proposedBy = args.proposedBy as string;
      const sourceClient = args.sourceClient as string;
      const content = args.content as string;
      const suggestedEntities = args.suggestedEntities as string | undefined;
      const suggestedRelations = args.suggestedRelations as string | undefined;
      const provenance = args.provenance as string | undefined;
      const confidence = args.confidence as number | undefined;
      const riskFlags = args.riskFlags as string | undefined;

      if (!content || content.trim() === '') {
        throw new McpError(ErrorCode.InvalidParams, 'content must not be empty');
      }
      if (content.length > 100000) {
        throw new McpError(ErrorCode.InvalidParams, 'content.length must be <= 100000');
      }
      if (!namespace || !namespace.startsWith('org:')) {
        throw new McpError(ErrorCode.InvalidParams, 'namespace must start with org:');
      }
      if (tenant !== namespace) {
        throw new McpError(ErrorCode.InvalidParams, 'tenant must exactly match namespace');
      }

      let parsedEnts: any[] = [];
      if (suggestedEntities) {
        try {
          parsedEnts = JSON.parse(suggestedEntities);
          if (!Array.isArray(parsedEnts)) throw new Error('Not an array');
        } catch (e) {
          throw new McpError(ErrorCode.InvalidParams, 'suggestedEntities must be a valid JSON array');
        }
      }

      let parsedRels: any[] = [];
      if (suggestedRelations) {
        try {
          parsedRels = JSON.parse(suggestedRelations);
          if (!Array.isArray(parsedRels)) throw new Error('Not an array');
        } catch (e) {
          throw new McpError(ErrorCode.InvalidParams, 'suggestedRelations must be a valid JSON array');
        }
      }

      const entIds = new Set(parsedEnts.map(e => e.id).filter(id => id));

      for (const rel of parsedRels) {
        for (const targetId of [rel.sourceId, rel.targetId]) {
          if (!targetId) continue;
          const existing = getEntity(targetId);
          if (existing) {
            if (existing.namespace !== namespace && existing.namespace !== 'global') {
              throw new McpError(ErrorCode.InvalidParams, `Relation references cross-tenant entity: ${targetId}`);
            }
          } else if (!entIds.has(targetId)) {
            throw new McpError(ErrorCode.InvalidParams, `Relation references non-existent entity: ${targetId}`);
          }
        }
      }

      const result = submitProposal({
        tenant,
        namespace,
        proposedBy,
        sourceClient,
        content,
        suggestedEntities,
        suggestedRelations,
        provenance,
        confidence,
        riskFlags
      });

      return { content: [{ type: 'text', text: result.id! }] };
    }

    if (name === 'agentmemory_read_vault_file') {
      const { readVaultFile } = await import('../vault/index.ts');
      const filepath = args.filepath as string;
      if (!filepath) {
        throw new McpError(ErrorCode.InvalidParams, 'filepath is required');
      }
      const result = readVaultFile(filepath);
      return { content: [{ type: 'text', text: result }] };
    }

    if (name === 'agentmemory_write_vault_file') {
      const { writeVaultFile } = await import('../vault/index.ts');
      const filepath = args.filepath as string;
      const content = args.content as string;
      if (!filepath || !content) {
        throw new McpError(ErrorCode.InvalidParams, 'filepath and content are required');
      }
      const result = writeVaultFile(filepath, content);
      return { content: [{ type: 'text', text: result }] };
    }

    if (name === 'agentmemory_search_vault') {
      const { searchVault } = await import('../vault/index.ts');
      const query = args.query as string;
      if (!query) {
        throw new McpError(ErrorCode.InvalidParams, 'query is required');
      }
      const result = searchVault(query);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
  } catch (err: any) {
    // If it's an McpError, rethrow it
    if (err instanceof McpError) throw err;
    
    // Otherwise return a controlled error message in JSON
    return {
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({ warnings: [err.message] }, null, 2)
      }]
    };
  }
});

export async function runServer() {
  // Suppress application console.logs to avoid polluting stdout (MCP stdio protocol corruption)
  const originalLog = console.log;
  console.log = (...args) => console.error(...args);
  
  initGraph(process.env.AGENTMEMORY_DB_PATH, true);
  
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

import { fileURLToPath } from 'node:url';

// Only auto-run if this is the entry script
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runServer().catch((error) => {
    console.error('Fatal error in MCP server:', error);
    process.exit(1);
  });
}
