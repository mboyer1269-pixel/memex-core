/**
 * Access control for MCP tool calls.
 * -----------------------------------
 * Every tool call — on every transport — goes through decideAccess().
 * Tools are classified once, here, by what they can do to the memory
 * fabric. The access level comes from:
 *   - stdio:  AGENTMEMORY_ACCESS env var (operator-controlled)
 *   - HTTP:   the caller's signed handle scope (see handles.ts), or the
 *             default granted by the bearer token
 *
 * Unknown tools are treated as writes: denying an unclassified tool to a
 * read_only caller is safe; silently allowing it is not.
 */

export const ACCESS_LEVELS = ['admin', 'read_write', 'read_only', 'none'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** Tools that mutate state (vault writes, intake proposals). */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'agentmemory_submit_proposal',
  'agentmemory_write_vault_file'
]);

/** Tools that only read the fabric. */
export const READ_TOOLS: ReadonlySet<string> = new Set([
  'agentmemory_graph_query',
  'agentmemory_context_pack',
  'agentmemory_librarian_brief',
  'agentmemory_latest_updates',
  'agentmemory_project_state',
  'agentmemory_tool_catalog_search',
  'agentmemory_read_vault_file',
  'agentmemory_search_vault'
]);

export interface AccessDecision {
  allowed: boolean;
  reason: string;
}

const RANK: Record<AccessLevel, number> = { none: 0, read_only: 1, read_write: 2, admin: 3 };

export function isAccessLevel(value: unknown): value is AccessLevel {
  return typeof value === 'string' && (ACCESS_LEVELS as readonly string[]).includes(value);
}

/**
 * Decide whether a caller with `access` may invoke `toolName`.
 * Pure and deterministic — no I/O, trivially testable.
 */
export function decideAccess(access: AccessLevel, toolName: string): AccessDecision {
  if (access === 'none') {
    return { allowed: false, reason: `access level 'none' denies all tools (requested: ${toolName})` };
  }

  const required: AccessLevel = READ_TOOLS.has(toolName) ? 'read_only' : 'read_write';

  if (RANK[access] >= RANK[required]) {
    return { allowed: true, reason: `${access} >= ${required} for ${toolName}` };
  }
  return {
    allowed: false,
    reason: `tool ${toolName} requires ${required}, caller has ${access}`
  };
}

/**
 * True when `requested` grants no more than `granted` — handles may only
 * downgrade privileges, never escalate them.
 */
export function canDowngradeTo(granted: AccessLevel, requested: AccessLevel): boolean {
  return RANK[requested] <= RANK[granted];
}

/** Default access for the stdio transport (operator-controlled machine). */
export function defaultStdioAccess(): AccessLevel {
  const env = process.env.AGENTMEMORY_ACCESS;
  return isAccessLevel(env) ? env : 'read_write';
}
