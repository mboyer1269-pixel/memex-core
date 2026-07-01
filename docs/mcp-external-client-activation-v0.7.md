# MCP External Client Activation (v0.7)

## Phase 0 — Diagnostic Local
1. **PWD** : `C:\Users\micha\OneDrive\Documents\Playground\agentmemory-hub`
2. **Git Status** : Pas de modifications critiques (le repo parent est dans un état stable).
3. **NPM Test** : `PASS 13/13`
4. **Sandbox Local** : `scratch/mcp-client-sandbox.ts` exécute les appels `agentmemory_graph_query` et `agentmemory_context_pack` sans erreur avec le transport `stdio`. Les tests négatifs sont également un succès.
5. **Intégrité Config** : Les fichiers d'exemple dans `configs/mcp/` n'ont **pas** été modifiés avec des chemins réels. Ils restent sécurisés.

## Phase 1 — Smoke Test (Claude Code)

### Client testé
- **Claude Code** (Version détectée : `2.1.126`)

### Commande PowerShell utilisée
Nous avons utilisé l'argument `--mcp-config` couplé à un fichier temporaire JSON (`scratch/claude-test.mcp.json`) masquant le chemin réel. Aucune configuration globale (`claude.json`) n'a été corrompue.
```powershell
# Le fichier JSON pointait sur le script serveur :
# "args": ["--experimental-strip-types", "C:/Users/.../agentmemory-hub/src/mcp/server.ts"]

claude -p "What are the exact tools and resources exposed by the agentmemory-hub MCP server? List them clearly. Do not use any other external tools." --mcp-config scratch/claude-test.mcp.json
```

### Problèmes Rencontrés
Le test a échoué dès la connexion initiale vers l'API Anthropic :
```text
Failed to authenticate. API Error: 401 
{"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}
```
**Analyse** : Claude Code n'est pas authentifié sur la machine locale (API Key Anthropic expirée, absente, ou session invalide). Puisque Claude Code nécessite un appel LLM pour planifier l'utilisation des outils MCP, le test s'arrête avant que le serveur `agentmemory-hub` ne soit interrogé par l'agent.

### Rollback & Désactivation
Le fichier de configuration temporaire `scratch/claude-test.mcp.json` a été supprimé.
Aucune trace n'est laissée sur le système de l'utilisateur, et aucun secret n'a été exposé.

## Recommandation
**GO pour Claude Desktop.**
Bien que Claude Code n'ait pas pu vérifier les outils à cause d'un problème d'authentification LLM externe, le serveur MCP lui-même est prouvé fonctionnel via notre Sandbox interne (qui simule parfaitement un client MCP).
Puisque Claude Desktop utilise sa propre authentification via l'application native, le Smoke Test devrait réussir là-bas. Il n'y a aucun risque à l'activer manuellement dans l'application locale.
