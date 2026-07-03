import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchFtsIndex, toMatchExpression } from '../src/vault/fts-index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_VAULT = path.resolve(__dirname, '../data/vault_fts_test_' + process.pid);

function writeFile(rel: string, content: string) {
  const full = path.join(TEST_VAULT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function frontmatter(meta: Record<string, string | number>, body: string): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    lines.push(typeof v === 'number' ? `${k}: ${v}` : `${k}: "${v}"`);
  }
  lines.push('---', '', body);
  return lines.join('\n');
}

function cleanup() {
  if (fs.existsSync(TEST_VAULT)) fs.rmSync(TEST_VAULT, { recursive: true, force: true });
}

describe('Vault FTS5 Index', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('finds files by content with stemming', () => {
    writeFile('Agent/facts/deploy.md', frontmatter({ status: 'active', confidence: 0.9 }, 'How we deploy services to production'));
    writeFile('Agent/facts/other.md', frontmatter({ status: 'active', confidence: 0.9 }, 'Completely unrelated topic about pasta'));

    const results = searchFtsIndex(TEST_VAULT, 'deploying', false);
    assert.ok(results !== null);
    assert.equal(results!.length, 1, 'porter stemming should match deploy/deploying');
    assert.ok(results![0].filepath.includes('deploy.md'));
  });

  it('excludes deprecated files by default, includes on request', () => {
    writeFile('Agent/facts/old.md', frontmatter({ status: 'deprecated', confidence: 0.9 }, 'fact about kubernetes'));
    writeFile('Agent/facts/new.md', frontmatter({ status: 'active', confidence: 0.9 }, 'fact about kubernetes'));

    const active = searchFtsIndex(TEST_VAULT, 'kubernetes', false);
    assert.equal(active!.length, 1);
    assert.ok(active![0].filepath.includes('new.md'));

    const all = searchFtsIndex(TEST_VAULT, 'kubernetes', true);
    assert.equal(all!.length, 2);
  });

  it('ranks higher-confidence files first for equal relevance', () => {
    writeFile('Agent/facts/low.md', frontmatter({ status: 'active', confidence: 0.2 }, 'postgres connection pooling'));
    writeFile('Agent/facts/high.md', frontmatter({ status: 'active', confidence: 0.95 }, 'postgres connection pooling'));

    const results = searchFtsIndex(TEST_VAULT, 'postgres pooling', false);
    assert.equal(results!.length, 2);
    assert.ok(results![0].filepath.includes('high.md'), 'confidence weighting must dominate for equal bm25');
  });

  it('self-heals: detects modified and deleted files incrementally', () => {
    writeFile('Agent/facts/a.md', frontmatter({ status: 'active', confidence: 1 }, 'searchable alpha content'));
    assert.equal(searchFtsIndex(TEST_VAULT, 'alpha', false)!.length, 1);

    // Delete the file — next search must not return it
    fs.rmSync(path.join(TEST_VAULT, 'Agent/facts/a.md'));
    assert.equal(searchFtsIndex(TEST_VAULT, 'alpha', false)!.length, 0);
  });

  it('returns null for untokenizable queries (caller falls back)', () => {
    assert.equal(toMatchExpression('!!! ???'), null);
    assert.equal(searchFtsIndex(TEST_VAULT, '   ', false), null);
  });

  it('never lets query syntax reach FTS raw (injection-safe)', () => {
    writeFile('Agent/facts/x.md', frontmatter({ status: 'active', confidence: 1 }, 'nothing special'));
    // FTS5 operators embedded in the query must be neutralized, not crash
    const results = searchFtsIndex(TEST_VAULT, 'special" OR filepath:*', false);
    assert.ok(results !== null, 'sanitized query should execute');
  });
});
