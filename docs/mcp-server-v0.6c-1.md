# AgentMemory MCP Server Read-Only MVP (v0.6c-1)

## Overview
This server strictly implements the `v0.6c-0` read-only capabilities over the standard `stdio` Model Context Protocol using `@modelcontextprotocol/sdk`. It serves as the secure interface between AI agents and the local AgentMemory SQLite knowledge graph.

## Exposed Capabilities
- **Tools**: `agentmemory_graph_query`, `agentmemory_context_pack`
- **Resources**: `agentmemory://health`, `agentmemory://schema`

## Example Tool Calls & Responses

### 1. `agentmemory_graph_query`
**Input**:
```json
{
  "namespace": "org:1",
  "limit": 1
}
```
**Output**:
```json
[
  {
    "id": "119464da-3335-49cf-a3de-bcbfd35dbc9a",
    "type": "Agent",
    "namespace": "org:1",
    "createdAt": "2026-06-05T20:22:12.313Z"
  }
]
```

### 2. `agentmemory_context_pack` (Format: JSON)
**Input**:
```json
{
  "namespace": "org:1",
  "centerEntityId": "119464da-3335-49cf-a3de-bcbfd35dbc9a",
  "format": "json"
}
```
**Output**:
```json
{
  "graphContext": {
    "centerEntity": { "id": "119464da-3335-49cf-a3de-bcbfd35dbc9a", "type": "Agent" },
    "entities": [ ... ],
    "relations": []
  },
  "provenance": [],
  "warnings": [],
  "tokenEstimate": 362
}
```

### 3. `agentmemory_context_pack` (Format: Markdown)
**Input**:
```json
{
  "namespace": "org:1",
  "centerEntityId": "119464da-3335-49cf-a3de-bcbfd35dbc9a",
  "format": "markdown"
}
```
**Output**:
```markdown
## AgentMemory Graph Context

### Core Entity
- **Agent**: 119464da-3335-49cf-a3de-bcbfd35dbc9a

### Related Entities
...
```

## Non-Goals
- **No Mutation**: No write tools exist. SQLite is mounted `readonly: true`.
- **No Network Execution**: Operates over local stdin/stdout.
- **No RAG**: RAG fusion is not handled in this server.

## Remaining Risks
1. **Concurrency File Locks**: SQLite may throw `EBUSY` under high concurrent reads on Windows if not configured with WAL mode.
2. **Infinite Data Limits**: Tools are hard-capped at 50, but deep nested JSON objects inside `properties` might still bloat token counts.

## Test Instructions (PowerShell)
To manually boot the server in raw stdio mode for inspection:
```powershell
node --experimental-strip-types src/mcp/server.ts
```
To run automated capability validation tests:
```powershell
npm test
```
