# MCP Contract v0.6c

**Version**: v0.6c-0
**Date**: 2026-06-05

## 1. Authorized Tools (Read-Only)
Only the following tools are exposed via the MCP protocol.
- `agentmemory_graph_query`: Fetches entities based on `type` and `namespace`.
- `agentmemory_context_pack`: Fetches a structured JSON context pack and a markdown prompt section based on a `centerEntityId`.

## 2. Authorized Resources (Read-Only)
- `agentmemory://health`: System health status and basic stats.
- `agentmemory://schema`: The graph schema detailing valid entity types, relation types, and namespace patterns.

## 3. Accepted Parameters
- `agentmemory_graph_query`:
  - `namespace` (string, required): The targeted tenant namespace. Must not be a free path.
  - `entityType` (string, optional): The entity type to filter by.
- `agentmemory_context_pack`:
  - `namespace` (string, required): The targeted tenant namespace.
  - `centerEntityId` (string, required): The UUID of the central entity.
  - `maxEntities` (number, optional, max 50): Hard limit on related entities returned.
  - `maxRelations` (number, optional, max 50): Hard limit on relations returned.

## 4. Output Formats
- **Tools**: JSON payload containing `graphContext`, `provenance`, `warnings`, and `tokenEstimate`. The `agentmemory_context_pack` will also return a `promptSection` containing formatted Markdown.
- **Resources**: Raw text or JSON depending on the resource URI.

## 5. Strict Limits
- Maximum entities returned per pack: 50.
- Maximum relations returned per pack: 50.
- Connection mode: `readOnly: true` strictly enforced at the SQLite level.

## 6. Controlled Errors
- Any invalid UUID, non-existent entity, or invalid namespace will return a controlled error message in the `warnings` array, avoiding a hard server crash.
- Cross-tenant access attempts will return `Namespace access denied`.

## 7. Explicit Non-Goals
- **No Auto-Write**: Agents cannot inject memories.
- **No External Network Calls**: The MCP server strictly queries the local SQLite DB.
- **No Path Traversal**: No parameters accept file paths. DB path is hardcoded/injected at server start.
- **No Graph/RAG Fusion**: This contract strictly covers the symbolic SQLite Graph Sidecar. Unstructured RAG remains separate.
- **No Export All**: `exportGraph` is intentionally omitted from the MCP surface.
