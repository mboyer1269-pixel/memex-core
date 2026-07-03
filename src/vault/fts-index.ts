/**
 * Vault FTS5 Index — full-text search over the Obsidian vault.
 * -------------------------------------------------------------
 * The Markdown files remain the single source of truth (Obsidian keeps
 * working untouched). This SQLite FTS5 database is ONLY an index, stored
 * inside the vault under `.memex-index/` and synced incrementally from
 * file mtimes on every search. Losing it costs nothing — it self-heals.
 *
 * Ranking: bm25 relevance x stored confidence x recency decay, in a single
 * SQL query instead of an O(n) synchronous filesystem scan.
 *
 * The connection is opened and closed per call: on Windows a lingering
 * handle would lock files inside the vault (breaking cleanup/sync tools),
 * and open cost is negligible at personal-vault scale.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { parseFrontmatter } from './frontmatter.ts';

export interface FtsSearchResult {
  filepath: string;
  preview: string;
  score?: number;
}

function openIndex(vaultRoot: string): InstanceType<typeof Database> {
  const indexDir = path.join(vaultRoot, '.memex-index');
  if (!fs.existsSync(indexDir)) {
    fs.mkdirSync(indexDir, { recursive: true });
  }

  const db = new Database(path.join(indexDir, 'vault-fts.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
      filepath, content, tokenize='porter ascii'
    );
    CREATE TABLE IF NOT EXISTS vault_files (
      filepath TEXT PRIMARY KEY,
      mtime_ms REAL NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      updated_at TEXT
    );
  `);
  return db;
}

function listVaultFiles(vaultRoot: string): Array<{ rel: string; full: string; mtimeMs: number; size: number }> {
  const out: Array<{ rel: string; full: string; mtimeMs: number; size: number }> = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // skip .memex-index, .obsidian, etc.
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.txt')) {
        try {
          const stat = fs.statSync(full);
          out.push({
            rel: path.relative(vaultRoot, full).replace(/\\/g, '/'),
            full,
            mtimeMs: stat.mtimeMs,
            size: stat.size
          });
        } catch { /* skip unstatable files */ }
      }
    }
  }

  walk(vaultRoot);
  return out;
}

/**
 * Incremental sync: index new/changed files (by mtime+size), remove rows for
 * deleted files. The FTS write only happens for files that actually changed.
 */
function syncIndex(db: InstanceType<typeof Database>, vaultRoot: string): void {
  const onDisk = listVaultFiles(vaultRoot);
  const onDiskSet = new Set(onDisk.map(f => f.rel));

  const indexed = new Map<string, { mtime_ms: number; size: number }>();
  for (const row of db.prepare('SELECT filepath, mtime_ms, size FROM vault_files').all() as any[]) {
    indexed.set(row.filepath, { mtime_ms: row.mtime_ms, size: row.size });
  }

  const deleteFts = db.prepare('DELETE FROM vault_fts WHERE filepath = ?');
  const deleteMeta = db.prepare('DELETE FROM vault_files WHERE filepath = ?');
  const insertFts = db.prepare('INSERT INTO vault_fts (filepath, content) VALUES (?, ?)');
  const upsertMeta = db.prepare(`
    INSERT INTO vault_files (filepath, mtime_ms, size, status, confidence, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(filepath) DO UPDATE SET
      mtime_ms = excluded.mtime_ms,
      size = excluded.size,
      status = excluded.status,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at
  `);

  const sync = db.transaction(() => {
    // Remove rows for files that vanished
    for (const filepath of indexed.keys()) {
      if (!onDiskSet.has(filepath)) {
        deleteFts.run(filepath);
        deleteMeta.run(filepath);
      }
    }

    // Index new or changed files
    for (const file of onDisk) {
      const prev = indexed.get(file.rel);
      if (prev && prev.mtime_ms === file.mtimeMs && prev.size === file.size) continue;

      let content = '';
      try {
        content = fs.readFileSync(file.full, 'utf8');
      } catch {
        continue;
      }

      const { meta } = parseFrontmatter(content);
      const status = typeof meta.status === 'string' ? meta.status : 'active';
      const confidence = typeof meta.confidence === 'number' ? meta.confidence : 1.0;
      const updatedAt = typeof meta.updated_at === 'string' ? meta.updated_at : null;

      deleteFts.run(file.rel);
      insertFts.run(file.rel, content);
      upsertMeta.run(file.rel, file.mtimeMs, file.size, status, confidence, updatedAt);
    }
  });

  sync();
}

/**
 * Convert an arbitrary user query into a safe FTS5 MATCH expression:
 * quoted prefix tokens joined with AND. Returns null when nothing usable
 * remains (caller should fall back to the filesystem scan).
 */
export function toMatchExpression(query: string): string | null {
  const tokens = (query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
  if (tokens.length === 0) return null;
  return tokens.map(t => `"${t}"*`).join(' AND ');
}

/**
 * Ranked full-text search. Score = bm25 relevance x confidence x recency
 * decay (stability ~90 days on the file's updated_at). Deprecated files are
 * filtered unless requested — same contract as the filesystem searchVault.
 *
 * Returns null when FTS is unavailable or the query is untokenizable, so
 * callers can fall back to the filesystem scan.
 */
export function searchFtsIndex(
  vaultRoot: string,
  query: string,
  includeDeprecated: boolean = false,
  maxResults: number = 25
): FtsSearchResult[] | null {
  const match = toMatchExpression(query);
  if (!match) return null;

  let db: InstanceType<typeof Database> | null = null;
  try {
    db = openIndex(vaultRoot);
    syncIndex(db, vaultRoot);

    const rows = db.prepare(`
      SELECT
        f.filepath AS filepath,
        substr(f.content, 1, 200) AS preview_raw,
        length(f.content) AS content_length,
        (-bm25(vault_fts)) * m.confidence *
          CASE
            WHEN m.updated_at IS NULL THEN 1.0
            ELSE exp(-(max(julianday('now') - julianday(m.updated_at), 0)) / 90.0)
          END AS score
      FROM vault_fts f
      JOIN vault_files m ON m.filepath = f.filepath
      WHERE vault_fts MATCH ?
        AND (? = 1 OR m.status != 'deprecated')
      ORDER BY score DESC
      LIMIT ?
    `).all(match, includeDeprecated ? 1 : 0, maxResults) as any[];

    return rows.map(r => ({
      filepath: r.filepath,
      preview: String(r.preview_raw).replace(/\n/g, ' ').trim() + (r.content_length > 200 ? '...' : ''),
      score: r.score
    }));
  } catch {
    // FTS unavailable (old SQLite build, corrupted index, exotic query) —
    // signal the caller to use the filesystem fallback.
    return null;
  } finally {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}
