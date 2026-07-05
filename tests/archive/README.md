# Archived Test Files

These files are intentionally outside `npm test`.

| File | Classification | Reason |
|---|---|---|
| `adversarial-stress.test.ts` | obsolete | Imports removed APIs and asserts pre-hardening vulnerabilities as if they should still exist. |
| `adversarial.test.ts` | obsolete | Duplicates older intake adversarial coverage and depends on stale duplicate-promotion behavior. |
| `mcp-server-stress.test.ts` | obsolete | Expects the older context-pack shape and predates current MCP parity/access tests. |
| `test-mcp-vuln.ts` | obsolete | One-off vulnerability probe, not a `node:test` suite, and imports from a stale module path. |

Long-running but still valid limit tests remain top-level and are wired to
`npm run test:limit`, not the fast `npm test` gate.
