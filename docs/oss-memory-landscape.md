# Open Source Memory Landscape Analysis

This document provides a comparative analysis of the current OSS agentic memory ecosystem, aiming to inform the v0.6b architectural decisions for AgentMemory Hub.

## Comparative Overview

| Project | Core Focus | License | Main Language | Graph Support | Vector Support | Temporal | Provenance | MCP Support | Local-Only | Fit with AgentMemory Hub |
|---------|------------|---------|---------------|---------------|----------------|----------|------------|-------------|------------|--------------------------|
| **Graphiti (Zep)** | Temporal context graph | Apache 2.0 | Python | Yes (Neo4j, Falkor, Kuzu) | Yes | Yes (validity windows) | Yes (episodes) | Yes | Yes | High conceptual fit (temporal/graph), but relies heavily on Python/Neo4j stack which breaks our zero-config TS constraint. |
| **Mem0** | Memory layer (add-only) | Apache 2.0 | Python/TS | Basic (Entity linking) | Yes | Basic | Basic | No | Yes | Good for unstructured memories, lacks deep graph traversal and multi-tenant strict isolation. |
| **Cognee** | Memory control plane | Apache 2.0 | Python | Yes | Yes | Yes | Yes (traceability) | No | Yes | Excellent auditability/traceability, but Python-centric and heavy control plane. |
| **MemoryGraph MCP**| Graph-based MCP server | MIT | TypeScript | Yes (SQLite default) | Basic | No | No | Yes | Yes | High technical fit (TS + SQLite + MCP), good inspiration for the adapter layer, but lacks Oria's temporal/governance models. |
| **SQLite-Memory** | SQLite extension | MIT | C/TS | No | Yes (FTS5 + vectors)| No | Basic | No | Yes | Excellent for vector search inside SQLite, but lacks the structured graph relations we built in v0.5. |
| **Letta / MemGPT** | Stateful agents (OS) | Apache 2.0 | Python | No (Core) | Yes | Yes | Yes | No | Yes | Too heavy; focuses on the agent OS rather than a decoupled memory store. |
| **MS GraphRAG** | Graph-based RAG | MIT | Python | Yes | Yes | No | Basic | No | No (heavy LLM) | High cost/complexity for indexing. More of a methodology than a lightweight sidecar. |

## Key Findings

1. **Language Divide**: Most advanced memory frameworks (Graphiti, Cognee, Letta) are deeply rooted in Python ecosystems, making them difficult to embed invisibly within a TypeScript-first local Hub without spinning up separate Python environments.
2. **Graph Backends**: Native graph databases (Neo4j) are standard but introduce heavy dependencies. `MemoryGraph MCP` proves that SQLite is viable for local-first graph workloads, validating our v0.5 decision.
3. **Temporal Awareness**: Graphiti's validity windows perfectly align with Oria's `validFrom` / `validTo` temporal modeling.
4. **MCP Standardization**: MCP is becoming the standard for hooking agents into memory. Adapting our local SQLite sidecar into an MCP server is the most future-proof integration path.
