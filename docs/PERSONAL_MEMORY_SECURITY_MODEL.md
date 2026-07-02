# Personal Memory Security Model

> **Core principle:** Memory is a trust boundary, not just storage.
> Long-term memory is a durable control channel into every agent Michael runs.
> Whoever writes into it programs Michael's future agents.

## Authority hierarchy — non-negotiable

1. **Deterministic policy code** (`src/fabric/policy.ts`) — final authority.
2. **Human approval** (Michael) — required for writes, unlocks, high-risk admissions.
3. **Ollama Librarian** — advisory. Classifies, flags, suggests. Decides nothing.

## ⚠️ Finding from code audit (2026-07-01)

`src/mcp/gateway.ts` line 94 exposes `agentmemory_write_vault_file` over HTTP,
protected by a **single shared `GATEWAY_TOKEN`**. One leaked token = remote write
access into the vault. This violates the propose→approve doctrine.

**Remediation (PR-3):** remote tool profiles. The remote read profile excludes all
write tools. Writes go through `/api/memory/propose` + approval. Until PR-3 ships,
treat `GATEWAY_TOKEN` as write-capable and rotate it accordingly.

## Token strategy

| Token | Scope | Can | Cannot |
|---|---|---|---|
| `read` token | `read_only` | search, receive context packs | propose, write, admin |
| `propose` token | `propose_only` / `read_propose` | submit `MemoryCandidate`s | write directly |
| `write` token (later) | `write` | write **with approval gate** | admin ops |
| `admin` token | `admin` | approvals, unlock, rotation | — kept off agents entirely |

Rules: one token per client, stable `tokenId` for audit (never the value), rotation
without downtime, no token in any log line.

**Defense in depth (implemented):** `effectiveScope()` caps every token at the client
kind's ceiling. An admin token presented by an `unknown` client is worth `none`.
Tested: `tests/fabric-policy.test.ts`.

## Threat model → controls

| Threat | Control (status) |
|---|---|
| Prompt injection via stored memory | Risk flag `prompt_injection_suspect` → never auto-admitted (✅ tested) |
| Tool poisoning / implicit trust | Tool profiles per scope (PR-3); registry is fixture-pinned today |
| Stale memory injection | `valid_from`/`valid_to` enforced at injection time (✅ tested) |
| Cross-client / cross-namespace leakage | Namespace gate in pack assembly — absolute (✅ tested) |
| Android token leakage | read/propose ceiling on mobile profiles; rotation; short-lived tokens (PR-4) |
| Destructive tool exposure | delete/admin blocked by default; remote write removal (PR-3) |
| Model-hallucinated writes | Everything enters as `proposed`; `proposed` is never injected (✅ tested) |
| Sycophancy from old preferences | Trust decay via validity windows + Active Forgetting deprecation |
| Tool-call drift | Future pre-action check endpoint consults failure memory |
| Secrets entering memory | `secret_material` → outright reject (✅ tested) |

## Statuses as security states

`proposed → active → verified` (trust ascent) · `deprecated / superseded` (time)
· `quarantined` (containment — reviewable, never injectable).

**Injection rule (Option A):** only `verified` is context-eligible. `active` is
system-trusted but not human-verified — it is bookkeeping, not context. This closes
the "agent plants a memory that another agent consumes" loop by construction.

**Scope composition rule:** `effectiveScope()` is a capability-set intersection
(`read/propose/write/admin` atoms), never a rank comparison. Disjoint scopes
(`read_only` vs `propose_only`) intersect to `none`. Tested adversarially.

## Audit

Every read, proposal, admission decision, approval, and rotation → append-only audit
log with `tokenId`, client kind, namespace, decision reason. Context pack responses
already embed their own audit (`items[].whyIncluded` + `excluded[].reason`).
