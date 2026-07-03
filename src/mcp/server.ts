/**
 * Thin stdio shim — kept so existing client configs pointing at
 * src/mcp/server.ts keep working. ALL logic lives in unified-server.ts:
 * tool handlers in tools.ts, access control in access.ts, transport
 * wiring in unified-server.ts. No duplication left here by construction.
 */
import { fileURLToPath } from 'node:url';
import { runStdio } from './unified-server.ts';

export const runServer = runStdio;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runStdio().catch((error) => {
    console.error('Fatal error in MCP server:', error);
    process.exit(1);
  });
}
