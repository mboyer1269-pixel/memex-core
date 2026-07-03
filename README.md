# 🧠 Memex Core v0.8.0

**La mémoire d'agents que l'humain peut lire, corriger et gouverner.**

Memex Core est un serveur MCP (Model Context Protocol) qui donne à n'importe quel agent IA — Claude, ChatGPT, Gemini, Codex, Cursor, ou votre propre agent — une mémoire à long terme **locale, transparente et gouvernée**. La mémoire vit dans un vault Obsidian en Markdown : vous pouvez l'ouvrir, la lire, la corriger et la sanctuariser à la main.

## Positionnement honnête

Le domaine de la mémoire d'agents est actif (Mem0, Zep/Graphiti, Letta/MemGPT, et des travaux académiques récents convergent vers des idées proches : trust bayésien, oubli d'Ebbinghaus, local-first). Memex Core ne prétend pas être seul au monde. Ce qu'il assemble de bout en bout, et que nous n'avons pas trouvé ailleurs sous cette forme :

1. **Le vault Obsidian comme source de vérité** — la mémoire est du Markdown lisible et éditable par l'humain, pas une base opaque. Vous pouvez promouvoir une note en doctrine (`status: verified`) à la main, et l'agent la traitera comme intouchable.
2. **Une chaîne de gouvernance complète** — proposition → quarantaine → promotion pondérée par la réputation de l'agent → consolidation nocturne → handles signés par agent.
3. **Un chemin de lecture à zéro token** — les agents lisent la mémoire sans aucun appel LLM (FTS5, BM25 × confiance × décroissance temporelle). Le LLM n'intervient qu'en tâche de fond différée (distillation, contradictions).

## Chiffres mesurés (reproductibles)

```powershell
npm run bench   # BENCH_NOTES=5000 pour un vault plus gros
```

Sur 1 000 notes (machine de dev Windows, SSD) :

| Métrique | Valeur |
|:---|:---|
| Recherche à chaud p50 | ~75 ms |
| Recherche à chaud p95 | ~114 ms |
| Re-sync incrémental après 1 modification | ~86 ms |
| Appels LLM sur le chemin de lecture | **0** (par construction) |
| Tokens consommés en lecture | **0** |

```powershell
npm test
# ℹ tests 190  |  pass 190  |  fail 0
```

## Les mécanismes

### 🧹 Oubli actif + Sleep Cycle
Un Background Worker consolide la mémoire (au plus 1×/24 h, throttle persisté) :
- **Décroissance d'Ebbinghaus** par type de mémoire — \(R(t) = e^{-t/S}\), avec une stabilité propre à chaque `kind` (`semantic` 30 j, `episodic` 7 j, `procedural` 45 j, `decision` 60 j).
- **Élagage** : une mémoire `active` dont la confiance effective tombe sous 0.1 est dépréciée — jamais supprimée. La doctrine `verified` et les mémoires `failure` (tissu cicatriciel) sont intouchables.
- **Crédit de survie** : une mémoire qui traverse une période complète de 14 jours crédite la réputation de son auteur — le trust se gagne en écrivant des choses qui durent.
- Un champ `kind:` explicite dans le frontmatter prime sur l'inférence par zone (un `PROJECT.md` longue durée dans `state/` peut déclarer `kind: semantic`).

### ⚖️ Trust Ledger (réputation bayésienne par agent)
Chaque agent a un score de confiance Beta-Bernoulli alimenté par des événements observables : mémoire promue (+), quarantaine (−), dépréciation pour contradiction (−), survie (+). La confiance déclarée d'une proposition est pondérée par la réputation de son auteur avant promotion.

### 🏗️ Vault Zoning (Obsidian natif)
- `Vault/Agent/` → l'IA écrit ici (facts, skills, state) et **nulle part ailleurs**.
- `Vault/Human/` → vos notes. L'IA lit, mais **ne peut jamais y écrire**.
Chaque fichier porte une provenance YAML complète (`confidence`, `source_session`, `status`, `contradicts`, `created_at`/`updated_at`).

### 🔍 Recherche FTS5 classée
Index SQLite FTS5 incrémental (`.memex-index/`), classement BM25 × confiance × décroissance temporelle, repli automatique sur le parcours filesystem si l'index est indisponible. Injection-safe.

### 🔐 Accès gouverné (MCP stateless)
- `POST /mcp` — JSON-RPC auto-contenu par requête, zéro état de session, scale-safe.
- `decideAccess()` sur **chaque** tool call, chaque transport (`none < read_only < read_write`). Les outils inconnus échouent fermé.
- **Handles signés par agent** : `amh1.<payload>.<hmac-sha256>`, expirables (max 30 j), downgrade-only — un handle ne peut jamais escalader au-delà du défaut du gateway. Mint : `npm run mint-handle -- hermes_agent read_only 86400`.
- SSE legacy conservé pour les clients existants. Détails : `docs/MCP_STATELESS_MIGRATION.md`.

### 🧬 Smart Model Router
Le Worker route les tâches de fond vers le modèle le moins cher qui suffit (Ollama local → OpenRouter gratuit → modèles premium pour le raisonnement profond).

## ⚡ Démarrage rapide

```powershell
# 1. Installer les dépendances
npm install

# 2. Serveur MCP stdio (Claude Desktop / Cursor / Gemini)
npm run mcp

# 3. Gateway HTTP (stateless + SSE legacy, pour mobile/remote)
$env:GATEWAY_TOKEN = "votre-token-secret"
$env:AGENTMEMORY_HANDLE_SECRET = "secret-de-signature-16-chars-min"
npm run gateway

# 4. Background Worker (consolidation, distillation, sleep cycle)
$env:OPENROUTER_API_KEY = "sk-or-..."  # Optionnel si Ollama est installé
npm run worker
```

## 🗂️ Architecture

```
memex-core/
├── src/
│   ├── mcp/
│   │   ├── unified-server.ts  # Tous les transports (stdio + POST /mcp + SSE)
│   │   ├── server.ts          # Shim stdio (compat configs existantes)
│   │   ├── gateway.ts         # Shim HTTP (compat déploiements existants)
│   │   ├── tools.ts           # Logique des 10 outils MCP (source unique)
│   │   ├── access.ts          # decideAccess() — politique read/write par outil
│   │   ├── handles.ts         # Handles signés HMAC, expirables, par agent
│   │   └── capabilities.ts    # Registre des outils autorisés
│   ├── vault/
│   │   ├── index.ts           # Zoning + provenance + garde anti-traversal
│   │   ├── frontmatter.ts     # Merge YAML three-way (jamais destructif)
│   │   └── fts-index.ts       # Index FTS5 incrémental + classement
│   ├── fabric/
│   │   ├── decay.ts           # Décroissance d'Ebbinghaus par kind
│   │   ├── trust.ts           # Trust ledger bayésien par agent
│   │   ├── policy.ts          # Éligibilité au contexte
│   │   └── context-pack.ts    # Assemblage des context packs
│   ├── ai/
│   │   ├── worker.ts          # Worker (promotion, contradictions, sleep cycle)
│   │   ├── consolidate.ts     # Sleep Cycle (survie + oubli actif)
│   │   ├── distill.ts         # Distillation procédurale (traces → SOPs)
│   │   └── router.ts          # Smart Router multi-modèles
│   ├── memory/                # Librarian, Context Provider, Prompt Builder
│   ├── intake/                # File d'attente des propositions
│   └── graph.ts               # Entités & relations (SQLite, bi-temporel)
├── bench/                     # Benchmark reproductible du chemin de lecture
├── data/vault/                # 🔑 Vault Obsidian (Agent/ + Human/)
├── docs/                      # MCP_STATELESS_MIGRATION.md
├── tests/                     # 190 tests (100% pass)
└── fixtures/                  # Contrats MCP
```

## 🛡️ Sécurité

- **Anti path-traversal** : garde stricte `resolveAndGuard()` (y compris le cas Windows des répertoires frères partageant un préfixe).
- **Zoning strict** : écriture limitée à `Agent/`.
- **Auth HTTP** : Bearer token ou handle signé ; escalade de privilèges impossible (403).
- **Sandbox anti-hallucination** : les contradictions proposées par le LLM sont limitées au set de candidats qui lui a été montré.
- **Quarantaine** : une proposition qui fait échouer le Worker est isolée au lieu de boucler.

## 📜 Licence

Projet privé.
