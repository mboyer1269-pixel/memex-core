# Roadmap

## v0.2 - Repo-Grade Foundation

- Reliable diagnostics with `scripts/doctor.ps1`.
- Automated checks and tests.
- Clear architecture, security, client, demo, and troubleshooting docs.
- CI baseline for code, scripts, and secret scanning.

## v0.3 - Operator Experience

- Added a root CLI surface: `agentmemory-hub.ps1` with commands: `doctor`, `start`, `stop`, `status`, `repair`, and `open`.
- Idempotent environment config repair and checks.
- *Future*: Explore building a global Node/npm CLI wrapper (`npx agentmemory-hub`) once local Windows foundation is mature.
- Add structured logs with redaction and rotation.
- Add cross-platform startup helpers for Windows, macOS, and Linux.

## v0.4 - Governance Foundation

- Introduce local memory namespace conventions.
- Implement memory policies (core vs archival).
- Enforce strict JSON schemas and forbidden pattern matching locally.
- *Status: Completed.*

## v0.5 - Graph Memory Sidecar

- Add an experimental local JSON/SQLite sidecar for graph relationships.
- Add `create_entity` and `query_graph` MCP tools as optional extensions.
- Do not aggressively intercept proxy reads/writes until the data model is proven stable.
- *Status: Completed.*

## v0.6 - Local LLM Consolidation

- Use a strictly local LLM provider (Ollama/LM Studio) to consolidate and deduplicate memories asynchronously.
- Ensure remote API keys are never used for background tasks by default.
- Require manual dry-run/review for automatic actions.

## Later

- Evaluate remote access only through authenticated private infrastructure.
- Evaluate ChatGPT and mobile access through a secure connector.
- Evaluate production use separately from local development memory.
