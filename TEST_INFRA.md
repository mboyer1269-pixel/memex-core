# E2E Test Infra: Controlled Library Intake (v0.9)

## Test Philosophy
- Opaque-box, requirement-driven. No dependency on implementation design.
- Methodology: Category-Partition + BVA + Pairwise + Workload Testing.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | F1. Intake Queue Model | ORIGINAL_REQUEST §R1 | 5      | 5      | ✓      |
| 2 | F2. Submit Proposal MCP | ORIGINAL_REQUEST §R2 | 5      | 5      | ✓      |
| 3 | F3. Built-in Validator | ORIGINAL_REQUEST §R2 | 5      | 5      | ✓      |
| 4 | F4. Graph Isolation | ORIGINAL_REQUEST §R2 | 5      | 5      | ✓      |
| 5 | F5. Admin Review API | ORIGINAL_REQUEST §R3 | 5      | 5      | ✓      |
| 6 | F6. Promotion logic | ORIGINAL_REQUEST §R3 | 5      | 5      | ✓      |

## Test Architecture
- Fast gate: `npm test`
- Limit/stress gate: `npm run test:limit`
- Test case format: programmatic E2E tests in `tests/intake.test.ts`
- Expected: all tests pass with exit code 0 when implementation is ready.

`npm test` is the fast handoff gate. High-volume graph limit checks live in
`npm run test:limit` so the default gate stays reliable on Windows while still
keeping those tests executable and documented.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Submit -> Approve -> Promote -> Verify Graph | F2, F5, F6 | Medium     |
| 2 | Submit -> Reject -> Verify NO Promotion | F2, F5, F6 | Medium     |
| 3 | Submit Invalid -> Verify Validator Block | F2, F3 | Low        |
| 4 | Submit Valid -> Verify NO Graph Mutation | F2, F4 | Low        |
| 5 | Mixed Batch (Valid + Invalid + Duplicates) | F1, F2, F3, F4, F5, F6 | High     |

## Coverage Thresholds
- Tier 1: ≥5 per feature
- Tier 2: ≥5 per feature (where boundaries exist)
- Tier 3: pairwise coverage of major feature interactions
- Tier 4: ≥5 realistic application scenarios
