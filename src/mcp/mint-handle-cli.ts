/**
 * Operator CLI: mint a signed agent handle.
 *
 *   AGENTMEMORY_HANDLE_SECRET=... npm run mint-handle -- <sub> <access> [ttlSeconds]
 *   e.g. npm run mint-handle -- hermes_agent read_only 86400
 */
import { mintHandle, getHandleSecret } from './handles.ts';
import { isAccessLevel } from './access.ts';

const [sub, access, ttlArg] = process.argv.slice(2);

const secret = getHandleSecret();
if (!secret) {
  console.error('AGENTMEMORY_HANDLE_SECRET must be set (>=16 chars).');
  process.exit(1);
}
if (!sub || !isAccessLevel(access) || access === 'admin') {
  console.error('Usage: mint-handle <sub> <read_only|read_write|none> [ttlSeconds]');
  process.exit(1);
}

const ttl = ttlArg ? Number(ttlArg) : 24 * 3600;
if (!Number.isFinite(ttl) || ttl <= 0) {
  console.error(`Invalid ttlSeconds: ${ttlArg}`);
  process.exit(1);
}

const handle = mintHandle(sub, access, secret, ttl);
console.log(handle);
console.error(`sub=${sub} access=${access} ttl=${ttl}s — pass as: Authorization: Bearer <handle>`);
