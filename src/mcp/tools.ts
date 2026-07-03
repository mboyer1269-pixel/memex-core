/**
 * Shared MCP tool + resource handlers (R1 consolidation).
 * ------------------------------------------------------
 * Single source of truth for ALL tool logic. Both transports import from
 * here:
 *   - src/mcp/server.ts   (stdio, Claude Desktop / local clients)
 *   - src/mcp/gateway.ts  (SSE over HTTP, remote/mobile clients)
 *
 * This removes the ~600 duplicated lines between server.ts and gateway.ts
 * and guarantees tool parity by construction: a tool added here exists on
 * every transport, and tests/mcp-parity.test.ts enforces it against the
 * fixtures contract.
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { getAuthorizedTools, getAuthorizedResources } from './capabilities.ts';
import { getMemoryContext } from '../memory/context-provider.ts';
import { buildMemoryPromptSection } from '../memory/prompt-context.ts';
import { queryEntities, getWorkerMetaValue } from '../graph.ts';
import { VERSION } from '../version.ts';

const SLEEP_CYCLE_INTERVAL_MS = Number(process.env.WORKER_SLEEP_INTERVAL_MS) || 24 * 60 * 60 * 1000;

/**
 * Observability line for agents: when did the sleep cycle last run and when
 * is the next pruning due. Lets monitoring agents (Oria.HQ) avoid promoting
 * borderline memories right before a cycle. Empty string when the worker
 * has never run.
 */
function sleepCycleStatusLine(): string {
  const lastRun = getWorkerMetaValue('last_sleep_cycle_at');
  if (!lastRun) return '';
  const lastMs = new Date(lastRun).getTime();
  if (Number.isNaN(lastMs)) return '';
  return JSON.stringify({
    meta: 'sleep_cycle',
    last_run_at: new Date(lastMs).toISOString(),
    next_run_at: new Date(lastMs + SLEEP_CYCLE_INTERVAL_MS).toISOString()
  });
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function text(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }] };
}

/**
 * Handle a single MCP tool call. Throws McpError for protocol-level errors
 * (unknown tool, invalid params); returns an isError payload for runtime
 * failures so the connection never crashes.
 */
export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<ToolResult> {
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
      return text(JSON.stringify(rows, null, 2));
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
        return text(markdownContent);
      }

      return text(JSON.stringify(memoryContext, null, 2));
    }

    if (name === 'agentmemory_librarian_brief') {
      const { agentmemory_librarian_brief } = await import('../memory/librarian.ts');
      const namespace = args.namespace as string;
      const task = args.task as string;
      const tokenBudget = Number(args.tokenBudget);
      if (!namespace || !task || isNaN(tokenBudget)) {
        throw new McpError(ErrorCode.InvalidParams, 'namespace, task, and tokenBudget are required');
      }
      return text(agentmemory_librarian_brief(namespace, task, tokenBudget));
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
      let result = agentmemory_latest_updates(namespace, tokenBudget);
      const sleepStatus = sleepCycleStatusLine();
      if (sleepStatus) {
        result = result ? `${result}\n${sleepStatus}` : sleepStatus;
      }
      return text(result);
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
      return text(agentmemory_project_state(namespace, tokenBudget));
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
      return text(agentmemory_tool_catalog_search(namespace, intent, tokenBudget));
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
        } catch {
          throw new McpError(ErrorCode.InvalidParams, 'suggestedEntities must be a valid JSON array');
        }
      }

      let parsedRels: any[] = [];
      if (suggestedRelations) {
        try {
          parsedRels = JSON.parse(suggestedRelations);
          if (!Array.isArray(parsedRels)) throw new Error('Not an array');
        } catch {
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

      return text(result.id!);
    }

    if (name === 'agentmemory_read_vault_file') {
      const { readVaultFile } = await import('../vault/index.ts');
      const filepath = args.filepath as string;
      if (!filepath) {
        throw new McpError(ErrorCode.InvalidParams, 'filepath is required');
      }
      return text(readVaultFile(filepath));
    }

    if (name === 'agentmemory_write_vault_file') {
      const { writeVaultFile } = await import('../vault/index.ts');
      const filepath = args.filepath as string;
      const content = args.content as string;
      if (!filepath || !content) {
        throw new McpError(ErrorCode.InvalidParams, 'filepath and content are required');
      }
      return text(writeVaultFile(filepath, content));
    }

    if (name === 'agentmemory_search_vault') {
      const { searchVault } = await import('../vault/index.ts');
      const query = args.query as string;
      if (!query) {
        throw new McpError(ErrorCode.InvalidParams, 'query is required');
      }
      return text(JSON.stringify(searchVault(query), null, 2));
    }

    throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
  } catch (err: any) {
    // Protocol errors propagate to the transport
    if (err instanceof McpError) throw err;

    // Runtime errors return a controlled JSON payload
    return {
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({ warnings: [err.message] }, null, 2)
      }]
    };
  }
}

/** Shared resource handler for both transports. */
export function handleResourceRead(uri: string, transport: 'stdio' | 'sse'): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  if (uri === 'agentmemory://health') {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          status: 'ok',
          version: VERSION,
          readOnly: true,
          transport
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
          tools: getAuthorizedTools().map((t: any) => t.name),
          resources: getAuthorizedResources().map((r: any) => r.uri),
          formats: ['json', 'markdown'],
          limits: { maxEntities: 50, maxRelations: 50 },
          nonGoals: ['No Auto-Write', 'No Network Calls', 'No Mutation']
        }, null, 2)
      }]
    };
  }

  throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${uri}`);
}
