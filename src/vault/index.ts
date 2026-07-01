import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  status?: 'active' | 'deprecated';
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
  
  // Guard: resolved path MUST start with VAULT_ROOT
  if (!resolved.startsWith(VAULT_ROOT)) {
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

  // PROVENANCE: Build YAML frontmatter
  let bodyContent = content;
  
  // Strip existing frontmatter if present to avoid duplication
  if (bodyContent.startsWith('---')) {
    const endIdx = bodyContent.indexOf('---', 3);
    if (endIdx !== -1) {
      bodyContent = bodyContent.substring(endIdx + 3).trimStart();
    }
  }

  const timestamp = new Date().toISOString();
  const yamlLines = [
    '---',
    `updated_at: "${timestamp}"`,
    `confidence: ${meta?.confidence ?? 1.0}`,
    `source_session: "${(meta?.source_session ?? 'memex-core').replace(/"/g, '\\"')}"`,
    `status: "${meta?.status ?? 'active'}"`
  ];
  
  if (meta?.contradicts && meta.contradicts.length > 0) {
    yamlLines.push(`contradicts: [${meta.contradicts.map(c => `"${c.replace(/"/g, '\\"')}"`).join(', ')}]`);
  }
  if (meta?.tags && meta.tags.length > 0) {
    yamlLines.push(`tags: [${meta.tags.map(t => `"${t.replace(/"/g, '\\"')}"`).join(', ')}]`);
  }
  yamlLines.push('---', '');
  
  const finalContent = yamlLines.join('\n') + '\n' + bodyContent;

  fs.writeFileSync(fullPath, finalContent, 'utf8');
  
  // Return the path relative to vault root for logging
  const relPath = path.relative(VAULT_ROOT, fullPath).replace(/\\/g, '/');
  return `Written: ${relPath}`;
}

export function searchVault(query: string, includeDeprecated: boolean = false): any[] {
  ensureVaultRoot();
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
