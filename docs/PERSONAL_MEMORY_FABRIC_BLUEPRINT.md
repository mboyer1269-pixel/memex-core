# Michael Memory Fabric — Architecture Blueprint

> **Positioning:** Memex Core is Michael's personal 24/7 Memory Fabric for AI agents,
> hosted on a VPS and accessible from Android, Oria HQ, Hermes, and compatible agent clients.
>
> **Status:** Blueprint + type foundation. No runtime change in this PR.
> **Scope:** Michael-only. No SaaS, no billing, no client onboarding. Client-possible later.

---

## The one-sentence revolution

**An agent never reads "the memory". It requests an authorized, explainable,
revocable context pack — and every inclusion AND exclusion is auditable.**

This is Memory-as-Governance. Not a vector database with better marketing.

---

## The six planes

```
Michael Memory Fabric
├── 1. Access Plane          (the doors)
├── 2. Memory Kernel         (the truth)
├── 3. Trust & Policy Plane  (the locks)   ← deterministic, final authority
├── 4. Librarian Plane       (the advisor) ← Ollama, advisory only
├── 5. Projection Plane      (the packs)   ← what agents actually consume
└── 6. Client Adapter Plane  (the freedom)
```

## 1. Access Plane

| Endpoint | Transport | Status | Purpose |
|---|---|---|---|
| stdio | MCP stdio | **live today** | Claude Desktop / Cloud Cowork local |
| `/sse` + `/message` | MCP legacy HTTP+SSE | **live today** | Legacy remote clients — kept for compat |
| `/mcp` | MCP Streamable HTTP | **future PR** | Modern remote endpoint (single POST+GET endpoint per current MCP spec) |
| `/api/memory/search` | REST | future PR | Android/PWA/function-calling adapters |
| `/api/memory/propose` | REST | future PR | Controlled proposals — never direct writes |
| `/api/context/pack` | REST | future PR | Agent-ready context packs |
| `/health` | REST | **live today** | VPS monitoring (unauthenticated) |

**Known constraint (verified in code):** `@modelcontextprotocol/sdk` is pinned at `1.0.1`,
which predates the Streamable HTTP transport. The `/mcp` PR therefore requires an SDK
upgrade — done as its own PR with contract tests, never mixed into this blueprint.

**Security requirement for `/mcp` (from MCP spec guidance):** Bearer auth, Origin
validation, per-scope tool profiles, and logs that never contain the token value.

## 2. Memory Kernel

- **SQLite = source of truth.** Already in place (`better-sqlite3`).
- **Vault Markdown = human-readable audit projection.** Already in place with zoning
  (`Agent/` writable, `Human/` read-only) and path-traversal guard (verified in `src/vault/index.ts`).
- **Vector index = rebuildable, never authoritative.** LanceDB and `sqlite-vec` are
  *candidates*, not decisions. Decision by benchmark on Michael's real corpus (future PR).
- No destructive migration, ever, by default.

## 3. Trust & Policy Plane — the differentiator

Five deterministic gates. Code, not vibes. Implemented as pure functions in
`src/fabric/policy.ts` (this PR):

| Gate | Question | Implemented |
|---|---|---|
| Memory Admission Gate | Does this memory deserve to exist? | ✅ `admitMemory()` |
| Context Admission Gate | Does it deserve injection *now*? | ✅ `assembleContextPack()` gates 2–5 |
| Tool Policy Gate | May this agent call this tool? | types ready — runtime future PR |
| Client Scope Gate | read / propose / write / admin? | ✅ `decideAccess()` + `effectiveScope()` |
| Risk Gate | Can this cause leakage / drift / damage? | ✅ risk flags + high-risk review |

**Doctrine encoded in tests (29 passing):**
- Unknown client → scope ceiling `none` → everything denied. Even an admin token.
- Scope composition is **capability-set intersection**, not a rank ladder: `propose_only ∩ read_only = none`; `read_propose ∩ read_only = read_only`.
- read-only cannot write. propose-only cannot write. admin is separate, never implied.
- Non-admin write → `requiresApproval: true` (Oria propose→approve doctrine).
- **Only `verified` is injectable by default (Option A).** `active` = admitted but not human-verified — an auto-admitted agent memory can never reach another agent's context until Michael promotes it.
- Secret material is **rejected**, not stored-and-flagged.
- Missing provenance → confidence capped at 0.4 + mandatory review.
- Cross-namespace injection is impossible — exclusion is recorded, not silent.

## 4. Librarian Plane

Ollama on the VPS. Advisory only. See `OLLAMA_LIBRARIAN_MODEL.md`.

## 5. Projection Plane

Context packs are the ONLY consumption surface. Every item carries:
`why_included · source · confidence · status · valid_from/valid_to · risk_flags ·
namespace · revocation_path`. Every exclusion carries a machine-readable reason.

**Pack ranking rule (implemented):** `failure` memory ranks first, `decision` second,
then confidence. *Scar tissue beats trivia.* An agent about to act sees what already
failed before it sees what is merely true.

Named packs (future): Oria Daily Brief · Hermes Execution Context · Android Quick
Capture · Code Agent Repo Context · Risk Review Context · Decision Trail · Failure Memory.

## 6. Client Adapter Plane

See `CLIENT_COMPATIBILITY_MATRIX.md`. Hard rule: consumer mobile apps
(ChatGPT Android, Gemini Android) are **UNKNOWN** for direct custom MCP until verified.
Their profile ceiling in code is `read_only` with `mcpDirectSupport: 'unknown'`.

---

## What makes this different from Mem0 / Zep / Cognee

They have memory. Nobody sells a **governed memory boundary**:

1. **Pre-action veto (future):** `POST /api/action/check` — an agent declares intent,
   Fabric answers with relevant failure memory + policy verdict. *"Stop. This approach
   failed twice. Here's the log, the PR, and the approved alternative."*
2. **Auditable absence:** exclusions are first-class records. You can prove *why* an
   agent did NOT know something.
3. **Trust decay:** validity windows are enforced at injection time, not at write time.
4. **Read audit (future):** every context pack generation is logged — memory reads are
   as auditable as writes. The flight recorder of Michael's agent fleet.

## Implementation order (next PRs)

1. **PR-2 — Shared MCP Server Factory:** `create-server.ts` + `tool-registry.ts` so
   stdio, `/sse`, and future `/mcp` share one tool surface. Kills the current
   server.ts/gateway.ts duplication (363 + 234 lines with drift risk).
2. **PR-3 — Remote `/mcp` Streamable HTTP:** SDK upgrade + auth/scopes/Origin validation.
   Wire `decideAccess()` in front of every tool call. **Remove `write_vault_file` from
   the remote tool profile** (see security model — currently exposed with a single token).
3. **PR-4 — Android/PWA REST Gateway:** search / propose / context-pack.
4. **PR-5 — Oria/Hermes Adapter:** context packs consumed by Hermes; Oria stays cockpit.
5. **PR-6 — Librarian Evaluation:** Ollama classification + contradiction detection eval set.
6. **PR-7 — Vector Shootout:** LanceDB vs sqlite-vec on the real corpus. Benchmark, then decide.
