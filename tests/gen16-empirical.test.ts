import test from 'node:test';
import assert from 'node:assert';
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from 'node:fs';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { initGraph, addEntity, closeGraph, exportGraph, queryEntities } from '../src/graph.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('Gen 16 Empirical Verification', async (t) => {
    const dbPath = path.resolve(__dirname, '../data/test-gen16-mcp-server.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    // 1. Setup initial graph for queries
    initGraph(dbPath, false);
    closeGraph(); // We will write directly using better-sqlite3 for speed

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbPath);
    const insert = db.prepare(`
        INSERT INTO entities (id, type, namespace, name, source, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    db.transaction(() => {
        for (let i = 0; i < 10050; i++) {
            insert.run(`e${i}`, 'Memory', 'global', `test-entity-${i}`, 'System', new Date().toISOString(), new Date().toISOString());
        }
    })();
    db.close();

    initGraph(dbPath, false);

    const numToInsert = 10050;


    await t.test('queryEntities behaves safely when limit is omitted', () => {
        const results = queryEntities({});
        assert.strictEqual(results.length, 10000, 'queryEntities should cap at 10000 when limit is omitted');
    });

    await t.test('queryEntities behaves safely when limit is null', () => {
        const results = queryEntities({ limit: null as any });
        assert.strictEqual(results.length, 10000, 'queryEntities should cap at 10000 when limit is null');
    });

    await t.test('exportGraph() works without truncation', () => {
        const graph = exportGraph();
        assert.strictEqual(graph.entities.length, numToInsert, 'exportGraph should export all entities without truncation');
    });

    closeGraph();

    // 2. Setup transport to run the server script for MCP tests
    const serverPath = path.resolve(__dirname, '../src/mcp/server.ts');
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['--experimental-strip-types', '--no-warnings', serverPath],
        env: { ...process.env, AGENTMEMORY_DB_PATH: dbPath }
    });

    // 3. Setup client
    const client = new Client({ name: "test-client-gen16", version: "1.0" }, { capabilities: {} });
    await client.connect(transport);

    try {
        await t.test('agentmemory_graph_query behaves safely when limit is omitted', async () => {
            const queryResult = await client.callTool({
                name: 'agentmemory_graph_query',
                arguments: {
                    namespace: 'global',
                    entityType: 'Memory'
                    // limit is omitted
                }
            });
            assert.ok(queryResult.content.length > 0);
            assert.ok(queryResult.content[0].type === 'text');
            const queryData = JSON.parse(queryResult.content[0].text);
            assert.ok(Array.isArray(queryData), 'Result should be an array');
            assert.strictEqual(queryData.length, 50, 'MCP graph query should cap at 50 when limit is omitted');
        });

        await t.test('agentmemory_graph_query behaves safely when limit is null', async () => {
            const queryResult = await client.callTool({
                name: 'agentmemory_graph_query',
                arguments: {
                    namespace: 'global',
                    entityType: 'Memory',
                    limit: null
                }
            });
            assert.ok(queryResult.content.length > 0);
            assert.ok(queryResult.content[0].type === 'text');
            const queryData = JSON.parse(queryResult.content[0].text);
            assert.ok(Array.isArray(queryData), 'Result should be an array');
            assert.strictEqual(queryData.length, 50, 'MCP graph query should cap at 50 when limit is null');
        });

    } finally {
        await transport.close();
        await new Promise(resolve => setTimeout(resolve, 500));
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }
    }
});
