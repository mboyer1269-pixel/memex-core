# Decision Record v0.6b: OSS Alignment & Adapter Strategy

**Status**: Accepted
**Date**: 2026-06-05

## Context
AgentMemory Hub (v0.5.1 / v0.6a) currently operates on a custom, local-only SQLite graph engine. We evaluated the OSS memory landscape (Graphiti, Mem0, Cognee, MemoryGraph MCP) to determine if we should replace our core engine, adopt an MCP adapter, or stick purely to custom logic.

## Decisions (GO / NO-GO)

1. **Intégration Directe d'un Framework OSS (Graphiti, Mem0, Cognee)**
   - **Décision : NO-GO**
   - **Raisonnement** : La majorité de ces frameworks sont lourds, imposent des dépendances (Python, Neo4j) et rompent notre contrainte stricte de *zero-config, local-only TypeScript*. Intégrer un SDK de ces projets forcerait l'agent à gérer des couches de complexité incompatibles avec la vision minimaliste de la v0.5.

2. **Utilisation d'un Adapter MCP (Model Context Protocol)**
   - **Décision : GO**
   - **Raisonnement** : Exposer notre Graph Sidecar via un adaptateur MCP est la voie standardisée pour que les agents (Claude, Cursor, Antigravity) consomment et interagissent avec la mémoire locale sans avoir besoin de coder des intégrations sur mesure pour chaque IDE.

3. **Maintien du Noyau Custom SQLite (`src/graph.ts`)**
   - **Décision : GO**
   - **Raisonnement** : Notre noyau SQLite (`better-sqlite3`) répond parfaitement aux besoins (rapide, sans réseau, synchrone). Il valide les règles de multitenancy (tenant/namespace isolations) qui sont cruciales pour le blueprint Oria, ce qu'aucun projet OSS ne fait *out-of-the-box* avec la même légèreté.

## Éléments à Emprunter (OSS Inspiration)
- **De Graphiti** : L'approche *Temporal Context Graph* avec les concepts d'épisodes et de validité temporelle (`validFrom`, `validTo` déjà dans notre schéma).
- **De Cognee** : Le modèle de *Traceability* via l'enregistrement systématique de la *provenance* (déjà amorcé en v0.6a).
- **De MemoryGraph MCP** : La signature des outils MCP (`query_graph`, `add_entity`, `add_relation`) que nous implémenterons pour exposer notre SQLite local.

## Risques et Dette Technique
- **Risques** : Le passage à un MCP server impliquera la gestion du cycle de vie du processus serveur (stdio vs SSE) sur Windows, ce qui peut raviver les problèmes de processus zombies (`EBUSY` sur SQLite).
- **Dette Technique** : L'absence de nettoyage automatique (TTL, eviction policies) reste un problème. À mesure que le MCP injecte/lit des données, la base SQLite va croître sans politique de réduction.

## Prochaine Étape Recommandée (v0.6c)
Développer l'**AgentMemory MCP Adapter** (`src/mcp/server.ts`). Ce module encapsulera `getMemoryContext` et `buildMemoryPromptSection` (v0.6a) sous forme d'outils et de ressources MCP read-only, permettant aux agents compatibles de lire le graphe localement via le protocole standardisé sans écrire directement dans le Hub.
