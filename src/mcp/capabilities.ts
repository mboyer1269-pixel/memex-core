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

export function getAuthorizedTools(): any[] {
  if (!toolsCache) {
    const raw = fs.readFileSync(toolsFixturePath, 'utf8');
    toolsCache = JSON.parse(raw).tools;
  }
  return toolsCache;
}

export function getAuthorizedResources(): any[] {
  if (!resourcesCache) {
    const raw = fs.readFileSync(resourcesFixturePath, 'utf8');
    resourcesCache = JSON.parse(raw).resources;
  }
  return resourcesCache;
}
