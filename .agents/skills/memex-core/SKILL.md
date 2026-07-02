```markdown
# memex-core Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill provides a comprehensive guide to the development patterns and workflows used in the `memex-core` TypeScript codebase. It covers file organization, coding conventions, commit practices, and documentation workflows, enabling contributors to write consistent, maintainable code and efficiently add new documentation blueprints.

## Coding Conventions

### File Naming
- **Style:** `snake_case`
- **Example:**  
  ```
  memory_utils.ts
  data_store.test.ts
  ```

### Import Style
- **Style:** Relative imports
- **Example:**
  ```typescript
  import { fetch_data } from './data_utils';
  ```

### Export Style
- **Style:** Named exports
- **Example:**
  ```typescript
  // In memory_utils.ts
  export function allocate_memory() { ... }
  export const MEMORY_LIMIT = 1024;
  ```

### Commit Messages
- **Type:** Conventional commits
- **Prefixes:**  
  - `docs:` for documentation changes  
  - `feat:` for new features
- **Example:**  
  ```
  docs: add integration guide for memory fabric
  feat: implement memory allocation logic
  ```

## Workflows

### Add New Documentation Blueprint
**Trigger:** When someone wants to document a new blueprint, integration, or security model related to memory fabric.  
**Command:** `/new-doc-blueprint`

1. Create a new markdown file in the `docs/` directory with the relevant blueprint or integration details.
2. Commit the new file with a descriptive message, e.g.:
   ```
   docs: add blueprint for distributed memory sync
   ```
3. Push your changes and open a pull request if required.

**Example:**
```bash
echo "# Distributed Memory Sync" > docs/distributed_memory_sync.md
git add docs/distributed_memory_sync.md
git commit -m "docs: add blueprint for distributed memory sync"
git push
```

## Testing Patterns

- **Framework:** Unknown (no explicit framework detected)
- **Test File Naming:** Files containing tests use the pattern `*.test.*`
- **Example:**
  ```
  memory_utils.test.ts
  ```
- **Writing Tests:**  
  Place test files alongside or near the modules they test, using the `.test.ts` suffix.

## Commands

| Command            | Purpose                                                             |
|--------------------|---------------------------------------------------------------------|
| /new-doc-blueprint | Start a new documentation blueprint or integration guide in `docs/` |
```
