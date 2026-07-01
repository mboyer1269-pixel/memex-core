# Changelog

All notable changes to AgentMemory Hub are documented here.

## 0.5.0 - Graph Sidecar Prototype

- Added `src/graph.ts` powered by `better-sqlite3`.
- Added new CLI scripts: `graph-init`, `graph-add-entity`, `graph-add-relation`, `graph-query`, `graph-context-pack`, `graph-export`.
- Added local graph functionality without remote APIs or LLMs.

## 0.4.0 - Governance Foundation

- Added local memory governance framework without remote APIs.
- Introduced `config/memory-governance.json` to configure namespaces and retention.
- Added `governance`, `governance-check`, `namespace-list`, and `memory-policy` CLI commands to `agentmemory-hub.ps1`.
- Added Node tests to validate governance configuration and namespace logic.
- Expanded security documentation to cover namespaces and protected memories.

## 0.3.0 - CLI Operator

- Introduced `agentmemory-hub.ps1` as the primary CLI operator.
- Added commands: `help`, `doctor`, `start`, `stop`, `status`, `smoke`, `validate-clients`, `open`, `repair`.
- Made `repair` idempotent and added options for minimal local `.env` creation (`-CreateEnv`) and startup task installation (`-InstallStartupTask`).

## 0.2.0 - Repo-Grade Foundation

- Added a JSON `doctor.ps1` diagnostic script for runtime, client, port, and task validation.
- Added Node native tests for config parsing, auth behavior, MCP config, health path matching, and MCP shim presence.
- Added repository hygiene files: `.gitignore`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `ROADMAP.md`.
- Added GitHub Actions CI for Node checks, tests, PowerShell parsing, and basic secret scanning.
- Expanded documentation for architecture, security model, client support, troubleshooting, and demo flows.
- Hardened `/hub/health` route matching to use URL pathname matching.
- Pointed watchdog health checks at `/hub/health`.
- Made startup task installation resolve `pwsh` from PATH instead of using a hard-coded path.

## 0.1.0 - Local Hub

- Created a private local wrapper around `@agentmemory/agentmemory`.
- Added hub API and viewer ports for shared local agent memory.
- Added local MCP client configuration support.
- Added smoke, status, startup, and client validation scripts.
