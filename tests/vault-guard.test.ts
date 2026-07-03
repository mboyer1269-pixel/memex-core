import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_VAULT = path.resolve(__dirname, '../data/vault_guard_test_' + process.pid);
// Sibling directory sharing the vault path as a PREFIX — the Windows
// traversal vector: "...\vault_guard_test_123_evil" starts with
// "...\vault_guard_test_123" but is NOT inside the vault.
const EVIL_SIBLING = TEST_VAULT + '_evil';

process.env.AGENTMEMORY_VAULT_PATH = TEST_VAULT;

const { readVaultFile, writeVaultFile } = await import('../src/vault/index.ts');

function cleanup() {
  for (const dir of [TEST_VAULT, EVIL_SIBLING]) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('Vault Guard — BUG #1 (Windows sibling-prefix traversal)', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('blocks escaping to a sibling directory sharing the vault prefix', () => {
    fs.mkdirSync(EVIL_SIBLING, { recursive: true });
    fs.writeFileSync(path.join(EVIL_SIBLING, 'secret.md'), 'leaked', 'utf8');

    const siblingName = path.basename(EVIL_SIBLING);
    assert.throws(
      () => readVaultFile(`../${siblingName}/secret.md`),
      /Path traversal blocked/,
      'Reading a prefix-sibling directory must be blocked'
    );
  });

  it('still blocks classic ../ traversal', () => {
    assert.throws(() => writeVaultFile('../../etc/passwd', 'evil'), /Path traversal blocked/);
  });

  it('still allows normal nested paths', () => {
    const result = writeVaultFile('facts/nested/deep.md', '# ok');
    assert.ok(result.includes('Agent/facts/nested/deep.md'));
  });
});

describe('Vault Metadata Merge — BUG #2 (deprecation must not destroy YAML)', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('preserves confidence, source_session and tags when deprecating', () => {
    writeVaultFile('facts/keep.md', '# Original fact', {
      confidence: 0.85,
      source_session: 'session-alpha',
      status: 'active',
      tags: ['project:oria'],
      contradicts: ['facts/older.md'],
    });

    // Simulate the worker's deprecation call: partial meta only
    const oldContent = readVaultFile('Agent/facts/keep.md');
    writeVaultFile('Agent/facts/keep.md', oldContent, {
      status: 'deprecated',
      tags: ['deprecated_by:prop-42'],
    });

    const after = readVaultFile('Agent/facts/keep.md');
    assert.ok(after.includes('status: "deprecated"'), 'status updated');
    assert.ok(after.includes('confidence: 0.85'), 'confidence preserved');
    assert.ok(after.includes('source_session: "session-alpha"'), 'source_session preserved');
    assert.ok(after.includes('"project:oria"'), 'original tags preserved');
    assert.ok(after.includes('"deprecated_by:prop-42"'), 'new tag appended');
    assert.ok(after.includes('"facts/older.md"'), 'contradicts preserved');
    assert.ok(after.includes('# Original fact'), 'body preserved');

    // Still exactly one frontmatter block
    const delimiters = after.match(/^---$/gm);
    assert.equal(delimiters?.length, 2);
  });

  it('accepts the full MemoryStatus vocabulary (INCOHÉRENCE #7)', () => {
    for (const status of ['proposed', 'active', 'verified', 'deprecated', 'superseded', 'quarantined'] as const) {
      writeVaultFile(`facts/status_${status}.md`, `# ${status}`, { status });
      const content = readVaultFile(`Agent/facts/status_${status}.md`);
      assert.ok(content.includes(`status: "${status}"`), `status '${status}' should be writable`);
    }
  });

  it('stamps created_at once and refreshes updated_at on rewrite', async () => {
    writeVaultFile('facts/stamps.md', '# v1');
    const first = readVaultFile('Agent/facts/stamps.md');
    const createdAt = first.match(/created_at: "([^"]+)"/)?.[1];
    assert.ok(createdAt, 'created_at should exist');

    await new Promise(r => setTimeout(r, 10));
    writeVaultFile('Agent/facts/stamps.md', '# v2');
    const second = readVaultFile('Agent/facts/stamps.md');
    assert.equal(second.match(/created_at: "([^"]+)"/)?.[1], createdAt, 'created_at unchanged');
    assert.ok(second.includes('# v2'));
  });
});
