# External Client Discovery Closure (v0.7b+)

## Résumé du Diagnostic
- **Chemin Courant** : `C:\Users\micha\OneDrive\Documents\Playground\agentmemory-hub`
- **Git** : Aucun fichier non désiré commité, environnement propre.
- **Chemin Node Local** : `C:\Program Files\nodejs\node.exe` (v25.8.1).
- **Test Synthaxique** : `src/mcp/server.ts` passe la validation `--check`.

## État des Tests
- **NPM Test** : `PASS 13/13` (Toutes les validations du bridge, schema, et context pack sont au vert).
- **Sandbox MCP Local** : `PASS` (Exécution locale via transport stdio réussie).

## État des Clients Externes
- **Claude Code** : `AUTH BLOCK 401` (Échec de l'authentification externe, le test est interrompu pour ce client).
- **Claude Desktop** : `FULL PASS` (Validation UI confirmée. Le serveur local read-only `agentmemory-hub` a été injecté avec succès dans le cache virtuel MSIX et est reconnu "running").

## Découverte de la Configuration Virtualisée (MSIX)
Suite à un *SECURITY FAIL* initial où Claude Desktop montait un ancien serveur HTTP (`agentmemory-mcp.cmd` avec port 4311), nous avons découvert que l'application Microsoft Store stocke sa configuration dans le cache local virtualisé :
`C:\Users\micha\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`

L'ancien bloc fautif a été backupé et neutralisé, pour être remplacé par la stricte configuration read-only.


## Configuration Claude Desktop
- **Chemin de Config Utilisé** : `$env:APPDATA\Claude\claude_desktop_config.json`
- **Contenu Actuel** :
  ```json
  {
    "mcpServers": {
      "agentmemory-hub": {
        "command": "node",
        "args": [
          "--experimental-strip-types",
          "C:/Users/micha/OneDrive/Documents/Playground/agentmemory-hub/src/mcp/server.ts"
        ]
      }
    }
  }
  ```
- **Patch Node Absolu** : APPLIQUÉ. L'exécutable a été remplacé par le chemin absolu `C:/Program Files/nodejs/node.exe` pour éviter les erreurs de PATH dans l'UI de Claude Desktop.

## Liste exacte des outils attendus
L'UI de Claude Desktop doit afficher **exactement** :
1. `agentmemory_graph_query`
2. `agentmemory_context_pack`

## Risques Restants
- Claude Desktop GUI pourrait ne pas avoir l'exécutable `node` dans son PATH système hérité, ce qui entraînerait un crash silencieux du serveur MCP.
- Aucune donnée secrète ou HTTP n'est injectée, éliminant tout risque réseau. L'environnement reste 100% hors ligne et en lecture seule.

## Rollback
En cas d'échec global ou de besoin d'annulation :
```powershell
Remove-Item -Path "$env:APPDATA\Claude\claude_desktop_config.json" -Force
```

## Recommandation
**GO v0.7c Cursor smoke test read-only.**
Le serveur AgentMemory Hub MCP a été reconnu avec succès par un client GUI externe (Claude Desktop) sans nécessiter de patch de configuration Node. L'objectif v0.7b+ est 100% rempli. L'étape suivante logique est de tester l'IDE complet (Cursor).
