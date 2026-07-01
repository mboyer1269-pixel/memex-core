import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_VAULT = path.resolve(__dirname, '../data/vault_test_' + process.pid);

// Override env so the vault module uses our test directory
process.env.AGENTMEMORY_VAULT_PATH = TEST_VAULT;

// Dynamic import AFTER setting env
const { readVaultFile, writeVaultFile, searchVault, listVaultDir } = await import('../src/vault/index.ts');

function cleanup() {
  if (fs.existsSync(TEST_VAULT)) {
    fs.rmSync(TEST_VAULT, { recursive: true, force: true });
  }
}

describe('Vault Module', () => {
  beforeEach(() => { cleanup(); });
  afterEach(() => { cleanup(); });

  it('should auto-create Agent subdirectories on first write', () => {
    writeVaultFile('facts/test.md', '# Hello');
    const agentDir = path.join(TEST_VAULT, 'Agent', 'facts');
    assert.ok(fs.existsSync(agentDir), 'Agent/facts/ should exist');
  });

  it('should enforce Agent/ zoning on writes', () => {
    const result = writeVaultFile('skills/deploy.md', '# Deploy Skill');
    assert.ok(result.includes('Agent/'), `Path should be in Agent/ zone, got: ${result}`);
    
    // Even if we try to write to "Human/", it gets re-routed to Agent/Human/
    const result2 = writeVaultFile('Human/secret.md', '# Secret');
    // The file should NOT exist at vault/Human/secret.md
    assert.ok(!fs.existsSync(path.join(TEST_VAULT, 'Human', 'secret.md')),
      'Direct write to Human/ should be blocked');
  });

  it('should inject YAML frontmatter with provenance', () => {
    writeVaultFile('facts/prov.md', '# Some fact', {
      confidence: 0.85,
      source_session: 'test-session',
      status: 'active',
      tags: ['project:alpha']
    });
    const content = readVaultFile('Agent/facts/prov.md');
    assert.ok(content.startsWith('---'), 'Should start with YAML frontmatter');
    assert.ok(content.includes('confidence: 0.85'), 'Should contain confidence');
    assert.ok(content.includes('source_session: "test-session"'), 'Should contain source');
    assert.ok(content.includes('status: "active"'), 'Should contain status');
    assert.ok(content.includes('"project:alpha"'), 'Should contain tags');
    assert.ok(content.includes('# Some fact'), 'Should contain body');
  });

  it('should not double-inject frontmatter on re-write', () => {
    writeVaultFile('facts/double.md', '# Original');
    const first = readVaultFile('Agent/facts/double.md');
    
    // Re-write with new metadata
    writeVaultFile('facts/double.md', first, { confidence: 0.5 });
    const second = readVaultFile('Agent/facts/double.md');
    
    // Count how many '---' delimiters there are (should be exactly 2: open and close)
    const matches = second.match(/^---$/gm);
    assert.equal(matches?.length, 2, `Expected 2 frontmatter delimiters, got ${matches?.length}`);
  });

  it('should block path traversal', () => {
    assert.throws(() => {
      writeVaultFile('../../etc/passwd', 'evil');
    }, /Path traversal blocked/);
  });

  it('should read files from any zone (Human/ included)', () => {
    // Manually create a file in Human/ zone
    const humanDir = path.join(TEST_VAULT, 'Human');
    fs.mkdirSync(humanDir, { recursive: true });
    fs.writeFileSync(path.join(humanDir, 'notes.md'), '# My personal notes', 'utf8');
    
    const content = readVaultFile('Human/notes.md');
    assert.equal(content, '# My personal notes');
  });

  it('should filter deprecated files in search by default', () => {
    writeVaultFile('facts/old.md', '# Old fact about cats', { status: 'deprecated' });
    writeVaultFile('facts/new.md', '# New fact about cats', { status: 'active' });
    
    const results = searchVault('cats', false);
    assert.equal(results.length, 1, 'Should only return active file');
    assert.ok(results[0].filepath.includes('new'), 'Should return the active file');
  });

  it('should include deprecated files when requested', () => {
    writeVaultFile('facts/old2.md', '# Old fact about dogs', { status: 'deprecated' });
    writeVaultFile('facts/new2.md', '# New fact about dogs', { status: 'active' });
    
    const results = searchVault('dogs', true);
    assert.equal(results.length, 2, 'Should return both files');
  });

  it('should escape quotes in YAML values', () => {
    writeVaultFile('facts/quotes.md', '# Test', {
      source_session: 'session with "quotes" inside'
    });
    const content = readVaultFile('Agent/facts/quotes.md');
    assert.ok(content.includes('\\"quotes\\"'), 'Quotes should be escaped in YAML');
  });

  it('listVaultDir should list files in a subdirectory', () => {
    writeVaultFile('facts/a.md', '# A');
    writeVaultFile('facts/b.md', '# B');
    
    const items = listVaultDir('Agent/facts');
    assert.ok(items.length >= 2, `Should have at least 2 files, got ${items.length}`);
    assert.ok(items.some(i => i.filepath.includes('a.md')));
  });
});
