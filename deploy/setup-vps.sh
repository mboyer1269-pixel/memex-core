#!/usr/bin/env bash
# =============================================================================
# Memex Core — VPS bootstrap (Ubuntu 22.04/24.04, Hostinger ou autre)
# =============================================================================
# Idempotent : relançable sans casser l'existant.
#
#   curl -fsSL https://raw.githubusercontent.com/mboyer1269-pixel/memex-core/main/deploy/setup-vps.sh | sudo bash
#   # ou après clone :
#   sudo bash deploy/setup-vps.sh
#
# Ce que fait ce script :
#   1. Node.js 22 (NodeSource) + git
#   2. Utilisateur système dédié `memex` (jamais root au runtime)
#   3. Clone/pull du repo dans /opt/memex-core
#   4. Génération de /etc/memex-core/memex.env (secrets auto-générés au
#      premier passage — JAMAIS écrasés ensuite)
#   5. Ollama + modèle léger (llama3.2:3b — adapté à un VPS 4-8 GB)
#   6. Services systemd : memex-gateway + memex-worker
#   7. Sauvegarde quotidienne du vault + SQLite (cron, 14 jours de rétention)
#
# Après le script : installer Caddy (TLS) — voir docs/DEPLOYMENT_VPS.md §5.
# =============================================================================
set -euo pipefail

REPO_URL="https://github.com/mboyer1269-pixel/memex-core.git"
INSTALL_DIR="/opt/memex-core"
DATA_DIR="/var/lib/memex-core"
ENV_DIR="/etc/memex-core"
ENV_FILE="${ENV_DIR}/memex.env"
SERVICE_USER="memex"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:3b}"

log() { echo -e "\n\033[1;36m[memex-setup]\033[0m $*"; }

[ "$(id -u)" -eq 0 ] || { echo "Lance ce script avec sudo/root." >&2; exit 1; }

# ── 1. Paquets de base ──────────────────────────────────────────────────────
log "Installation de Node.js 22, git, build tools..."
apt-get update -qq
apt-get install -y -qq curl git ca-certificates build-essential python3 >/dev/null
if ! command -v node >/dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
log "Node $(node --version), npm $(npm --version)"

# ── 2. Utilisateur système ──────────────────────────────────────────────────
if ! id "${SERVICE_USER}" &>/dev/null; then
  log "Création de l'utilisateur système '${SERVICE_USER}'..."
  useradd --system --home-dir "${DATA_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

# ── 3. Code ─────────────────────────────────────────────────────────────────
if [ -d "${INSTALL_DIR}/.git" ]; then
  log "Mise à jour du repo existant..."
  git -C "${INSTALL_DIR}" fetch --tags origin main
  git -C "${INSTALL_DIR}" reset --hard origin/main
else
  log "Clone du repo dans ${INSTALL_DIR}..."
  git clone --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
fi
cd "${INSTALL_DIR}"
log "Version déployée : $(git describe --tags --always)"
log "npm ci (better-sqlite3 compile en natif, ~1 min)..."
npm ci --omit=dev --loglevel=error

# ── 4. Données + environnement ──────────────────────────────────────────────
mkdir -p "${DATA_DIR}/vault/Agent/facts" "${DATA_DIR}/vault/Agent/skills" \
         "${DATA_DIR}/vault/Agent/state" "${DATA_DIR}/vault/Human" \
         "${DATA_DIR}/db" "${DATA_DIR}/backups" "${ENV_DIR}"

if [ ! -f "${ENV_FILE}" ]; then
  log "Génération des secrets (premier passage uniquement)..."
  GATEWAY_TOKEN_GEN="$(openssl rand -hex 32)"
  HANDLE_SECRET_GEN="$(openssl rand -hex 32)"
  cat > "${ENV_FILE}" <<EOF
# ── Memex Core — environnement (généré $(date -u +%Y-%m-%dT%H:%M:%SZ)) ──
# Secrets : NE PAS commiter ce fichier. chmod 640, root:memex.

# Stockage
AGENTMEMORY_DB_PATH=${DATA_DIR}/db/graph.db
AGENTMEMORY_INTAKE_DB_PATH=${DATA_DIR}/db/intake.db
AGENTMEMORY_VAULT_PATH=${DATA_DIR}/vault

# Gateway HTTP (derrière Caddy — n'écoute que sur localhost)
GATEWAY_MODE=http
GATEWAY_HOST=127.0.0.1
GATEWAY_PORT=3000
GATEWAY_TOKEN=${GATEWAY_TOKEN_GEN}
GATEWAY_DEFAULT_ACCESS=read_only
AGENTMEMORY_HANDLE_SECRET=${HANDLE_SECRET_GEN}

# Worker
WORKER_INTERVAL_MS=60000
WORKER_SLEEP_INTERVAL_MS=86400000
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=${OLLAMA_MODEL}
# OPENROUTER_API_KEY=sk-or-...   # optionnel : fallback si Ollama sature
EOF
  chmod 640 "${ENV_FILE}"
  chgrp "${SERVICE_USER}" "${ENV_FILE}"
else
  log "Environnement existant conservé (${ENV_FILE})."
fi
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}"

# ── 5. Ollama ───────────────────────────────────────────────────────────────
if ! command -v ollama >/dev/null; then
  log "Installation d'Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
fi
systemctl enable --now ollama 2>/dev/null || true
log "Téléchargement du modèle ${OLLAMA_MODEL} (si absent)..."
ollama pull "${OLLAMA_MODEL}" || log "AVERTISSEMENT: pull ${OLLAMA_MODEL} a échoué — le worker utilisera OpenRouter si configuré."

# ── 6. Services systemd ─────────────────────────────────────────────────────
log "Installation des services systemd..."
cp "${INSTALL_DIR}/deploy/memex-gateway.service" /etc/systemd/system/
cp "${INSTALL_DIR}/deploy/memex-worker.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now memex-gateway memex-worker

# ── 7. Sauvegardes quotidiennes ─────────────────────────────────────────────
cat > /etc/cron.daily/memex-backup <<'EOF'
#!/usr/bin/env bash
# Sauvegarde quotidienne Memex Core : vault (tar) + SQLite (.backup à chaud).
set -euo pipefail
STAMP="$(date +%Y%m%d)"
DEST="/var/lib/memex-core/backups"
tar czf "${DEST}/vault-${STAMP}.tar.gz" -C /var/lib/memex-core vault
for db in graph intake; do
  if [ -f "/var/lib/memex-core/db/${db}.db" ]; then
    sqlite3 "/var/lib/memex-core/db/${db}.db" ".backup '${DEST}/${db}-${STAMP}.db'" 2>/dev/null || true
  fi
done
find "${DEST}" -type f -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/memex-backup
command -v sqlite3 >/dev/null || apt-get install -y -qq sqlite3 >/dev/null

# ── Rapport final ───────────────────────────────────────────────────────────
sleep 2
log "État des services :"
systemctl --no-pager --lines=0 status memex-gateway memex-worker || true
log "Health check local :"
curl -fsS http://127.0.0.1:3000/health && echo "" || echo "Gateway pas encore prêt — vérifie: journalctl -u memex-gateway -n 50"

cat <<EOF

═══════════════════════════════════════════════════════════════════
  Memex Core installé. PROCHAINES ÉTAPES (voir docs/DEPLOYMENT_VPS.md) :

  1. TLS : installer Caddy et copier deploy/Caddyfile (§5 du runbook)
  2. Minter un handle par agent :
       cd ${INSTALL_DIR}
       set -a; source ${ENV_FILE}; set +a
       npm run mint-handle -- oria_hq read_write 2592000
       npm run mint-handle -- hermes_agent read_write 2592000
       npm run mint-handle -- allomaud read_only 2592000
  3. Secrets générés dans : ${ENV_FILE}
═══════════════════════════════════════════════════════════════════
EOF
