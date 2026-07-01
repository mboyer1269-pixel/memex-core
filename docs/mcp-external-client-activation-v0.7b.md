# MCP External Client Activation (v0.7b)

## Phase 0 — Vérification Locale
- **`pwd`** : `C:\Users\micha\OneDrive\Documents\Playground\agentmemory-hub`
- **`git status`** : Stable, aucune modification indésirable.
- **`npm test`** : `PASS 13/13`
- **`scratch/mcp-client-sandbox.ts`** : `PASS` (Connecte avec succès au serveur stdio, découvre 2 tools et 2 resources, exécute `graph_query` avec succès, et gère proprement les erreurs UUID).
- **Configurations** : Les exemples (`configs/mcp/*.json`) contiennent toujours `<PATH_TO_AGENTMEMORY_HUB>`, garantissant qu'aucun chemin personnel n'est commité au dépôt.

## Phase 1A — Claude Code (AUTH BLOCK)
- L'outil Claude Code a été détecté, mais la vérification de statut (`claude doctor`) et l'appel direct ont confirmé un **AUTH BLOCK** dû à des `Invalid authentication credentials` (401).
- Conformément au protocole de sécurité stricte, nous n'avons pas cherché à contourner l'authentification ni à manipuler le système d'identifiants local. La branche de test Claude Code s'arrête ici pour la session v0.7b.

---

## Phase 1B — Activation Manuelle de Claude Desktop

Claude Desktop utilisant une authentification complètement séparée (UI de l'app), c'est la meilleure cible pour valider le Discovery MCP en "conditions réelles externes". 

Cependant, selon nos directives, l'agent IA **ne doit pas modifier votre configuration globale `claude_desktop_config.json` directement**. 

Voici la procédure manuelle stricte pour injecter la configuration, créer un backup en sécurité, et vérifier la découverte (Discovery).

### 1. Procédure PowerShell de Backup
Ouvrez votre console PowerShell standard et exécutez ces commandes pour sauvegarder votre configuration existante :
```powershell
$AppPath = "$env:APPDATA\Claude"
$ConfigPath = "$AppPath\claude_desktop_config.json"
$BackupPath = "$AppPath\claude_desktop_config.backup.json"

if (Test-Path $ConfigPath) {
    Copy-Item -Path $ConfigPath -Destination $BackupPath -Force
    Write-Host "Backup créé avec succès : $BackupPath"
} else {
    Write-Host "Le fichier de config n'existe pas encore. Procédez à l'étape 2."
}
```

### 2. Procédure d'Injection de Configuration
Ouvrez votre fichier `claude_desktop_config.json` et insérez le serveur suivant. 
*(Si le fichier n'existe pas, créez-le avec ce contenu entier)* :

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

### 3. Validation de la Découverte (Discovery)
1. Redémarrez **complètement** Claude Desktop (fermez-le depuis la barre d'état système Windows en bas à droite).
2. Lancez Claude Desktop.
3. Vérifiez l'icône **Prise murale (Plug)** en bas à droite de la boîte de texte. 
4. Cliquez dessus et cherchez les outils suivants. Vous devez voir **EXACTEMENT** :
   - `agentmemory_graph_query`
   - `agentmemory_context_pack`
5. Testez en tapant : *"Quelles sont les informations disponibles dans agentmemory-hub ?"*

### 4. Rollback / Désactivation
Pour désactiver le test, restaurez simplement votre backup :
```powershell
Copy-Item -Path $BackupPath -Destination $ConfigPath -Force
```
Puis redémarrez Claude Desktop.

---

## Recommandation
**Validation Humaine Requise.**
Veuillez exécuter la procédure Phase 1B. Une fois que vous avez confirmé le bon fonctionnement de l'icône "Plug" avec les 2 outils dans Claude Desktop, nous serons officiellement prêts avec un verdict **GO pour v0.7c Cursor ou v0.8 Harness Pack**.
