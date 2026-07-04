# AGENTS.md — Memex Core

Instructions for coding agents (Cursor, Claude Code, Codex, Gemini, etc.) working in this repository.

## Mission

Memex Core is a **local-first MCP memory server** (TypeScript, Node 22+). Agents help implement features, fix bugs, and extend tests — without breaking the human-governed vault model.

## Quick start

```powershell
npm install
pwsh ./scripts/memex-gate.ps1 doctor
pwsh ./scripts/memex-gate.ps1 gate0    # baseline before changes
# ... implement ...
pwsh ./scripts/memex-gate.ps1 gate1    # validate after changes
```

## Validation cockpit

Use `scripts/memex-gate.ps1` as the single entry point for pre-handoff validation. All output is logged under `.agent-handoff/` (gitignored).

| Command | Purpose |
|---------|---------|
| `doctor` | Environment + repo sanity (node, npm, required paths) |
| `gate0` | Baseline **before** agent work — `check` + `test` |
| `gate1` | Validation **after** agent work — `check` + `test` |
| `gateperf` | Performance only — `npm run bench` |
| `agentpack` | Writes `.agent-handoff/memex_status.md` + `agent_prompt.md` |
| `clean` | Removes generated handoff artifacts |

Full reference: [docs/AGENT_GATES.md](docs/AGENT_GATES.md).

## Scope rules

| Area | Rule |
|------|------|
| `src/` | Only change when the task requires it |
| `tests/` | Add or update tests for behavior you change |
| `package.json` | Avoid unless a new script or dependency is essential |
| ProofLoop Python | **Do not add** |
| PR #10 | **Do not merge or depend on** unless explicitly instructed |

## Architecture anchors

- **Vault zoning**: agents write only under `Vault/Agent/`; `Vault/Human/` is read-only.
- **MCP**: stateless `POST /mcp`, `decideAccess()` on every tool call.
- **Intake**: external proposals go to the intake queue — never direct graph mutation via MCP write tools without governance.
- **Read path**: FTS5 + BM25 × confidence × decay; zero LLM tokens on hot reads.

Key docs:

- `README.md` — overview and benchmarks
- `docs/PERSONAL_MEMORY_FABRIC_BLUEPRINT.md` — admission gates and fabric layers
- `docs/MCP_STATELESS_MIGRATION.md` — transport and handles
- `docs/PERSONAL_MEMORY_SECURITY_MODEL.md` — threat model

## Handoff protocol

Before ending a session or handing off to another agent:

1. Run `gate1` after your changes (and `gate0` before, if you did not already).
2. Run `agentpack`.
3. Summarize: goal, files touched, validation results, remaining risks.
4. Do not store secrets in `.agent-handoff/` or AgentMemory.

## npm scripts (do not invent parallel runners)

```powershell
npm run check    # syntax check (no emit)
npm test         # node --test full suite
npm run bench    # read-path benchmark
npm run mcp      # stdio MCP server
npm run gateway  # HTTP gateway (requires env)
```

## Style

- Match existing TypeScript patterns in `src/`.
- Prefer minimal diffs; no drive-by refactors.
- Comments only for non-obvious governance or security logic.
- PowerShell scripts: `$ErrorActionPreference = 'Stop'`, resolve repo root from `$PSScriptRoot`.
