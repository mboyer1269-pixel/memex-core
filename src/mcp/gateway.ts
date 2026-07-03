/**
 * Thin HTTP shim — kept so existing deployments launching
 * src/mcp/gateway.ts keep working. ALL logic lives in unified-server.ts:
 * stateless POST /mcp, legacy SSE, auth (bearer token or signed handle),
 * and decideAccess() on every tool call. No duplication left here.
 */
import { fileURLToPath } from 'node:url';
import { runHttp } from './unified-server.ts';

export const runGateway = runHttp;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runHttp().catch((error) => {
    console.error('Fatal error in MCP gateway:', error);
    process.exit(1);
  });
}
