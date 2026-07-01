import test from 'node:test';
import assert from 'node:assert';
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getAuthorizedTools, getAuthorizedResources } from '../src/mcp/capabilities.ts';

test('MCP Server Capabilities Verification', () => {
  const tools = getAuthorizedTools();
  const resources = getAuthorizedResources();

  // Verify capabilities strictly match expectations
  assert.strictEqual(tools.length, 10);
  assert.strictEqual(resources.length, 2);

  // No graph mutation tools exist (Vault tools are allowed to write)
  const forbiddenKeywords = ['add', 'create', 'delete', 'write', 'mutate'];
  tools.forEach((t: any) => {
    if (!t.name.includes('_vault_')) {
      forbiddenKeywords.forEach(k => {
        assert.ok(!t.name.includes(k), `Tool name ${t.name} contains forbidden keyword ${k}`);
      });
    }
  });

  // agentmemory_graph_query parameters
  const queryTool = tools.find((t: any) => t.name === 'agentmemory_graph_query');
  assert.ok(queryTool);
  assert.ok(!Object.keys(queryTool.inputSchema.properties).some(p => p.toLowerCase().includes('path')));

  // agentmemory_context_pack parameters
  const packTool = tools.find((t: any) => t.name === 'agentmemory_context_pack');
  assert.ok(packTool);
  assert.ok(packTool.inputSchema.properties.maxEntities);
});



import fs from 'node:fs';
import { initGraph, addEntity, closeGraph } from '../src/graph.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('MCP Server Integration Test', async () => {
    const dbPath = path.resolve(__dirname, '../data/test-mcp-server.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    // Setup initial valid graph for queries
    initGraph(dbPath, false);
    addEntity({ id: 'e1', type: "User", namespace: "org:test_ns", name: "Alice", source: "System" });
    addEntity({ id: 'e2', type: "Project", namespace: "org:test_ns", name: "Alpha", source: "System" });
    addEntity({ id: 'e3', type: "Skill", namespace: "org:test_ns", name: "Coding", source: "System" });
    closeGraph();

    // 1. Setup transport to run the server script
    const serverPath = path.resolve(__dirname, '../src/mcp/server.ts');
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['--experimental-strip-types', '--no-warnings', serverPath],
        env: { ...process.env, AGENTMEMORY_DB_PATH: dbPath }
    });

    // 2. Setup client
    const client = new Client({ name: "test-client", version: "1.0" }, { capabilities: {} });
    await client.connect(transport);

    try {
        // 3. Test listTools
        const tools = await client.listTools();
        assert.strictEqual(tools.tools.length, 10, 'Should have exactly 10 tools authorized');
        
        // 4. Test listResources
        const resources = await client.listResources();
        assert.strictEqual(resources.resources.length, 2, 'Should have exactly 2 resources authorized');

        // 5. Test reading a resource
        const healthResource = await client.readResource({ uri: 'agentmemory://health' });
        assert.ok(healthResource.contents.length === 1);
        const healthText = healthResource.contents[0].text;
        assert.ok(typeof healthText === 'string');
        const healthData = JSON.parse(healthText);
        assert.strictEqual(healthData.status, 'ok');

        // Test reading schema resource
        const schemaResource = await client.readResource({ uri: 'agentmemory://schema' });
        assert.ok(schemaResource.contents.length === 1);
        const schemaText = schemaResource.contents[0].text;
        const schemaData = JSON.parse(schemaText);
        assert.ok(schemaData.tools.includes('agentmemory_librarian_brief'));

        // 6. Test calling a tool
        // Call agentmemory_tool_catalog_search which returns JSONL
        const toolResult = await client.callTool({
            name: 'agentmemory_tool_catalog_search',
            arguments: {
                namespace: 'org:test_ns',
                intent: 'Coding'
            }
        });
        
        assert.ok(toolResult.content.length > 0);
        assert.ok(toolResult.content[0].type === 'text');
        assert.ok(!toolResult.content[0].text.includes('warnings'), 'Tool returned an error warning');
        const toolLines = toolResult.content[0].text.split('\n').filter(Boolean);
        assert.ok(toolLines.length > 0, 'Tool search returned no results');
        const toolData = JSON.parse(toolLines[0]);
        assert.strictEqual(toolData.name, 'Coding');
        assert.strictEqual(toolData.type, 'Skill');

        // 7. Test agentmemory_graph_query (Returns JSON)
        const queryResult = await client.callTool({
            name: 'agentmemory_graph_query',
            arguments: {
                namespace: 'org:test_ns',
                entityType: 'User',
                limit: 5
            }
        });
        assert.ok(queryResult.content.length > 0);
        assert.ok(queryResult.content[0].type === 'text');
        const queryData = JSON.parse(queryResult.content[0].text);
        if (queryData.warnings) assert.strictEqual(queryData.warnings.length, 0);
        assert.ok(Array.isArray(queryData));
        assert.strictEqual(queryData.length, 1);
        assert.strictEqual(queryData[0].name, 'Alice');
        
        // 8. Test agentmemory_context_pack (Returns JSON)
        const packResult = await client.callTool({
            name: 'agentmemory_context_pack',
            arguments: {
                namespace: 'org:test_ns',
                centerEntityId: 'e1'
            }
        });
        assert.ok(packResult.content.length > 0);
        assert.ok(packResult.content[0].type === 'text');
        const packData = JSON.parse(packResult.content[0].text);
        if (packData.warnings) assert.strictEqual(packData.warnings.length, 0);
        assert.ok(packData.graphContext);
        assert.ok(packData.graphContext.centerEntity);
        assert.strictEqual(packData.graphContext.centerEntity.id, 'e1');

        // 9. Test agentmemory_librarian_brief (Returns Markdown)
        const briefResult = await client.callTool({
            name: 'agentmemory_librarian_brief',
            arguments: { namespace: 'org:test_ns', task: 'test', tokenBudget: 100 }
        });
        assert.ok(briefResult.content[0].text.includes('## Task'));
        assert.ok(briefResult.content[0].text.includes('## Project State'));
        assert.ok(briefResult.content[0].text.includes('Alpha'));

        // 10. Test agentmemory_latest_updates (Returns JSONL)
        const updatesResult = await client.callTool({
            name: 'agentmemory_latest_updates',
            arguments: { namespace: 'org:test_ns', tokenBudget: 100 }
        });
        assert.ok(updatesResult.content[0].type === 'text');
        const updatesLines = updatesResult.content[0].text.split('\n').filter(Boolean);
        assert.ok(updatesLines.length > 0);
        const updatesData = JSON.parse(updatesLines[0]);
        assert.ok(['Alice', 'Alpha', 'Coding'].includes(updatesData.name));

        // 11. Test agentmemory_project_state (Returns JSONL)
        const stateResult = await client.callTool({
            name: 'agentmemory_project_state',
            arguments: { namespace: 'org:test_ns', tokenBudget: 100 }
        });
        assert.ok(stateResult.content[0].type === 'text');
        const stateLines = stateResult.content[0].text.split('\n').filter(Boolean);
        assert.ok(stateLines.length > 0);
        const stateData = JSON.parse(stateLines[0]);
        assert.strictEqual(stateData.name, 'Alpha');
        assert.strictEqual(stateData.type, 'Project');

        // 12. Test unknown tool is rejected cleanly
        let unknownToolError: any = null;
        try {
            await client.callTool({
                name: 'agentmemory_unknown_tool',
                arguments: {}
            });
        } catch (err: any) {
            unknownToolError = err;
        }
        assert.ok(unknownToolError, 'Unknown tool should throw an error');
        assert.strictEqual(unknownToolError.code, -32601); // ErrorCode.MethodNotFound

    } finally {
        await transport.close();
        // Allow a brief moment for the child process to handle transport close and close the graph
        await new Promise(resolve => setTimeout(resolve, 500));
        // Verify that the DB file is NOT locked.
        // If it throws EBUSY, the test will fail as required by the DB lifecycle patch.
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }
    }
});


