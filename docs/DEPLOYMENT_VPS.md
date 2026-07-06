# Déploiement VPS — Memex Core comme mémoire centrale des agents

Ce runbook déploie Memex Core sur un VPS Ubuntu (Hostinger ou autre) pour
servir de **mémoire persistante et gouvernée** à tout l'écosystème :
Oria HQ (Joris), Hermes Agent, AlloMaud, tes sessions Cursor/Claude, et les
clients mobiles.

## Important: Hostinger Traefik VPS with existing agentmemory-7evd

La suite de ce runbook décrit un déploiement générique Caddy/port `3000`.
Sur le VPS Hostinger existant qui héberge déjà `agentmemory-7evd`, cette
partie est une référence générique, pas une instruction d'exécution.

Pour ce VPS Hostinger :

- ne pas installer Caddy ;
- ne pas toucher au service, au router Traefik, ni aux volumes
  `agentmemory-7evd_*` ;
- ne pas appeler `agentmemory-7evd` Memex Core ;
- utiliser le Traefik existant avec un router distinct pour Memex Core lors
  d'une phase future explicitement approuvée ;
- configurer `GATEWAY_PORT=3101` et `GATEWAY_HOST=127.0.0.1` pour Memex
  Core officiel ;
- garder les chemins dédiés `/opt/memex-core`, `/var/lib/memex-core` et
  `/etc/memex-core/memex.env` ;
- ne pas brancher Oria HQ au VPS Memex tant que le transport VPS/SSE reste
  PARK côté Oria v1.

Voir aussi
[`docs/MEMEX_CORE_VPS_DEPLOYMENT_BOUNDARY.md`](MEMEX_CORE_VPS_DEPLOYMENT_BOUNDARY.md)
pour la frontière complète entre Oria HQ, Memex Core officiel, ProofLoop et
`agentmemory-7evd`.

## 1. Architecture cible

```
                    Internet (TLS via Caddy)
                            │
        ┌───────────────────┼───────────────────────┐
        │ Oria HQ (Vercel)  │ Hermes / AlloMaud     │ Cursor / Claude
        │ POST /mcp         │ POST /mcp             │ (stdio local OU /sse)
        │ Bearer amh1.oria… │ Bearer amh1.hermes…   │
        └───────────────────┴───────────────────────┘
                            │
                   VPS ─ Caddy :443 ──► gateway 127.0.0.1:3000
                            │                (memex-gateway.service)
                            │
              ┌─────────────┼──────────────────┐
              │  vault Markdown (Obsidian)     │  /var/lib/memex-core/vault
              │  graph.db / intake.db (SQLite) │  /var/lib/memex-core/db
              └─────────────┬──────────────────┘
                            │
                   worker (memex-worker.service)
                   consolidation · contradictions · sleep cycle
                            │
                   Ollama local (llama3.2:3b) — $0 en tâches low/medium
```

Points clés :
- Le gateway n'écoute **que sur 127.0.0.1** — seul Caddy est exposé.
- Chaque agent a son **handle signé** (`amh1.*`) : identité propre pour le
  trust ledger, scope d'accès non-escaladable, expiration.
- Le chemin de lecture est à **zéro token** ; le worker n'utilise le LLM
  qu'en tâche de fond, via Ollama local d'abord (gratuit).

## 2. Prérequis

- VPS Ubuntu 22.04/24.04, **4 GB RAM minimum** (8 GB confortable pour
  Ollama 3B + services). 2 GB possible en désactivant Ollama (fallback
  OpenRouter).
- Un sous-domaine pointé sur l'IP du VPS (enregistrement A), p.ex.
  `memex.tondomaine.com`. Chez Hostinger : hPanel → DNS → ajouter
  l'enregistrement A.
- Accès SSH root (ou sudo).

## 3. Installation (une commande)

```bash
ssh root@IP_DU_VPS
curl -fsSL https://raw.githubusercontent.com/mboyer1269-pixel/memex-core/main/deploy/setup-vps.sh | bash
```

Le script est idempotent (relançable). Il installe Node 22, clone le repo
dans `/opt/memex-core`, crée l'utilisateur système `memex`, génère les
secrets dans `/etc/memex-core/memex.env` (une seule fois, jamais écrasés),
installe Ollama + `llama3.2:3b`, démarre `memex-gateway` et `memex-worker`
(systemd, redémarrage automatique), et met en place la sauvegarde
quotidienne (vault + SQLite, rétention 14 jours).

Vérification immédiate :

```bash
curl http://127.0.0.1:3000/health
# {"status":"ok","version":"0.8.0","transports":["stateless-http","sse"]}
systemctl status memex-gateway memex-worker
```

## 4. Choix par défaut importants (et pourquoi)

| Réglage | Valeur | Raison |
|---|---|---|
| `GATEWAY_DEFAULT_ACCESS` | défini explicitement à `read_only` par le script VPS | Le défaut du binaire est maintenant `read_only`. Un déploiement doit déclarer explicitement la valeur voulue au lieu d'hériter d'un accès implicite. |
| `GATEWAY_HOST` | défini explicitement à `127.0.0.1` par le script VPS | Le défaut du binaire est maintenant `127.0.0.1`. Toute exposition réseau doit être un choix explicite, derrière Caddy/TLS. |
| `OLLAMA_MODEL` | `llama3.2:3b` | Tourne sur 4 GB de RAM. Le worker s'en sert pour les tâches low/medium à 0 $. Mets `llama3` si ton VPS a 8 GB+. |
| Worker sleep cycle | 24 h (persisté) | Un redémarrage ne re-déclenche pas le cycle. |

## 5. TLS avec Caddy

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

cp /opt/memex-core/deploy/Caddyfile /etc/caddy/Caddyfile
nano /etc/caddy/Caddyfile   # remplace memex.EXAMPLE.com par ton sous-domaine
systemctl reload caddy
```

Caddy obtient et renouvelle le certificat Let's Encrypt tout seul. Test :

```bash
curl https://memex.tondomaine.com/health
```

## 6. Minter les handles des agents

Un handle par agent — c'est l'identité que le trust ledger verra :

```bash
cd /opt/memex-core
set -a; source /etc/memex-core/memex.env; set +a

npm run mint-handle -- oria_hq      read_write 2592000   # 30 jours
npm run mint-handle -- hermes_agent read_write 2592000
npm run mint-handle -- allomaud     read_only  2592000
npm run mint-handle -- michael_mobile read_only 2592000
```

Chaque commande imprime un `amh1.…` à mettre dans l'environnement du
client correspondant. Règles :
- **Downgrade-only** : avec `GATEWAY_DEFAULT_ACCESS=read_only`, un handle
  `read_write` serait refusé (403)… donc pour permettre les écritures
  nominatives, mets `GATEWAY_DEFAULT_ACCESS=read_write` dans
  `/etc/memex-core/memex.env` et redémarre. Le profil remote continue
  d'exclure `agentmemory_write_vault_file`; les écritures distantes passent
  par `agentmemory_submit_proposal`, pas par mutation directe du vault.
- Expiration max 30 jours : re-minter est une commande. Mets un rappel
  mensuel, ou un cron qui régénère et pousse les nouveaux handles vers tes
  secrets (Vercel env, n8n credentials).

## 7. Brancher les clients

### 7a. Oria HQ (le fit est direct avec ta roadmap P0 « Memory Vault »)

Le README d'Oria HQ liste ce qui manque au Memory Vault : *HTTP API,
persistance (le store in-memory se vide au restart)*. Memex Core fournit
exactement ça. Correspondance :

| Besoin Oria HQ | Outil Memex Core |
|---|---|
| Proposer une mémoire (propose → approve) | `agentmemory_submit_proposal` (statut `proposed`, promotion gouvernée par le worker + trust) |
| Lecture Joris (entrées vérifiées, max 20) | `agentmemory_librarian_brief` / `agentmemory_latest_updates` (budget de tokens explicite) |
| Mémoire typée decision / SOP / note | kinds `decision` / `procedural` / `semantic` (frontmatter `kind:`) |
| Audit et provenance | YAML frontmatter (`source_session`, `confidence`, `status`) + trust ledger |
| Pas de vector DB | FTS5 BM25 × confiance × décroissance — zéro embedding, zéro token |

Client minimal côté Oria HQ (`src/server/memory/memex-client.ts`) :

```typescript
const MEMEX_URL = process.env.MEMEX_MCP_URL!;      // https://memex.tondomaine.com/mcp
const MEMEX_HANDLE = process.env.MEMEX_HANDLE!;    // amh1.… (handle oria_hq)

async function memexCall(tool: string, args: Record<string, unknown>) {
  const res = await fetch(MEMEX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MEMEX_HANDLE}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });
  const rpc = await res.json();
  if (rpc.error) throw new Error(`Memex: ${rpc.error.message}`);
  return rpc.result.content[0].text;
}

// Lecture Joris — brief contextuel borné en tokens, zéro LLM côté Memex
export function jorisBrief(task: string) {
  return memexCall('agentmemory_librarian_brief', {
    namespace: 'org:michael-hq', task, tokenBudget: 2000,
  });
}

// Écriture gouvernée — entre en quarantaine `proposed`, jamais direct
export function proposeMemory(content: string) {
  return memexCall('agentmemory_submit_proposal', {
    tenant: 'org:michael-hq', namespace: 'org:michael-hq',
    proposedBy: 'joris', sourceClient: 'oria_hq',
    content, confidence: 0.8,
  });
}
```

Sur Vercel : ajoute `MEMEX_MCP_URL` et `MEMEX_HANDLE` dans les variables
d'environnement du projet. Le flux « Observer → Journaliser → Approuver →
Persister → Auditer » d'Oria est respecté : rien ne s'écrit en `active`
sans passer par l'intake et le worker, et ta promotion humaine en
`verified` reste possible à la main dans le vault (Obsidian).

### 7b. Hermes Agent / AlloMaud / n8n

Même pattern HTTP — un nœud n8n `HTTP Request` suffit :
- URL : `https://memex.tondomaine.com/mcp`
- Header : `Authorization: Bearer <handle de l'agent>`
- Body (JSON) : `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"agentmemory_search_vault","arguments":{"query":"…"}}}`

AlloMaud en `read_only` : il consulte la mémoire (procédures, état des
projets) mais ne peut rien écrire — le gate `decideAccess()` refuse et
renvoie la raison exacte.

### 7c. Ta machine (Cursor / Claude Desktop)

Ton setup stdio local actuel continue de fonctionner tel quel. Pour
pointer vers le VPS à la place (une seule mémoire partagée partout),
utilise `mcp-remote` :

```json
{
  "mcpServers": {
    "agentmemory": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://memex.tondomaine.com/sse",
               "--header", "Authorization: Bearer ${MEMEX_HANDLE}"]
    }
  }
}
```

### 7d. Mobile (ChatGPT / Claude)

Ajoute `https://memex.tondomaine.com/sse` comme serveur MCP distant avec le
Bearer token — même mécanique qu'avant, mais maintenant en TLS avec un
handle nominatif révocable au lieu du token racine.

## 8. Vérifier que la mémoire vit

```bash
# Le worker consolide ? (promotions, contradictions, sleep cycle)
journalctl -u memex-worker -f

# Prochain sleep cycle (observabilité exposée aux agents)
curl -s https://memex.tondomaine.com/mcp \
  -H "Authorization: Bearer $HANDLE" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"agentmemory_latest_updates","arguments":{"namespace":"org:michael-hq"}}}'
# → la dernière ligne JSONL contient {"meta":"sleep_cycle","next_run_at":…}

# Benchmark local du chemin de lecture
cd /opt/memex-core && npm run bench
```

Le vault est un dossier Obsidian normal : `rsync` ou un montage SFTP te
permet de l'ouvrir dans Obsidian depuis ton PC —
`/var/lib/memex-core/vault`.

## 9. Sauvegardes et restauration

- Automatique : `/etc/cron.daily/memex-backup` → tar du vault + `.backup`
  SQLite à chaud dans `/var/lib/memex-core/backups`, rétention 14 jours.
- Restauration : détendre le tar dans `vault/`, recopier les `.db`,
  `systemctl restart memex-gateway memex-worker`.
- Hors-site (recommandé) : rsync du dossier `backups/` vers ton PC, ou
  `rclone` vers un stockage objet.

## 10. Mise à jour

```bash
cd /opt/memex-core
git fetch --tags origin main && git reset --hard origin/main
npm ci --omit=dev
systemctl restart memex-gateway memex-worker
curl -s http://127.0.0.1:3000/health   # vérifie la version
```

(Ou relance simplement `deploy/setup-vps.sh` — idempotent.)

## 11. Récapitulatif sécurité

- TLS terminé par Caddy ; gateway jamais exposé directement.
- Écritures uniquement via handles nominatifs signés (HMAC-SHA256,
  expirables, downgrade-only) — chaque écriture est attribuée dans le
  trust ledger.
- `decideAccess()` sur chaque tool call ; outils inconnus refusés par
  défaut.
- Services systemd durcis (`ProtectSystem=strict`, utilisateur dédié sans
  shell, mémoire plafonnée).
- Les secrets vivent dans `/etc/memex-core/memex.env` (chmod 640) — jamais
  dans le repo.
