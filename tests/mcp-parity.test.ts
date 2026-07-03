import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { getAuthorizedTools } from '../src/mcp/capabilities.ts';
import { handleToolCall, handleResourceRead } from '../src/mcp/tools.ts';
import { initGraph, closeGraph } from '../src/graph.ts';
import { VERSION } from '../src/version.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('MCP transport parity — INCOHÉRENCE #10 / R1', async (t) => {
  initGraph(':memory:');

  await t.test('every tool in the fixtures contract is implemented by the shared handler', async () => {
    for (const tool of getAuthorizedTools()) {
      let methodNotFound = false;
      try {
        // Empty args: tools must reject with InvalidParams (or execute),
        // but NEVER MethodNotFound — that would mean a transport gap.
        await handleToolCall(tool.name, {});
      } catch (err: any) {
        if (err instanceof McpError && err.code === ErrorCode.MethodNotFound) {
          methodNotFound = true;
        }
      }
      assert.strictEqual(methodNotFound, false, `Tool '${tool.name}' is missing from the shared handler`);
    }
  });

  await t.test('unknown tools are rejected with MethodNotFound', async () => {
    await assert.rejects(
      () => handleToolCall('agentmemory_nonexistent_tool', {}),
      (err: any) => err instanceof McpError && err.code === ErrorCode.MethodNotFound
    );
  });

  await t.test('both transports import the shared tool module (no drift possible)', () => {
    const serverSrc = fs.readFileSync(path.resolve(__dirname, '../src/mcp/server.ts'), 'utf8');
    const gatewaySrc = fs.readFileSync(path.resolve(__dirname, '../src/mcp/gateway.ts'), 'utf8');

    for (const [name, src] of [['server.ts', serverSrc], ['gateway.ts', gatewaySrc]] as const) {
      assert.ok(src.includes("from './tools.ts'"), `${name} must use the shared tool handlers`);
      assert.ok(src.includes('handleToolCall'), `${name} must delegate tool calls`);
      assert.ok(src.includes('handleResourceRead'), `${name} must delegate resource reads`);
    }

    // No inline tool implementations left behind in either transport
    for (const [name, src] of [['server.ts', serverSrc], ['gateway.ts', gatewaySrc]] as const) {
      assert.ok(!src.includes("name === 'agentmemory_"), `${name} must not re-implement tool routing inline`);
    }
  });

  await t.test('health resource reports the package.json version on both transports (BUG #4)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    assert.strictEqual(VERSION, pkg.version, 'VERSION constant must mirror package.json');

    for (const transport of ['stdio', 'sse'] as const) {
      const result = handleResourceRead('agentmemory://health', transport);
      const health = JSON.parse(result.contents[0].text);
      assert.strictEqual(health.version, pkg.version, `${transport} health version must match package.json`);
      assert.strictEqual(health.transport, transport);
    }
  });

  await t.test('latest_updates exposes the next sleep cycle when the worker has run', async () => {
    // Simulate the worker having recorded its last cycle in worker_meta
    // (worker and graph share the same DB file in deployment; a temp file
    // DB reproduces that here).
    const { default: Database } = await import('better-sqlite3');
    const tmpDir = path.resolve(__dirname, '../data');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmpDb = path.join(tmpDir, `parity-sleep-${process.pid}.db`);
    if (fs.existsSync(tmpDb)) fs.rmSync(tmpDb);

    const writer = new Database(tmpDb);
    writer.exec(`CREATE TABLE worker_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    const lastRun = '2026-07-01T00:00:00.000Z';
    writer.prepare(`INSERT INTO worker_meta (key, value) VALUES ('last_sleep_cycle_at', ?)`).run(lastRun);
    writer.close();

    closeGraph();
    initGraph(tmpDb, false);
    const result = await handleToolCall('agentmemory_latest_updates', { namespace: 'org:parity_ns' });
    const lines = result.content[0].text.split('\n').filter(Boolean);
    const metaLine = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(metaLine.meta, 'sleep_cycle');
    assert.strictEqual(metaLine.last_run_at, lastRun);
    assert.ok(new Date(metaLine.next_run_at) > new Date(metaLine.last_run_at), 'next_run_at must be after last_run_at');

    closeGraph();
    try { fs.rmSync(tmpDb); } catch { /* Windows may hold the WAL briefly */ }
    initGraph(':memory:'); // restore for remaining subtests
  });

  await t.test('latest_updates omits the sleep line when the worker never ran', async () => {
    const result = await handleToolCall('agentmemory_latest_updates', { namespace: 'org:parity_ns' });
    assert.ok(!result.content[0].text.includes('sleep_cycle'));
  });

  await t.test('gateway routes POST /message strictly by sessionId (BUG #3)', () => {
    const gatewaySrc = fs.readFileSync(path.resolve(__dirname, '../src/mcp/gateway.ts'), 'utf8');
    assert.ok(gatewaySrc.includes('req.query.sessionId'), 'must read sessionId from the query string');
    assert.ok(gatewaySrc.includes('activeTransports.get(sessionId)'), 'must look up the exact transport');
    assert.ok(!gatewaySrc.includes('for (const [, entry] of activeTransports)'), 'must not broadcast to all transports');
    assert.ok(gatewaySrc.includes('transport.sessionId'), 'must key transports by their own sessionId');
  });

  closeGraph();
});
