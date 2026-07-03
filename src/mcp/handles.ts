/**
 * Application handles — explicit, signed, expirable.
 * ---------------------------------------------------
 * A handle is a compact bearer credential an operator mints for one agent:
 *
 *     amh1.<payload-base64url>.<hmac-sha256-base64url>
 *
 * Payload (JSON): { sub, access, exp, iat }
 *   sub     agent identity (e.g. "hermes_agent") — feeds the trust ledger
 *   access  scope: read_only | read_write | none (never admin via handle)
 *   exp     unix epoch seconds; expired handles are rejected
 *   iat     minted-at timestamp, for audit
 *
 * Design constraints:
 *   - Stateless verification: only AGENTMEMORY_HANDLE_SECRET is needed —
 *     no session table, no DB lookup. Fits the stateless HTTP transport.
 *   - Downgrade-only: a handle can narrow the gateway's default access,
 *     never widen it (enforced at the transport layer via canDowngradeTo).
 *   - Constant-time signature comparison (timingSafeEqual).
 */

import crypto from 'node:crypto';
import { isAccessLevel, type AccessLevel } from './access.ts';

const PREFIX = 'amh1';

export interface HandlePayload {
  /** Agent identity, e.g. "hermes_agent". */
  sub: string;
  /** Access scope granted to this handle. */
  access: Exclude<AccessLevel, 'admin'>;
  /** Expiry, unix epoch seconds. */
  exp: number;
  /** Minted at, unix epoch seconds. */
  iat: number;
}

export type HandleVerification =
  | { ok: true; payload: HandlePayload }
  | { ok: false; error: string };

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(payloadB64: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(`${PREFIX}.${payloadB64}`).digest());
}

export function getHandleSecret(): string | null {
  const secret = process.env.AGENTMEMORY_HANDLE_SECRET;
  return secret && secret.length >= 16 ? secret : null;
}

/**
 * Mint a signed handle. `ttlSeconds` bounds the lifetime; there is no
 * "forever" handle — callers must re-mint (default 24h, max 30 days).
 */
export function mintHandle(
  sub: string,
  access: Exclude<AccessLevel, 'admin'>,
  secret: string,
  ttlSeconds: number = 24 * 3600,
  now: Date = new Date()
): string {
  if (!sub || !/^[a-zA-Z0-9_.-]{1,64}$/.test(sub)) {
    throw new Error(`Invalid handle subject: ${sub}`);
  }
  if (!isAccessLevel(access) || access === 'admin') {
    throw new Error(`Invalid handle access level: ${access}`);
  }
  const ttl = Math.min(Math.max(ttlSeconds, 1), 30 * 24 * 3600);
  const iat = Math.floor(now.getTime() / 1000);
  const payload: HandlePayload = { sub, access, exp: iat + ttl, iat };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${PREFIX}.${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Verify a handle: format, signature (constant-time), then expiry.
 * Never throws — returns a discriminated result the transport can map to
 * a 401 with a precise reason.
 */
export function verifyHandle(handle: string, secret: string, now: Date = new Date()): HandleVerification {
  if (typeof handle !== 'string') return { ok: false, error: 'handle must be a string' };

  const parts = handle.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return { ok: false, error: 'malformed handle (expected amh1.<payload>.<signature>)' };
  }
  const [, payloadB64, sigB64] = parts;

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'invalid signature' };
  }

  let payload: HandlePayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: 'unparseable payload' };
  }

  if (typeof payload.sub !== 'string' || !payload.sub) {
    return { ok: false, error: 'missing subject' };
  }
  if (!isAccessLevel(payload.access) || payload.access === 'admin') {
    return { ok: false, error: `invalid access scope: ${String(payload.access)}` };
  }
  if (typeof payload.exp !== 'number' || Math.floor(now.getTime() / 1000) >= payload.exp) {
    return { ok: false, error: 'handle expired' };
  }

  return { ok: true, payload };
}
