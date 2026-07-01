# 🧠 Memex Core v0.7.0

**Le cerveau persistant, transparent et portable de vos agents IA.**

**Memex Core** est un serveur MCP (Model Context Protocol) qui donne à *n'importe quel* agent IA — Claude, ChatGPT, Gemini, Codex, ou votre propre agent Hermes — une mémoire à long terme structurée, un routage intelligent de modèles, et un accès mobile sécurisé.

---

## 🏆 Ce qui rend Memex Core unique

### 1. 🧹 Oubli Actif (Active Forgetting)
**Le problème :** Tous les autres systèmes de mémoire stockent tout pour toujours. Résultat : l'agent répond avec des données de 2024 alors qu'elles sont fausses en 2026.

**Notre solution :** Un Background Worker tourne en continu. S'il détecte qu'un nouveau fait contredit un ancien, il marque l'ancien comme `status: "deprecated"` — sans le supprimer. La recherche filtre automatiquement les faits dépréciés. Plus jamais d'hallucination due à des données périmées.

### 2. 🏗️ Vault Zoning (Obsidian-Compatible)
**Le problème :** Quand une IA écrit dans votre base de notes, elle pollue vos réflexions personnelles avec du "AI slop".

**Notre solution :** Le Vault est divisé en deux zones strictes :
- `Vault/Agent/` → L'IA écrit ici (facts, skills, state). Elle ne peut écrire **nulle part ailleurs**.
- `Vault/Human/` → Vos notes personnelles. L'IA peut les lire (RAG), mais **ne peut jamais y écrire**.

Ouvrez le dossier `data/vault/` dans Obsidian et vous verrez le graphe de connaissances de l'agent se construire en temps réel.

### 3. 📜 Provenance YAML (Fin de la boîte noire)
**Le problème :** Avec Mem0, Letta et les autres, vous ne savez jamais *pourquoi* l'agent se souvient de quelque chose. Impossible de déboguer.

**Notre solution :** Chaque fichier Markdown créé par l'agent inclut un en-tête YAML traçable :
```yaml
---
updated_at: "2026-07-01T14:00:00Z"
confidence: 0.95
source_session: "Claude-Mobile-Chat"
status: "active"
contradicts: ["Agent/facts/old_address.md"]
tags: ["project:hermes"]
---
```

### 4. 🧬 Smart Model Router (Sakana Fugu + Ollama + OpenRouter)
**Le problème :** Les agents utilisent toujours le même modèle coûteux, même pour des tâches triviales.

**Notre solution :** Un routeur intelligent à 3 niveaux :

| Complexité | Modèle | Coût |
|:---|:---|:---|
| `low` | Ollama local (Llama 3) → OpenRouter gratuit | **$0** |
| `medium` | Gemini Flash 1.5 | ~$0.001/requête |
| `high` | **Sakana Fugu Ultra** — orchestrateur multi-agents (TRINITY: Thinker/Worker/Verifier) | Premium |

Le Worker de consolidation utilise `low` par défaut. Quand Hermes Agent a besoin de raisonnement profond, il utilise Fugu Ultra qui coordonne automatiquement plusieurs modèles frontière.

### 5. 📱 Cloud Gateway (Accès Mobile Sécurisé)
**Le problème :** Votre mémoire est enfermée sur votre PC. Impossible d'y accéder depuis ChatGPT sur votre téléphone.

**Notre solution :** La commande `./agentmemory-hub.ps1 expose` lance un serveur SSE sécurisé. Ajoutez l'URL dans les paramètres MCP de ChatGPT/Claude/Gemini sur mobile. Votre mémoire locale devient accessible partout, protégée par un Bearer Token.

---

## ⚡ Démarrage rapide

```powershell
# 1. Installer les dépendances
npm install

# 2. Lancer le serveur MCP (stdio, pour Claude Desktop / Cursor / Gemini)
npm run mcp

# 3. Lancer le Gateway mobile (SSE, pour ChatGPT / Claude mobile)
$env:GATEWAY_TOKEN = "votre-token-secret"
npm run gateway

# 4. Lancer le Background Worker (consolidation mémoire)
$env:OPENROUTER_API_KEY = "sk-or-..."  # Optionnel si Ollama est installé
npm run worker
```

## 🗂️ Architecture

```
memex-core/
├── src/
│   ├── mcp/
│   │   ├── server.ts          # Serveur MCP stdio (local)
│   │   ├── gateway.ts         # Serveur MCP SSE (mobile/remote)
│   │   └── capabilities.ts    # Registre des outils autorisés
│   ├── vault/
│   │   └── index.ts           # Obsidian Vault (Zoning + Provenance + Search)
│   ├── ai/
│   │   ├── router.ts          # Smart Router (Ollama → OpenRouter → Fugu)
│   │   └── worker.ts          # Background Worker (Active Forgetting)
│   ├── memory/                # Librarian, Context Provider, Prompt Builder
│   ├── intake/                # Controlled Library Intake (propositions)
│   ├── db/                    # SQLite schema & intake DB
│   └── graph.ts               # Graph entities & relations
├── data/
│   └── vault/                 # 🔑 Obsidian-compatible vault
│       ├── Agent/             # Zone d'écriture de l'IA
│       │   ├── facts/         # Faits consolidés
│       │   ├── skills/        # Compétences enregistrées
│       │   └── state/         # État courant des projets
│       └── Human/             # Vos notes (lecture seule pour l'IA)
├── tests/                     # 55 tests (100% pass)
├── fixtures/                  # Contrats MCP
└── bin/
    └── memex-core.ps1         # CLI principal
```

## 🛡️ Sécurité

- **Path Traversal Protection :** Toutes les écritures sont validées avec `resolveAndGuard()`. Impossible d'écrire en dehors du Vault.
- **Zoning strict :** L'agent ne peut écrire que dans `Agent/`. Impossible de modifier vos notes dans `Human/`.
- **Bearer Token :** Le Gateway nécessite un token d'authentification pour chaque requête.
- **Quarantaine automatique :** Si le Worker échoue sur une proposition, elle est marquée `quarantined` au lieu de boucler indéfiniment.

## 🧪 Tests

```powershell
npm test
# ℹ tests 55  |  pass 55  |  fail 0
```

## 📊 Comparaison avec les alternatives

| Fonctionnalité | Memex Core | Mem0 | Letta | Cognee |
|:---|:---:|:---:|:---:|:---:|
| Mémoire long-terme | ✅ | ✅ | ✅ | ✅ |
| Oubli actif (Temporal Decay) | ✅ | ❌ | ❌ | ❌ |
| Transparence (Provenance YAML) | ✅ | ❌ | ❌ | ❌ |
| Vault Zoning (Human vs Agent) | ✅ | ❌ | ❌ | ❌ |
| Interface Obsidian native | ✅ | ❌ | ❌ | ❌ |
| Accès Mobile (SSE Gateway) | ✅ | ❌ | ❌ | ❌ |
| Routage multi-modèles intelligent | ✅ | ❌ | ❌ | ❌ |
| Fugu Ultra (Orchestration TRINITY) | ✅ | ❌ | ❌ | ❌ |
| 100% local-first (aucun cloud requis) | ✅ | ❌ | ✅ | ✅ |

## 📜 Licence

Projet privé.
