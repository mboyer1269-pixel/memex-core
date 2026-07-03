import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MemoryStatus } from '../fabric/types.ts';
import { parseFrontmatter, serializeFrontmatter, unionArrays } from './frontmatter.ts';
import type { FrontmatterMap } from './frontmatter.ts';
import { searchFtsIndex } from './fts-index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Allow override via env var (e.g. point to an Obsidian vault elsewhere)
const VAULT_ROOT = process.env.AGENTMEMORY_VAULT_PATH
  ? path.resolve(process.env.AGENTMEMORY_VAULT_PATH)
  : path.resolve(__dirname, '../../data/vault');

const MAX_SEARCH_RESULTS = 25;

export interface VaultMetadata {
  confidence?: number;
  source_session?: string;
  /** Full fabric vocabulary — not just 'active' | 'deprecated'. */
  status?: MemoryStatus;
  contradicts?: string[];
  tags?: string[];
}

/**
 * Sanitize a relative path to prevent directory traversal.
 * Resolves the path, then verifies it stays inside VAULT_ROOT.
 */
function resolveAndGuard(filepath: string): string {
  // Normalize separators to OS-native, then resolve against vault root
  const normalized = filepath.replace(/\\/g, '/');
  const resolved = path.resolve(VAULT_ROOT, normalized);

  // Guard: resolved path MUST be VAULT_ROOT itself or live strictly inside it.
  // A bare startsWith(VAULT_ROOT) is unsafe on Windows: it lets sibling
  // directories that share the prefix pass (e.g. "...\vault_extra\evil.md").
  const guardPrefix = VAULT_ROOT.endsWith(path.sep) ? VAULT_ROOT : VAULT_ROOT + path.sep;
  if (resolved !== VAULT_ROOT && !resolved.startsWith(guardPrefix)) {
    throw new Error(`Path traversal blocked: ${filepath}`);
  }
  return resolved;
}

let _vaultInitialized = false;

function ensureVaultRoot() {
  if (_vaultInitialized) return;
  
  const dirs = [
    path.join(VAULT_ROOT, 'Agent', 'skills'),
    path.join(VAULT_ROOT, 'Agent', 'facts'),
    path.join(VAULT_ROOT, 'Agent', 'state'),
    path.join(VAULT_ROOT, 'Human'),
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }
  _vaultInitialized = true;
}

export function readVaultFile(filepath: string): string {
  ensureVaultRoot();
  const fullPath = resolveAndGuard(filepath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found in vault: ${filepath}`);
  }
  return fs.readFileSync(fullPath, 'utf8');
}

export function writeVaultFile(filepath: string, content: string, meta?: VaultMetadata): string {
  ensureVaultRoot();
  
  // Normalize to forward slashes for consistent check
  let safePath = filepath.replace(/\\/g, '/');
  
  // ZONING: Enforce that all agent writes go to the 'Agent/' namespace
  if (!safePath.startsWith('Agent/')) {
    safePath = 'Agent/' + safePath;
  }

  const fullPath = resolveAndGuard(safePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // PROVENANCE: Build YAML frontmatter with a three-way merge so partial
  // updates (e.g. deprecating a file) never destroy historical metadata:
  //   existing file on disk  <  frontmatter inside `content`  <  explicit `meta`
  const incoming = parseFrontmatter(content);
  const bodyContent = incoming.body.trimStart();

  let existingMeta: FrontmatterMap = {};
  if (fs.existsSync(fullPath)) {
    try {
      existingMeta = parseFrontmatter(fs.readFileSync(fullPath, 'utf8')).meta;
    } catch { /* unreadable existing file — start fresh */ }
  }

  const merged: FrontmatterMap = { ...existingMeta, ...incoming.meta };

  if (meta?.confidence !== undefined) merged.confidence = meta.confidence;
  if (meta?.source_session !== undefined) merged.source_session = meta.source_session;
  if (meta?.status !== undefined) merged.status = meta.status;
  // Arrays are unioned, not replaced: audit trails (contradicts, deprecated_by
  // tags) accumulate instead of silently vanishing.
  if (meta?.contradicts !== undefined) {
    merged.contradicts = unionArrays(merged.contradicts as string[] | undefined, meta.contradicts);
  }
  if (meta?.tags !== undefined) {
    merged.tags = unionArrays(merged.tags as string[] | undefined, meta.tags);
  }

  // Defaults only apply when the field is absent everywhere
  if (merged.confidence === undefined) merged.confidence = 1.0;
  if (merged.source_session === undefined) merged.source_session = 'memex-core';
  if (merged.status === undefined) merged.status = 'active';
  if (merged.created_at === undefined) merged.created_at = new Date().toISOString();
  merged.updated_at = new Date().toISOString();

  if (Array.isArray(merged.contradicts) && merged.contradicts.length === 0) delete merged.contradicts;
  if (Array.isArray(merged.tags) && merged.tags.length === 0) delete merged.tags;

  const finalContent = serializeFrontmatter(merged) + '\n' + bodyContent;

  fs.writeFileSync(fullPath, finalContent, 'utf8');
  
  // Return the path relative to vault root for logging
  const relPath = path.relative(VAULT_ROOT, fullPath).replace(/\\/g, '/');
  return `Written: ${relPath}`;
}

export function searchVault(query: string, includeDeprecated: boolean = false): any[] {
  ensureVaultRoot();

  // Fast path: SQLite FTS5 index (bm25 x confidence x recency ranking).
  // Falls back to the filesystem scan when FTS is unavailable or the query
  // produces no indexable tokens.
  const ftsResults = searchFtsIndex(VAULT_ROOT, query, includeDeprecated, MAX_SEARCH_RESULTS);
  if (ftsResults !== null) {
    return ftsResults.map(r => ({ filepath: r.filepath, preview: r.preview }));
  }

  const results: any[] = [];
  const lowerQuery = query.toLowerCase();
  
  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Skip unreadable dirs
    }
    
    for (const entry of entries) {
      // Stop early if we already have enough results
      if (results.length >= MAX_SEARCH_RESULTS) return;
      
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.txt')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          
          // Context Sifter: Filter out deprecated files unless explicitly requested
          if (!includeDeprecated && content.includes('status: "deprecated"')) {
            continue;
          }
          
          if (content.toLowerCase().includes(lowerQuery) || entry.name.toLowerCase().includes(lowerQuery)) {
            const relativePath = path.relative(VAULT_ROOT, fullPath).replace(/\\/g, '/');
            // Truncate preview to save tokens
            const previewText = content.substring(0, 200).replace(/\n/g, ' ').trim();
            results.push({
              filepath: relativePath,
              preview: previewText + (content.length > 200 ? '...' : '')
            });
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }
  
  walkDir(VAULT_ROOT);
  return results;
}

/**
 * List all files in a vault subdirectory (non-recursive).
 * Useful for Obsidian-style browsing.
 */
export function listVaultDir(subdir: string = ''): { filepath: string; isDir: boolean; size?: number }[] {
  ensureVaultRoot();
  const fullPath = resolveAndGuard(subdir || '.');
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
    return [];
  }
  
  const entries = fs.readdirSync(fullPath, { withFileTypes: true });
  return entries.map(e => ({
    filepath: path.join(subdir, e.name).replace(/\\/g, '/'),
    isDir: e.isDirectory(),
    size: e.isFile() ? fs.statSync(path.join(fullPath, e.name)).size : undefined
  }));
}
