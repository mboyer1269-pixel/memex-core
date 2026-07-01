# MCP Threat Model & Mitigation v0.6c

**Version**: v0.6c-0
**Date**: 2026-06-05

This document outlines the specific threats related to deploying the local MCP server for AgentMemory Hub and how we mitigate them.

## Identified Risks

1. **Stdout Pollution**
   - *Risk*: If the server or a dependency `console.log`s arbitrary info, it corrupts the JSON-RPC stdio protocol causing the MCP client to crash or misinterpret data.
   - *Mitigation*: The server will strictly override or separate `console.log` from the stdout used by the MCP transport.

2. **Tool Injection / Excessive Tool Surface**
   - *Risk*: Exposing tools we did not intend to, allowing the agent to discover experimental features.
   - *Mitigation*: The MCP server only registers exactly what is in `mcp-tools-list.expected.json`.

3. **Path Traversal**
   - *Risk*: A tool parameter named `file` or `path` is manipulated to read outside the allowed scope.
   - *Mitigation*: No tool parameters accept file paths. Data lookup is strictly by UUID (`centerEntityId`) and string literals (`namespace`, `type`).

4. **Export Massif (Data Exfiltration)**
   - *Risk*: An agent triggers an `export_all` or `raw_db` tool to dump the entire knowledge graph into context, busting token limits and exporting tenant data unnecessarily.
   - *Mitigation*: Forbidden keywords (`export_all`, `raw_db`, `export`) are banned from tool names. Max limits (e.g., `maxEntities=50`) are hardcoded.

5. **Write Tool Accidentel**
   - *Risk*: An agent accidentally triggers an `add` or `update` tool.
   - *Mitigation*: No write tools are exposed. Forbidden names (`add`, `create`, `update`, `delete`, `write`, `mutate`) are strictly audited. `initGraph` is called with `readonly: true`.

6. **Prompt Injection via Tool Descriptions**
   - *Risk*: A malicious graph entity contains an instruction that is injected into the prompt when `buildMemoryPromptSection` processes it.
   - *Mitigation*: The bridge output is heavily structured. Markdown formatting treats names and types as literal text, but downstream agents must still treat memory contents as untrusted input.

7. **Implicit Trust Propagation**
   - *Risk*: The agent assumes memory is 100% factual.
   - *Mitigation*: We supply the `provenance` block detailing exactly where a fact came from (e.g., "Wiki", "System"), encouraging the agent to verify.

## Required Tests
- Execute `tests/mcp-contract.test.ts` to statically analyze the MCP JSON contract definitions before any server code is executed.
