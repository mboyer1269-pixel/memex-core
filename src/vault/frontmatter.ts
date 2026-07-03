/**
 * Minimal YAML frontmatter codec for Vault files.
 * Handles exactly the subset this project emits:
 *   - scalar values: quoted strings, numbers, booleans, bare words
 *   - inline arrays of quoted strings: ["a", "b"]
 *
 * This is NOT a general YAML parser — it round-trips the frontmatter
 * that writeVaultFile() itself generates, which is all the Vault needs.
 */

export type FrontmatterValue = string | number | boolean | string[];
export type FrontmatterMap = Record<string, FrontmatterValue>;

export interface ParsedVaultFile {
  meta: FrontmatterMap;
  body: string;
}

function unquote(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  return trimmed;
}

function parseScalar(raw: string): FrontmatterValue {
  const trimmed = raw.trim();

  // Inline array of quoted strings
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner === '') return [];
    // Split on commas that are not inside quotes
    const items: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '"' && inner[i - 1] !== '\\') inQuotes = !inQuotes;
      if (ch === ',' && !inQuotes) {
        items.push(unquote(current));
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim() !== '') items.push(unquote(current));
    return items;
  }

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  const asNumber = Number(trimmed);
  if (trimmed !== '' && !trimmed.startsWith('"') && !Number.isNaN(asNumber)) {
    return asNumber;
  }

  return unquote(trimmed);
}

/**
 * Split a vault file into { meta, body }.
 * If no frontmatter block is present, meta is empty and body is the input.
 */
export function parseFrontmatter(content: string): ParsedVaultFile {
  if (!content.startsWith('---')) {
    return { meta: {}, body: content };
  }

  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) {
    return { meta: {}, body: content };
  }

  const block = content.substring(3, endIdx);
  const body = content.substring(endIdx + 4).replace(/^\r?\n/, '');

  const meta: FrontmatterMap = {};
  for (const line of block.split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.substring(0, sep).trim();
    const rawValue = line.substring(sep + 1);
    if (key === '') continue;
    meta[key] = parseScalar(rawValue);
  }

  return { meta, body };
}

function serializeValue(value: FrontmatterValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(', ')}]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

/** Keys emitted first, in stable order, for readable diffs in Obsidian/git. */
const CANONICAL_KEY_ORDER = [
  'updated_at',
  'created_at',
  'confidence',
  'source_session',
  'status',
  'kind',
  'contradicts',
  'tags',
];

export function serializeFrontmatter(meta: FrontmatterMap): string {
  const lines: string[] = ['---'];
  const emitted = new Set<string>();

  for (const key of CANONICAL_KEY_ORDER) {
    if (key in meta && meta[key] !== undefined) {
      lines.push(`${key}: ${serializeValue(meta[key])}`);
      emitted.add(key);
    }
  }
  // Preserve any extra keys (unknown provenance fields survive rewrites)
  for (const key of Object.keys(meta)) {
    if (!emitted.has(key) && meta[key] !== undefined) {
      lines.push(`${key}: ${serializeValue(meta[key])}`);
    }
  }

  lines.push('---', '');
  return lines.join('\n');
}

/** Union two string arrays preserving order and uniqueness. */
export function unionArrays(a: string[] | undefined, b: string[] | undefined): string[] {
  const out: string[] = [];
  for (const item of [...(a ?? []), ...(b ?? [])]) {
    if (!out.includes(item)) out.push(item);
  }
  return out;
}
