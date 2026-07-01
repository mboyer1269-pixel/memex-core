import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('MCP Contract Validation', () => {
  const toolsListPath = path.resolve(process.cwd(), 'fixtures', 'mcp-tools-list.expected.json');
  const resourcesListPath = path.resolve(process.cwd(), 'fixtures', 'mcp-resources-list.expected.json');

  const toolsData = JSON.parse(fs.readFileSync(toolsListPath, 'utf-8'));
  const resourcesData = JSON.parse(fs.readFileSync(resourcesListPath, 'utf-8'));

  // 1. Verify exactly the intended tools exist
  const toolNames = toolsData.tools.map((t: any) => t.name);
  assert.strictEqual(toolNames.length, 10);
  assert.ok(toolNames.includes('agentmemory_graph_query'));
  assert.ok(toolNames.includes('agentmemory_context_pack'));
  assert.ok(toolNames.includes('agentmemory_librarian_brief'));
  assert.ok(toolNames.includes('agentmemory_latest_updates'));
  assert.ok(toolNames.includes('agentmemory_project_state'));
  assert.ok(toolNames.includes('agentmemory_tool_catalog_search'));
  assert.ok(toolNames.includes('agentmemory_submit_proposal'));
  assert.ok(toolNames.includes('agentmemory_read_vault_file'));
  assert.ok(toolNames.includes('agentmemory_write_vault_file'));
  assert.ok(toolNames.includes('agentmemory_search_vault'));

  // 2. Verify forbidden names do not exist (vault tools are whitelisted)
  const forbiddenKeywords = ['add', 'create', 'delete', 'mutate', 'export_all', 'raw_db'];
  const whitelistedTools = ['agentmemory_read_vault_file', 'agentmemory_write_vault_file', 'agentmemory_submit_proposal'];
  toolNames.forEach((name: string) => {
    if (whitelistedTools.includes(name)) return;
    forbiddenKeywords.forEach(keyword => {
      assert.ok(!name.includes(keyword), `Tool name ${name} contains forbidden keyword ${keyword}`);
    });
  });

  // 3. Verify parameters do not accept free paths (except for vault tools which use sandboxed paths)
  const vaultToolNames = ['agentmemory_read_vault_file', 'agentmemory_write_vault_file'];
  toolsData.tools.forEach((tool: any) => {
    if (vaultToolNames.includes(tool.name)) return; // Vault tools legitimately use 'filepath'
    const props = Object.keys(tool.inputSchema.properties);
    props.forEach(prop => {
      assert.ok(!prop.toLowerCase().includes('path'), `Parameter ${prop} in tool ${tool.name} implies a free path`);
      assert.ok(!prop.toLowerCase().includes('file'), `Parameter ${prop} in tool ${tool.name} implies a file path`);
    });
  });

  // 4. Verify max limits are documented in the description
  const contextPackTool = toolsData.tools.find((t: any) => t.name === 'agentmemory_context_pack');
  assert.ok(contextPackTool.inputSchema.properties.maxEntities.description.includes('Max 50'));
  assert.ok(contextPackTool.inputSchema.properties.maxRelations.description.includes('Max 50'));

  // 5. Verify readOnly is explicitly declared
  const queryTool = toolsData.tools.find((t: any) => t.name === 'agentmemory_graph_query');
  assert.ok(queryTool.description.includes('read-only'));

  // 6. Verify that Graph and RAG remain separated (no RAG/Graph fusion mentions)
  const allText = JSON.stringify(toolsData).toLowerCase();
  assert.ok(!allText.includes('rag'), 'MCP contract incorrectly mixes Graph and RAG');

  // 7. Verify exactly the intended resources exist
  const resourceUris = resourcesData.resources.map((r: any) => r.uri);
  assert.strictEqual(resourceUris.length, 2);
  assert.ok(resourceUris.includes('agentmemory://health'));
  assert.ok(resourceUris.includes('agentmemory://schema'));
});
