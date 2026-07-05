import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Utility to get __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// We rely on the fixtures from v0.6c-0 to define the exact capabilities
const toolsFixturePath = path.resolve(__dirname, '../../fixtures/mcp-tools-list.expected.json');
const resourcesFixturePath = path.resolve(__dirname, '../../fixtures/mcp-resources-list.expected.json');

let toolsCache: any = null;
let resourcesCache: any = null;

export type ToolProfile = 'local' | 'remote';

const REMOTE_EXCLUDED_TOOLS = new Set([
  'agentmemory_write_vault_file'
]);

function loadTools(): any[] {
  if (!toolsCache) {
    const raw = fs.readFileSync(toolsFixturePath, 'utf8');
    toolsCache = JSON.parse(raw).tools;
  }
  return toolsCache;
}

export function getAuthorizedTools(profile: ToolProfile = 'local'): any[] {
  const tools = loadTools();
  if (profile === 'remote') {
    return tools.filter((tool: any) => !REMOTE_EXCLUDED_TOOLS.has(tool.name));
  }
  return toolsCache;
}

export function isKnownTool(toolName: string): boolean {
  return loadTools().some((tool: any) => tool.name === toolName);
}

export function isToolAllowedInProfile(toolName: string, profile: ToolProfile): boolean {
  return profile === 'local' || !REMOTE_EXCLUDED_TOOLS.has(toolName);
}

export function getAuthorizedResources(): any[] {
  if (!resourcesCache) {
    const raw = fs.readFileSync(resourcesFixturePath, 'utf8');
    resourcesCache = JSON.parse(raw).resources;
  }
  return resourcesCache;
}
