# Security Audit Residual

Date: 2026-07-04

## Commands

```powershell
npm audit --omit=dev
```

## Before

`npm audit --omit=dev` reported 18 vulnerabilities:

- 11 moderate
- 6 high
- 1 critical

Critical/high roots included `protobufjs`, `@modelcontextprotocol/sdk`, and
`hono`.

## Changes

- Removed unused runtime dependencies `@agentmemory/agentmemory` and
  `@agentmemory/mcp`; no tracked source or test file imported them.
- Upgraded direct dependency `@modelcontextprotocol/sdk` to `1.29.0`.

## After

```text
found 0 vulnerabilities
```

## Residual Risk

No known `npm audit --omit=dev` vulnerabilities remain.
