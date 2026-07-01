# Adapter Strategy for AgentMemory Hub

To safely bridge the local graph SQLite sidecar with external agents without violating constraints, we evaluated three options.

## Options

### A. Custom SQLite Only (Direct IDE Integration)
- **Concept**: We maintain only `src/graph-cli.ts` and require users to write custom wrappers for their agents (e.g., specific Antigravity skills, Cursor rules, Claude scripts).
- **Pros**: Zero new dependencies, complete control over the surface area.
- **Cons**: High friction for new IDEs. Not a scalable standard.

### B. Custom SQLite + MCP Adapter (Recommended)
- **Concept**: Wrap our local `getMemoryContext` and graph querying features into a Model Context Protocol (MCP) server. Agents dynamically discover memory tools.
- **Pros**: Universal compatibility with modern agentic IDEs (Claude Desktop, Cursor, Antigravity). Maintains our local SQLite schema without external databases. Perfect separation of concerns (MCP layer calls the Read-Only Bridge v0.6a).
- **Cons**: Requires managing an MCP process over stdio.

### C. External Framework Adapter (Graphiti / Mem0 / Cognee)
- **Concept**: Replace our SQLite implementation entirely and wrap a Graphiti/Neo4j or Mem0 backend inside the Hub.
- **Pros**: Immediately access advanced features (e.g., auto-extraction, LLM embedding indexing).
- **Cons**: Violates core constraints: introduces heavy Python dependencies, requires Docker/Neo4j, breaks the local-only zero-config requirement.

## Recommendation: Option B
**Option B (Custom SQLite + MCP Adapter)** is the clear winner. It standardizes agent interaction while fiercely protecting our custom Oria-compliant SQLite backend and read-only constraints.

## Strict Boundaries: What We Must NOT Do
1. **NO Auto-Write**: The adapter must NOT automatically ingest memories from agent conversations. Ingestion remains a deliberate, governed process.
2. **NO External LLM Calls**: The adapter must NOT make OpenAI/Anthropic API calls to index embeddings. The graph remains strictly symbolic and deterministic.
3. **NO Database Replacements**: Do not swap `better-sqlite3` for a network graph database like Neo4j or Kuzu.
4. **NO Network Ports**: The MCP adapter must run over `stdio`, not a public HTTP port, preserving local security.
