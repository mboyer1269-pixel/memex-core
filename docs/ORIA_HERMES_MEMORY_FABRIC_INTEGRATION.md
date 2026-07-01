# Oria HQ × Hermes × Memory Fabric — Integration Blueprint

> **Roles:** Oria HQ is the cockpit. Memex is the memory fabric. Hermes is a
> privileged **client** of memory — never its owner.

## What Oria already teaches us (verified in Oria repo)

Oria's `MEMORY_VAULT_CONTRACT.md` already encodes the right doctrine:

- Typed entries: `decision · sop · note · source · doc`
- Trust levels: `verified · proposed · draft` — **only `verified` is injected into Joris**
- Workspace isolation — never cross-read
- Human-writable first; agent proposals require CEO approval
- Doctrine: *Observer → Journaliser → Approuver → Persister → Auditer → Exécuter*

The Fabric generalizes this: Oria's `trustLevel` maps to Fabric `MemoryStatus`
(`verified` → `verified`, `proposed` → `proposed`, `draft` → excluded), and Oria's
`workspaceId` maps to Fabric namespaces.

## What Memex stores for the Oria/Hermes world

- Michael personal decisions (`decision`, namespace `personal`)
- Oria project state (`semantic`/`decision`, namespace `oria`)
- Hermes task memory (`episodic`/`procedural`, namespace `hermes`)
- **Failure memory** — what already failed, why, with links (`failure`)
- Procedural memory — SOPs (`procedural`)
- Agent handoff context (`episodic` + pack projection)

## Future context packs

| Pack | Consumer | Contents |
|---|---|---|
| Oria Daily Brief | Oria HQ dashboard | verified decisions + active risks + expiring memories |
| Hermes Execution Context | Hermes before any mission | SOPs + failure memory + constraints, ranked scar-tissue-first |
| Michael Android Capture | PWA | recent proposals awaiting approval |
| Code Agent Repo Context | Claude Code / Codex | repo decisions, failed approaches, conventions |
| Risk Review Context | Michael | everything `quarantined` or high-risk pending review |
| Decision Trail | any | chronological decision memory with provenance |

## Flow (future PRs — none of this is runtime yet)

```
Hermes → GET /api/context/pack?kind=hermes_execution&ns=hermes
Fabric → decideAccess() → assembleContextPack() → authorized pack
Hermes acts → proposes learnings → POST /api/memory/propose
Michael approves in Oria HQ → status: proposed → verified
```

**No runtime integration in this PR.** Types and doctrine only.
