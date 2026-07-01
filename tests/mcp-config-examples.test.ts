import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configsDir = path.resolve(__dirname, '../configs/mcp');

const configFiles = [
  'claude-code.local.example.json',
  'claude-desktop.local.example.json',
  'cursor.local.example.json'
];

test('MCP Config Examples Validation v0.6e', async (t) => {
  for (const file of configFiles) {
    await t.test(`Validating ${file}`, () => {
      const filePath = path.join(configsDir, file);
      assert.ok(fs.existsSync(filePath), `Config file ${file} should exist`);

      const content = fs.readFileSync(filePath, 'utf-8');
      
      // 1. Validate valid JSON
      let configData;
      try {
        configData = JSON.parse(content);
      } catch (err: any) {
        assert.fail(`${file} is not valid JSON: ${err.message}`);
      }

      // 2. Validate structure
      assert.ok(configData.mcpServers, 'Must contain mcpServers key');
      assert.ok(configData.mcpServers['memex-core'], 'Must contain memex-core configuration');
      
      const serverConfig = configData.mcpServers['memex-core'];
      assert.strictEqual(serverConfig.command, 'node', 'Command must be local node executable');
      assert.ok(Array.isArray(serverConfig.args), 'Args must be an array');
      assert.ok(serverConfig.args.includes('--experimental-strip-types'), 'Must include required node flag');
      assert.ok(serverConfig.args.some((arg: string) => arg.includes('src/mcp/server.ts')), 'Must point to server.ts');

      // 3. Verify no secrets or env vars
      assert.strictEqual(serverConfig.env, undefined, 'Must not include environment variables (secrets risk)');
      assert.ok(!content.includes('API_KEY'), 'Must not include API_KEY literals');
      assert.ok(!content.includes('SECRET'), 'Must not include SECRET literals');

      // 4. Verify no HTTP/SSE/WebSocket transports
      assert.ok(!content.includes('http://'), 'Must not use HTTP transport');
      assert.ok(!content.includes('https://'), 'Must not use HTTPS transport');
      assert.ok(!content.includes('ws://'), 'Must not use WebSocket transport');

      // 5. Verify no write/mutate terms in args
      assert.ok(!content.includes('write'), 'Must not include write parameters');
      assert.ok(!content.includes('mutate'), 'Must not include mutate parameters');
      assert.ok(!content.includes('delete'), 'Must not include delete parameters');
      
      // 6. Verify no hardcoded real personal path
      assert.ok(content.includes('<PATH_TO_AGENTMEMORY_HUB>'), 'Must use placeholder for local path');
      assert.ok(!content.includes('C:/Users/'), 'Must not include real Windows user paths');
      assert.ok(!content.includes('/home/'), 'Must not include real Linux user paths');
    });
  }
});
