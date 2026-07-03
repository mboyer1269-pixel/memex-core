/**
 * P0 protocol hardening — access control, signed handles, stateless RPC.
 *
 * Negative tests are the point: read_only callers must be denied writes,
 * 'none' callers must be denied everything, expired/tampered handles must
 * be rejected, and handles must never escalate past the gateway default.
 */
import test from 'node:test';
import assert from 'node:assert';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import {
  decideAccess,
  canDowngradeTo,
  isAccessLevel,
  WRITE_TOOLS,
  READ_TOOLS
} from '../src/mcp/access.ts';
import { mintHandle, verifyHandle } from '../src/mcp/handles.ts';
import { guardedToolCall, dispatchStatelessRpc, resolveHttpCaller } from '../src/mcp/unified-server.ts';
import { getAuthorizedTools } from '../src/mcp/capabilities.ts';
import { initGraph, closeGraph } from '../src/graph.ts';

const SECRET = 'test-secret-0123456789abcdef';

test('decideAccess — pure policy', async (t) => {
  await t.test('every contract tool is classified as read or write', () => {
    for (const tool of getAuthorizedTools()) {
      const classified = READ_TOOLS.has(tool.name) || WRITE_TOOLS.has(tool.name);
      assert.ok(classified, `Tool '${tool.name}' must be classified in access.ts`);
    }
  });

  await t.test("access 'none' denies every tool, read or write", () => {
    for (const tool of getAuthorizedTools()) {
      const decision = decideAccess('none', tool.name);
      assert.strictEqual(decision.allowed, false, `'none' must be denied ${tool.name}`);
    }
  });

  await t.test("read_only allows reads, denies ALL writes", () => {
    for (const name of READ_TOOLS) {
      assert.strictEqual(decideAccess('read_only', name).allowed, true, `read_only must reach ${name}`);
    }
    for (const name of WRITE_TOOLS) {
      const decision = decideAccess('read_only', name);
      assert.strictEqual(decision.allowed, false, `read_only must NOT reach ${name}`);
      assert.match(decision.reason, /requires read_write/, 'denial must carry the precise reason');
    }
  });

  await t.test('read_write allows reads and writes', () => {
    for (const name of [...READ_TOOLS, ...WRITE_TOOLS]) {
      assert.strictEqual(decideAccess('read_write', name).allowed, true);
    }
  });

  await t.test('unknown tools are treated as writes (fail closed)', () => {
    assert.strictEqual(decideAccess('read_only', 'agentmemory_future_tool').allowed, false);
    assert.strictEqual(decideAccess('read_write', 'agentmemory_future_tool').allowed, true);
  });

  await t.test('canDowngradeTo never allows escalation', () => {
    assert.strictEqual(canDowngradeTo('read_only', 'read_write'), false);
    assert.strictEqual(canDowngradeTo('read_only', 'none'), true);
    assert.strictEqual(canDowngradeTo('read_write', 'read_only'), true);
    assert.strictEqual(canDowngradeTo('none', 'read_only'), false);
  });

  await t.test('isAccessLevel rejects junk', () => {
    assert.strictEqual(isAccessLevel('read_write'), true);
    assert.strictEqual(isAccessLevel('root'), false);
    assert.strictEqual(isAccessLevel(42), false);
    assert.strictEqual(isAccessLevel(undefined), false);
  });
});

test('handles — signed, expirable, downgrade-only', async (t) => {
  await t.test('mint → verify roundtrip preserves subject and scope', () => {
    const handle = mintHandle('hermes_agent', 'read_only', SECRET, 3600);
    const verdict = verifyHandle(handle, SECRET);
    assert.ok(verdict.ok);
    assert.strictEqual(verdict.payload.sub, 'hermes_agent');
    assert.strictEqual(verdict.payload.access, 'read_only');
  });

  await t.test('expired handles are rejected', () => {
    const past = new Date('2026-01-01T00:00:00Z');
    const handle = mintHandle('hermes_agent', 'read_only', SECRET, 60, past);
    const verdict = verifyHandle(handle, SECRET, new Date('2026-01-01T00:02:00Z'));
    assert.strictEqual(verdict.ok, false);
    assert.match((verdict as any).error, /expired/);
  });

  await t.test('tampered payloads are rejected (signature mismatch)', () => {
    const handle = mintHandle('hermes_agent', 'read_only', SECRET, 3600);
    const [prefix, payload, sig] = handle.split('.');
    // Forge a payload claiming read_write with the old signature
    const forged = Buffer.from(
      JSON.stringify({ sub: 'hermes_agent', access: 'read_write', exp: 9999999999, iat: 0 }),
      'utf8'
    ).toString('base64url');
    const verdict = verifyHandle(`${prefix}.${forged}.${sig}`, SECRET);
    assert.strictEqual(verdict.ok, false);
    assert.match((verdict as any).error, /signature/);
  });

  await t.test('wrong secret is rejected', () => {
    const handle = mintHandle('hermes_agent', 'read_only', SECRET, 3600);
    const verdict = verifyHandle(handle, 'another-secret-0123456789abcdef');
    assert.strictEqual(verdict.ok, false);
  });

  await t.test('malformed handles are rejected without throwing', () => {
    for (const junk of ['', 'amh1', 'amh1.x', 'not-a-handle', 'amh2.a.b']) {
      const verdict = verifyHandle(junk, SECRET);
      assert.strictEqual(verdict.ok, false);
    }
  });

  await t.test('admin scope cannot be minted', () => {
    assert.throws(() => mintHandle('hermes_agent', 'admin' as any, SECRET));
  });

  await t.test('TTL is capped at 30 days', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const handle = mintHandle('hermes_agent', 'read_only', SECRET, 365 * 24 * 3600, now);
    const verdict = verifyHandle(handle, SECRET, now);
    assert.ok(verdict.ok);
    const maxExp = Math.floor(now.getTime() / 1000) + 30 * 24 * 3600;
    assert.ok(verdict.payload.exp <= maxExp, 'exp must be capped at 30 days');
  });
});

test('guardedToolCall + stateless RPC — every call goes through the gate', async (t) => {
  initGraph(':memory:');

  await t.test("read_only caller is DENIED agentmemory_write_vault_file", async () => {
    await assert.rejects(
      () => guardedToolCall(
        { access: 'read_only', subject: 'test_agent' },
        'agentmemory_write_vault_file',
        { filepath: 'Agent/facts/x.md', content: 'nope' }
      ),
      (err: any) => err instanceof McpError && /Access denied/.test(err.message)
    );
  });

  await t.test("read_only caller is DENIED agentmemory_submit_proposal", async () => {
    await assert.rejects(
      () => guardedToolCall(
        { access: 'read_only', subject: 'test_agent' },
        'agentmemory_submit_proposal',
        { tenant: 'org:t', namespace: 'org:t', content: 'x' }
      ),
      (err: any) => err instanceof McpError && /Access denied/.test(err.message)
    );
  });

  await t.test("'none' caller is DENIED even reads", async () => {
    await assert.rejects(
      () => guardedToolCall(
        { access: 'none', subject: 'test_agent' },
        'agentmemory_graph_query',
        { namespace: 'org:t' }
      ),
      (err: any) => err instanceof McpError && /Access denied/.test(err.message)
    );
  });

  await t.test('read_only caller CAN read (graph_query executes)', async () => {
    const result = await guardedToolCall(
      { access: 'read_only', subject: 'test_agent' },
      'agentmemory_graph_query',
      { namespace: 'org:t' }
    );
    assert.deepEqual(JSON.parse(result.content[0].text), []);
  });

  await t.test('stateless RPC: write denial surfaces as a JSON-RPC error, not a crash', async () => {
    const out: any = await dispatchStatelessRpc(
      { access: 'read_only', subject: 'test_agent' },
      {
        jsonrpc: '2.0', id: 7, method: 'tools/call',
        params: { name: 'agentmemory_write_vault_file', arguments: { filepath: 'x.md', content: 'y' } }
      }
    );
    assert.strictEqual(out.id, 7);
    assert.ok(out.error, 'must be an error response');
    assert.match(out.error.message, /Access denied/);
  });

  await t.test('stateless RPC: initialize / tools/list / ping respond without any session', async () => {
    const caller = { access: 'read_only' as const, subject: 'test_agent' };
    const init: any = await dispatchStatelessRpc(caller, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.strictEqual(init.result.serverInfo.name, 'memex-core-mcp');

    const tools: any = await dispatchStatelessRpc(caller, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.strictEqual(tools.result.tools.length, getAuthorizedTools().length);

    const ping: any = await dispatchStatelessRpc(caller, { jsonrpc: '2.0', id: 3, method: 'ping' });
    assert.deepEqual(ping.result, {});
  });

  await t.test('stateless RPC: notifications (no id) produce no response', async () => {
    const out = await dispatchStatelessRpc(
      { access: 'read_only', subject: 'test_agent' },
      { jsonrpc: '2.0', method: 'notifications/initialized' }
    );
    assert.strictEqual(out, null);
  });

  await t.test('stateless RPC: unknown method → MethodNotFound', async () => {
    const out: any = await dispatchStatelessRpc(
      { access: 'read_write', subject: 'test_agent' },
      { jsonrpc: '2.0', id: 9, method: 'sessions/create' }
    );
    assert.strictEqual(out.error.code, ErrorCode.MethodNotFound);
  });

  closeGraph();
});

test('resolveHttpCaller — bearer token and handle auth', async (t) => {
  const savedToken = process.env.GATEWAY_TOKEN;
  const savedSecret = process.env.AGENTMEMORY_HANDLE_SECRET;
  const savedDefault = process.env.GATEWAY_DEFAULT_ACCESS;

  process.env.GATEWAY_TOKEN = 'gw-token-123';
  process.env.AGENTMEMORY_HANDLE_SECRET = SECRET;
  delete process.env.GATEWAY_DEFAULT_ACCESS;

  await t.test('missing header → 401', () => {
    const out = resolveHttpCaller(undefined);
    assert.ok(!out.ok && out.status === 401);
  });

  await t.test('wrong token → 401', () => {
    const out = resolveHttpCaller('Bearer wrong');
    assert.ok(!out.ok && out.status === 401);
  });

  await t.test('valid gateway token → default access', () => {
    const out = resolveHttpCaller('Bearer gw-token-123');
    assert.ok(out.ok);
    assert.strictEqual(out.caller.access, 'read_write');
    assert.strictEqual(out.caller.subject, 'gateway-token');
  });

  await t.test('valid handle → per-agent identity and scope', () => {
    const handle = mintHandle('oria_hq', 'read_only', SECRET, 3600);
    const out = resolveHttpCaller(`Bearer ${handle}`);
    assert.ok(out.ok);
    assert.strictEqual(out.caller.subject, 'oria_hq');
    assert.strictEqual(out.caller.access, 'read_only');
  });

  await t.test('expired handle → 401', () => {
    const past = new Date(Date.now() - 7200 * 1000);
    const handle = mintHandle('oria_hq', 'read_only', SECRET, 60, past);
    const out = resolveHttpCaller(`Bearer ${handle}`);
    assert.ok(!out.ok && out.status === 401);
    assert.match((out as any).error, /expired/);
  });

  await t.test('handle exceeding gateway default → 403 (no escalation)', () => {
    process.env.GATEWAY_DEFAULT_ACCESS = 'read_only';
    const handle = mintHandle('oria_hq', 'read_write', SECRET, 3600);
    const out = resolveHttpCaller(`Bearer ${handle}`);
    assert.ok(!out.ok && out.status === 403);
    delete process.env.GATEWAY_DEFAULT_ACCESS;
  });

  await t.test('missing GATEWAY_TOKEN → 500 (server misconfiguration is loud)', () => {
    delete process.env.GATEWAY_TOKEN;
    const out = resolveHttpCaller('Bearer anything');
    assert.ok(!out.ok && out.status === 500);
    process.env.GATEWAY_TOKEN = 'gw-token-123';
  });

  // Restore environment
  if (savedToken === undefined) delete process.env.GATEWAY_TOKEN; else process.env.GATEWAY_TOKEN = savedToken;
  if (savedSecret === undefined) delete process.env.AGENTMEMORY_HANDLE_SECRET; else process.env.AGENTMEMORY_HANDLE_SECRET = savedSecret;
  if (savedDefault === undefined) delete process.env.GATEWAY_DEFAULT_ACCESS; else process.env.GATEWAY_DEFAULT_ACCESS = savedDefault;
});
