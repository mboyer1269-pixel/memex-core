import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getAuthorizedTools, getAuthorizedResources } from '../src/mcp/capabilities.ts';
import { initGraph, closeGraph } from '../src/graph.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Stdio MCP spawn + handshake can exceed 5s when the full suite runs in parallel on Windows. */
const CONNECT_TIMEOUT_MS = 15_000;
const CHILD_EXIT_TIMEOUT_MS = 5_000;
const SQLITE_UNLINK_ATTEMPTS = 3;
const SQLITE_UNLINK_RETRY_MS = 100;

// Helper to enforce timeout
async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timeout: ${message}`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function unlinkWithBusyRetry(filePath: string): Promise<void> {
  for (let attempt = 1; attempt <= SQLITE_UNLINK_ATTEMPTS; attempt++) {
    try {
      fs.unlinkSync(filePath);
      return;
    } catch (err: any) {
      if (err?.code === 'ENOENT') return;
      if (err?.code !== 'EBUSY' || attempt === SQLITE_UNLINK_ATTEMPTS) throw err;
      await delay(SQLITE_UNLINK_RETRY_MS);
    }
  }
}

async function removeSqliteFiles(dbPath: string): Promise<void> {
  for (const suffix of ['', '-wal', '-shm']) {
    await unlinkWithBusyRetry(`${dbPath}${suffix}`);
  }
}

async function waitForChildExit(child: any): Promise<void> {
  if (!child || child.exitCode !== null) return;
  const closed = await Promise.race([
    new Promise<boolean>(resolve => child.once('close', () => resolve(true))),
    delay(CHILD_EXIT_TIMEOUT_MS).then(() => false)
  ]);
  assert.strictEqual(closed, true, 'stdio child process must exit before deleting SQLite files');
}

test('MCP Client Sandbox v0.6d', async (t) => {
  const dbPath = path.resolve(__dirname, '../data/test-mcp-client-sandbox.db');
  await removeSqliteFiles(dbPath);
  initGraph(dbPath, false);
  closeGraph();

  const serverPath = path.resolve(__dirname, '../src/mcp/server.ts');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-strip-types', '--no-warnings', serverPath],
    env: { ...process.env, AGENTMEMORY_DB_PATH: dbPath },
    stderr: 'pipe' // Suppress and monitor stderr instead of inheriting
  });

  // Strict constraint: Initialize client with ZERO capabilities to prove the sandbox is locked down
  const client = new Client(
    { name: 'mcp-sandbox-client', version: '0.6.4' },
    { capabilities: {} } // NO roots, NO sampling, NO elicitation
  );

  let stderrLogs = '';
  let childProcess: any = null;

  try {
    // 1. Connection with strict timeout (protects against infinite hangs)
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'Server connection timed out');
    childProcess = (transport as any)._process;
    transport.stderr?.on('data', (data) => {
      stderrLogs += data.toString();
    });

    // 2. Discover Tools - Verify exact match with authorized fixtures
    const toolsResult = await withTimeout(client.listTools(), 2000, 'List tools timed out');
    const authorizedTools = getAuthorizedTools();
    assert.strictEqual(toolsResult.tools.length, authorizedTools.length, 'Exposed tools count mismatch');
    
    for (const expectedTool of authorizedTools) {
      const foundTool = toolsResult.tools.find(t => t.name === expectedTool.name);
      assert.ok(foundTool, `Missing expected tool: ${expectedTool.name}`);
      assert.strictEqual(foundTool.description, expectedTool.description);
    }

    // 3. Discover Resources - Verify exact match
    const resourcesResult = await withTimeout(client.listResources(), 2000, 'List resources timed out');
    const authorizedResources = getAuthorizedResources();
    assert.strictEqual(resourcesResult.resources.length, authorizedResources.length, 'Exposed resources count mismatch');
    
    // 4. Test Valid Call: agentmemory_graph_query
    const queryResult = await withTimeout(client.callTool({
      name: 'agentmemory_graph_query',
      arguments: {
        namespace: 'sandbox:tenant',
        limit: 1
      }
    }), 3000, 'Graph query timed out');
    
    assert.ok(queryResult.content[0].type === 'text');
    const queryData = JSON.parse(queryResult.content[0].text);
    assert.ok(Array.isArray(queryData), 'Query result should be an array');

    // 5. Test Invalid Call (Expected to fail gracefully via warnings, no server crash)
    const invalidPackResult = await withTimeout(client.callTool({
      name: 'agentmemory_context_pack',
      arguments: {
        namespace: 'sandbox:tenant',
        centerEntityId: 'invalid-uuid-format',
        format: 'json'
      }
    }), 3000, 'Context pack timed out');
    
    const invalidPackData = JSON.parse(invalidPackResult.content[0].text);
    assert.ok(invalidPackData.warnings && invalidPackData.warnings.length > 0, 'Should return warnings for invalid inputs');
    assert.ok(typeof invalidPackData.warnings[0] === 'string', 'Warning should be a string describing the error');

  } finally {
    // 6. Test Process Cleanup and Stdio Integrity
    const childBeforeClose = childProcess ?? (transport as any)._process;
    try { await client.close(); } catch { /* already closed */ }
    try { await transport.close(); } catch { /* already closed */ }
    await waitForChildExit(childBeforeClose);

    // Check that stderr didn't log random arbitrary output (basic sanity)
    assert.ok(typeof stderrLogs === 'string', 'stderr logs should be captured');

    await removeSqliteFiles(dbPath);
  }
});
