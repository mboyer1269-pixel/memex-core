# MIGRATION: AgentMemory Hub to Memex Core

## État Actuel (Legacy)
Claude Desktop (et potentiellement d'autres clients) pointe actuellement sur `agentmemory-hub.ps1` et utilise la commande `npm run hub`. 
Pour éviter toute casse, **nous maintenons temporairement cette compatibilité**. Le script `agentmemory-hub.ps1` à la racine fonctionne désormais comme un pont (wrapper) redirigeant vers le nouveau moteur. 

**Vous ne devez pas redémarrer Claude Desktop tout de suite.** L'ancien processus continue de fonctionner de manière transparente avec l'ancienne configuration.

## Chemin Recommandé (Futur)
Le nouveau nom canonique du projet est **Memex Core**.
- CLI Principal futur : `bin/memex-core.ps1` (ou `npm run cli`)
- L'ancien nom `AgentMemory Hub` est considéré comme un alias legacy.

## Procédure de Redémarrage Contrôlé
Lorsque vous serez prêt à basculer officiellement la configuration de Claude :
1. Mettez à jour le fichier `claude_desktop_config.json` pour pointer vers `memex-core` (au lieu de `agentmemory-hub`).
2. Quittez complètement l'application Claude Desktop (assurez-vous qu'elle ne tourne pas en arrière-plan).
3. Relancez Claude Desktop. Le serveur MCP démarrera sur la nouvelle configuration.

## Rollback
Si le redémarrage pose un problème, vous pouvez instantanément annuler :
1. Remettez l'ancien nom `agentmemory-hub` dans le `claude_desktop_config.json`.
2. Relancez Claude Desktop. Le pont de compatibilité (`agentmemory-hub.ps1`) continuera de faire fonctionner le système sans aucune perte de données ni coupure.
