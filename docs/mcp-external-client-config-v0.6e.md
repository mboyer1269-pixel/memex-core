# External Client Config Pack (v0.6e)

## Objectif
Permettre la connexion sécurisée d'AgentMemory Hub à des clients externes (Claude Desktop, Cursor, Claude Code, etc.) via le protocole MCP, en mode strictement **read-only**, local, et sans autonomie.

## Clients Couverts
1. **Claude Desktop**
2. **Claude Code** (CLI)
3. **Cursor**

## Commandes PowerShell
Les configurations sont fournies sous forme de templates JSON dans le dossier `configs/mcp/`. Vous devez remplacer la balise `<PATH_TO_AGENTMEMORY_HUB>` par le chemin absolu vers votre répertoire local.

## Où copier chaque config

### 1. Claude Desktop
Ouvrez le fichier de configuration de Claude Desktop et fusionnez le contenu de `configs/mcp/claude-desktop.local.example.json` dans la section `mcpServers`.
- Chemin Windows (PowerShell) :
  `C:\Users\%USERNAME%\AppData\Roaming\Claude\claude_desktop_config.json`

### 2. Cursor
Créez ou modifiez le fichier `.cursor/mcp.json` à la racine de votre projet ou dans vos settings globaux, et ajoutez-y la définition présente dans `configs/mcp/cursor.local.example.json`.

### 3. Claude Code
Modifiez le fichier `claude.json` de votre projet ou votre configuration globale selon la structure de `configs/mcp/claude-code.local.example.json`.

## Comment valider la connexion
Une fois configuré et le client redémarré (ex: Claude Desktop relancé), vous pouvez valider la connexion en demandant à l'agent :
> "Quels sont les outils MCP disponibles sur le serveur agentmemory-hub ?"

## Vérification de la Surface (Sécurité)
Assurez-vous que le client ne voit **strictement** que :
- 2 outils : `agentmemory_graph_query`, `agentmemory_context_pack`
- 2 ressources : `agentmemory://health`, `agentmemory://schema`
Si vous voyez d'autres outils (notamment des outils d'écriture), votre configuration pointe sur une version altérée ou non autorisée du serveur.

## Comment retirer/désactiver chaque config
Pour désactiver le serveur, supprimez simplement la clé `"agentmemory-hub"` du fichier de configuration JSON du client concerné, puis redémarrez le client.

## Risques de sécurité liés aux configs
⚠️ **Ne commitez jamais** un fichier de configuration MCP pointant vers un exécutable absolu dans un dépôt public si ce fichier contient des variables d'environnement, des chemins personnels, ou active des outils dangereux (Write/Delete).
Les exemples fournis ici sont inoffensifs (car ils ne contiennent ni chemins valides, ni secrets, ni variables d'environnement réseau), mais il reste recommandé de les exclure via `.gitignore` une fois instanciés.

## Règles strictes du serveur AgentMemory Hub v0.6e
- **Read-Only** : Aucune mutation n'est permise. Le Graph SQLite est ouvert en mode lecture seule (`initGraph(dbPath, true)`).
- **No Oria Live** : Le système est isolé de toute base de production.
- **No Write/Mutate** : Aucun outil d'ajout, de modification ou de suppression d'entités n'est exposé.

## Recommandation
**GO pour v0.7.**
L'intégration est désormais stabilisée, configurée, et documentée. Nous pouvons passer à l'étape supérieure en toute sécurité.
