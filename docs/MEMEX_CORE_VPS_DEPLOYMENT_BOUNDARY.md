# Memex Core VPS Deployment Boundary

## Executive summary

This document locks the deployment boundary between four separate systems:
Oria HQ, official Memex Core, ProofLoop, and the existing VPS service
`agentmemory-7evd`.

The existing Hostinger VPS service `agentmemory-7evd` is a legacy
AgentMemory deployment. It must not be renamed, documented, or treated as
official Memex Core. Official Memex Core must be deployed separately beside
that service, with its own route, port, data directories, and environment
file.

This is a docs-only boundary. It does not authorize a deployment, migration,
restart, router change, Caddy install, Traefik change, or volume reuse.

## Verified from repos

The repo-verified deployment doctrine is:

- Oria HQ governs: `Oria = GOVERN`, `Memex = ORIENT`, `Hermes/Joris = ACT`.
- Oria treats Memex as an optional read-only source for Joris.
- Oria v1 parks VPS/SSE transport. VPS wiring is not in the Oria v1 scope.
- Memex Core v0.8.0 exposes:
  - `POST /mcp`
  - `GET /sse` legacy
  - `POST /message` legacy SSE
  - `GET /health`
- Memex Core currently uses runtime variables named `AGENTMEMORY_*`,
  `GATEWAY_*`, and `AGENTMEMORY_HANDLE_SECRET`.
- ProofLoop is separate. ProofLoop controls code changes, validation, and
  proof reports. Memex keeps governed context and memory.

## Reported by VPS audit

The VPS audit reported an existing service named `agentmemory-7evd` with:

- image base/runtime: `node:22-slim`
- package: `@agentmemory/agentmemory@0.9.18`
- internal port: `3111`
- Traefik router: `agentmemory-7evd`
- volumes: `agentmemory-7evd_*`

This service is legacy/existing AgentMemory infrastructure. It is not official
Memex Core and must not be called Memex Core.

## Boundary matrix

| System | Role | Deployment boundary | Integration status |
|---|---|---|---|
| Oria HQ | GOVERN | Oria decides and governs workflows. It may read Memex context only when the Oria transport scope allows it. | Do not connect Oria HQ to VPS Memex while VPS/SSE transport remains PARK in Oria v1. |
| Memex Core | ORIENT | Official local-first MCP memory server. Deploy separately with its own route, port, data, and env file. | Official service target for `POST /mcp`, legacy `GET /sse`, legacy `POST /message`, and `GET /health`. |
| ProofLoop | PROVE / VALIDATE | Separate proof and validation system. It owns code-change control, validation runs, and proof reports. | Out of scope for Memex Core VPS deployment. Do not merge ProofLoop into Memex Core. |
| `agentmemory-7evd` | Legacy AgentMemory service | Existing VPS service, router, internal port, and volumes are reserved for that legacy service. | Do not rename, reuse, migrate, stop, restart, or route official Memex Core through it. |

## Hostinger Traefik mode

The generic VPS runbook may describe Caddy and port `3000`. That is generic
guidance only.

For the existing Hostinger VPS that already has Traefik and
`agentmemory-7evd`:

- do not install Caddy;
- do not change Traefik globally;
- do not touch the `agentmemory-7evd` router;
- do not stop or restart `agentmemory-7evd`;
- create a distinct Traefik router for official Memex Core in a future deploy
  phase;
- keep official Memex Core paths distinct:
  - `/opt/memex-core`
  - `/var/lib/memex-core`
  - `/etc/memex-core/memex.env`
- do not reuse any `agentmemory-7evd_*` volume.

## Runtime env naming reality

Do not invent a new runtime namespace such as `MEMEX_CORE_*` for the current
code.

The current official Memex Core code uses historical environment names:

- `AGENTMEMORY_DB_PATH`
- `AGENTMEMORY_INTAKE_DB_PATH`
- `AGENTMEMORY_VAULT_PATH`
- `AGENTMEMORY_ACCESS`
- `AGENTMEMORY_HANDLE_SECRET`
- `GATEWAY_MODE`
- `GATEWAY_HOST`
- `GATEWAY_PORT`
- `GATEWAY_TOKEN`
- `GATEWAY_DEFAULT_ACCESS`

Those names are historical. When they are defined in
`/etc/memex-core/memex.env`, they belong to the official `memex-core` service,
not to the legacy `agentmemory-7evd` service.

## Port policy

For this Hostinger Traefik VPS:

- avoid port `3000` because it belongs to the generic runbook assumption;
- avoid port `3111` because the VPS audit reports it as the legacy
  `agentmemory-7evd` internal port;
- prefer `GATEWAY_HOST=127.0.0.1`;
- prefer `GATEWAY_PORT=3101`;
- expose Memex Core only through a future distinct Traefik router.

## Route policy

Official Memex Core route ownership:

| Route | Status | Boundary |
|---|---|---|
| `GET /health` | Live health endpoint | May be used for Memex Core monitoring on the Memex Core router. |
| `POST /mcp` | Official stateless MCP endpoint | Primary remote MCP entrypoint for Memex Core. |
| `GET /sse` | Legacy SSE endpoint | Kept only for legacy remote clients. Do not use it to unblock Oria v1 while Oria marks VPS/SSE as PARK. |
| `POST /message` | Legacy SSE message endpoint | Paired with `GET /sse`; must stay on the Memex Core router, not `agentmemory-7evd`. |

No Memex Core route should be attached to the existing Traefik router named
`agentmemory-7evd`.

## Explicit NO-GO list

For this docs-only phase, do not:

- modify runtime code under `src/`;
- modify `deploy/setup-vps.sh`;
- modify systemd service definitions;
- create an active `docker-compose` deployment;
- install Caddy on the Hostinger VPS;
- change Traefik;
- deploy Memex Core;
- migrate data;
- stop or restart `agentmemory-7evd`;
- reuse `agentmemory-7evd_*` volumes;
- call `agentmemory-7evd` Memex Core;
- merge Memex Core and ProofLoop;
- invent VPS audit results;
- expose secrets;
- merge this PR without an explicit GO from Michael.

## Future phases

| Phase | Scope | Output |
|---|---|---|
| Phase 1 | Docs only | This boundary document and the Hostinger note in `docs/DEPLOYMENT_VPS.md`. |
| Phase 2 | Example Traefik compose/runbook | Non-active example config for a distinct Memex Core Traefik router and port `3101`. |
| Phase 3 | Deploy Memex Core beside legacy | Deploy official Memex Core separately, without touching `agentmemory-7evd`. |
| Phase 4 | Optional migration audit | Audit whether any legacy data should be migrated, with explicit approval before any action. |

## Operator checklist before any deploy

Before any future deployment, confirm:

- Michael has given an explicit GO for deployment work.
- Oria HQ transport scope no longer parks VPS/SSE if Oria is to be connected.
- The target service name is official Memex Core, not `agentmemory-7evd`.
- The Traefik router name is distinct from `agentmemory-7evd`.
- `GATEWAY_HOST=127.0.0.1`.
- `GATEWAY_PORT=3101`.
- `/opt/memex-core` is reserved for official Memex Core.
- `/var/lib/memex-core` is reserved for official Memex Core data.
- `/etc/memex-core/memex.env` is reserved for official Memex Core runtime env.
- No `agentmemory-7evd_*` volume is mounted or reused.
- ProofLoop remains separate and out of deployment scope.
- No secrets are copied into docs, git history, PR text, or handoff files.
