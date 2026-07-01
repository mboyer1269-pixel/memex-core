# Project: Controlled Library Intake (v0.9)

## Architecture
- `src/db/`: Database layer, including SQLite schema definitions. Requires a new table `intake_proposals` independent of `entities` and `relations`.
- `src/intake/`: Core business logic for the Intake Queue. Validates proposals, handles CRUD operations for proposals in the DB.
- `src/intake/promotion.ts`: Promotion API to move data from `intake_proposals` to the canonical `entities` and `relations` tables securely with provenance.
- `src/mcp/server.ts`: Register MCP tool `agentmemory_submit_proposal` exposing the insert operation into the Intake Queue. Validates input strictly.
- `scripts/intake-review.ps1`: CLI script to review, approve/reject, and promote proposals.
- `tests/intake.test.ts`: Programmatic test suite covering all logic.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | DB Model & Intake Core | SQLite `intake_proposals` table, basic insertion logic | none | DONE |
| 2 | Review API & Promotion | Logic to list, approve/reject, and promote proposals | M1 | IN_PROGRESS |
| 3 | MCP Integration | Tool `agentmemory_submit_proposal` & Input validation | M1 | IN_PROGRESS |
| 4 | CLI Utility | `scripts/intake-review.ps1` | M2 | PLANNED |
| 5 | E2E Testing Track | Test suite design and creation (`TEST_READY.md`) | none | PLANNED |

## Interface Contracts
### `src/intake/` ↔ `src/db/`
- DB functions to insert proposal, update status, list pending.
- `intake_proposals` schema: `id`, `tenant`, `namespace`, `proposedBy`, `sourceClient`, `content`, `suggestedEntities` (JSON), `suggestedRelations` (JSON), `provenance`, `confidence`, `riskFlags`, `status` (`proposed`, `quarantined`, `approved`, `rejected`, `promoted`), `createdAt`, `reviewedAt`.

### `src/mcp/server.ts` ↔ `src/intake/`
- Tool: `agentmemory_submit_proposal`
- Validator ensures no empty payload, checks namespace/tenant, handles excessive length, detects missing entity targets.
- *Strict Contract*: `mcp/server.ts` ONLY inserts into `intake_proposals` with status `proposed`.

### Promotion API
- `promoteApprovedProposal(id: string)`: Reads proposal, migrates entities/relations to canonical tables, preserves audit trail, updates status to `promoted`. Fails if status is not `approved`.

## Code Layout
- Root: `c:/Users/micha/OneDrive/Documents/Playground/agentmemory-hub`
- Source: `src/`
- Tests: `tests/`
- Scripts: `scripts/`
