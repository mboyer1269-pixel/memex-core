---
name: add-new-documentation-blueprint
description: Workflow command scaffold for add-new-documentation-blueprint in memex-core.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-new-documentation-blueprint

Use this workflow when working on **add-new-documentation-blueprint** in `memex-core`.

## Goal

Adds a new documentation blueprint or integration guide for memory fabric features.

## Common Files

- `docs/*.md`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create a new markdown file in the docs/ directory with the relevant blueprint or integration details
- Commit the new file with a descriptive message

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.