```markdown
# memex-core Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `memex-core` TypeScript codebase. It covers file organization, code style, commit conventions, and testing patterns, enabling contributors to write consistent, maintainable code and collaborate effectively.

## Coding Conventions

### File Naming
- Use **kebab-case** for all file names.
  - Example:  
    ```
    search-index.ts
    data-loader.test.ts
    ```

### Import Style
- Use **relative imports** for modules within the repository.
  - Example:
    ```typescript
    import { fetchData } from './data-loader'
    import { SearchIndex } from '../search/search-index'
    ```

### Export Style
- Use **named exports** rather than default exports.
  - Example:
    ```typescript
    // Good
    export function fetchData() { ... }
    export const SEARCH_LIMIT = 100

    // Avoid
    // export default function fetchData() { ... }
    ```

### Commit Messages
- Follow **conventional commit** format.
- Use the `feat` prefix for new features.
  - Example:
    ```
    feat: add support for advanced search filters
    ```

## Workflows

_No automated workflows detected in this repository._

## Testing Patterns

- Test files use the pattern `*.test.*` (e.g., `search-index.test.ts`).
- The specific testing framework is **unknown**, but tests are colocated with source files or in the same directory.
- Example test file:
  ```
  search-index.test.ts
  ```

- Example test structure:
  ```typescript
  import { search } from './search-index'

  describe('search', () => {
    it('returns results for a valid query', () => {
      // test implementation
    })
  })
  ```

## Commands
| Command     | Purpose                                   |
|-------------|-------------------------------------------|
| /test       | Run all tests in the repository           |
| /lint       | Lint the codebase for style consistency   |
| /commit     | Create a conventional commit              |
```