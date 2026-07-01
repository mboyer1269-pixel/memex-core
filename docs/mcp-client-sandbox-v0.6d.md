# MCP Client Sandbox (v0.6d.1)

## Objectif
Le but de ce Sandbox est de valider le serveur MCP en conditions réelles via un client standard (le SDK MCP officiel) configuré avec **zéro capacités**. Ce verrou garantit que la sécurité locale est testée sans exposer de fichiers au niveau système (`roots`), sans échantillonnage LLM (`sampling`) et sans sollicitation de l'utilisateur (`elicitation`).

## Commandes PowerShell
Pour tester le sandbox localement :
```powershell
# Vérifier la compilation et la structure de base du serveur
node --experimental-strip-types --check src/mcp/server.ts

# Lancer la suite de test Sandbox (comportement d'intégration MCP)
npm test tests/mcp-client-sandbox.test.ts

# Lancer le script d'inspection lisible (résumé d'exécution)
node --experimental-strip-types scratch/mcp-client-sandbox.ts
```

## Version SDK Détectée
Le SDK `package.json` est épinglé à :
- **`@modelcontextprotocol/sdk` : `1.0.1`**
Cela protège la stabilité du système face aux versions en développement (pré-alpha v2).

## Résultats Attendus
1. Le client se connecte avec succès via `stdio`.
2. `listTools` retourne exactement 2 outils (`agentmemory_graph_query`, `agentmemory_context_pack`).
3. `listResources` retourne exactement 2 ressources (`agentmemory://health`, `agentmemory://schema`).
4. Les outils retournent du contenu Markdown et JSON parfaitement stable.
5. À la fin, le `transport.close()` détruit proprement le processus Node.js sous-jacent.

## Tests Négatifs (Sécurité)
Le script Sandbox lance volontairement un appel contenant un UUID invalide (`invalid-id-here`) pour `agentmemory_context_pack`.
- Le serveur MCP ne plante pas.
- Le message d'erreur natif SQLite est **sanitisé**.
- Le client reçoit le `warnings: ["Invalid centerEntityId or entity not found."]`.

## Limites de Sécurité Confirmées
- **Read-Only Strict** : Aucune mutation mémoire n'est permise ni exposée.
- **Isolation d'Accès** : L'intégration Oria Live est totalement bannie du bac à sable.

## Risques Restants
- Comme SQLite gère tout en mode fichier local, si un client externe tente de bombarder le serveur MCP en mode asynchrone, des verrous (locks) au niveau système d'exploitation pourraient temporairement ralentir les réponses (EBUSY exception).

## Recommandation
**GO pour v0.6e (External Client Config Pack).**
Le serveur se comporte exactement comme un serveur MCP certifié et son bac à sable est impénétrable face aux appels corrompus.
