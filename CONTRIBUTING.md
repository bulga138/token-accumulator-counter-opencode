# Contributing to TACO 🌮

Thanks for your interest in contributing! This document will help you get started.

## Prerequisites

- **Node.js** 18+ (required)
- **pnpm** (package manager - `npm install -g pnpm`)
- **Bun** (recommended for development - 10x faster)
- **Git**

## Setup

1. **Fork and clone:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/token-accumulator-counter-opencode.git
   cd token-accumulator-counter-opencode
   ```

 2. **Install dependencies:**
   ```bash
   # With Bun (recommended)
   bun install
   
   # Or with pnpm
   pnpm install
   ```

 3. **Verify setup:**
   ```bash
   pnpm run typecheck
   pnpm test
   ```

## Development Workflow

### Running locally

```bash
# Development mode (with Bun)
bun run dev

# Or with Node
pnpm run dev
```

### Building

```bash
pnpm run build
```

### Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm run test:watch

# Coverage
pnpm run test:coverage
```

### Code quality

```bash
# Type checking
pnpm run typecheck

# Linting
pnpm run lint
pnpm run lint:fix  # Auto-fix issues

# Formatting
pnpm run format        # Format all files
pnpm run format:check  # Check formatting without fixing
```

## Project Structure

```
├── bin/              # Entry point
├── src/
│   ├── aggregator/   # Data computation logic
│   ├── cli/          # Command-line interface
│   ├── config/       # Configuration management
│   ├── data/         # Database queries and types
│   ├── format/       # Output formatting (visual, JSON, etc.)
│   └── utils/        # Utilities
├── tests/            # Test files
└── dist/             # Compiled output (generated)
```

## Making Changes

### 1. Create a branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-description
```

### 2. Write code

- Follow existing code style
- Add types (TypeScript)
- Keep functions small and focused
- Add comments for complex logic

### 3. Test your changes

```bash
pnpm run typecheck
pnpm test
```

### 4. Commit

Use clear commit messages:

```bash
git commit -m "feat: add streaming support for large datasets"
git commit -m "fix: resolve memory overflow in overview command"
git commit -m "docs: update README with new examples"
```

**Commit message format:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `refactor:` - Code restructuring
- `test:` - Tests
- `chore:` - Maintenance

### 5. Push and create PR

```bash
git push origin feature/your-feature-name
```

Then open a Pull Request on GitHub.

## Pull Request Guidelines

- **One feature/fix per PR**
- **Include tests** for new functionality
- **Update documentation** if needed
- **Ensure CI passes** (typecheck + tests)
- **Reference issues** (e.g., "Fixes #123")

## Code Style

We use **ESLint** and **Prettier** to enforce code style automatically.

- **TypeScript** - Strict mode enabled
- **2 spaces** indentation
- **No semicolons** (enforced by Prettier)
- **Single quotes** for strings
- **Trailing commas** in multi-line objects/arrays
- **100 character** line width

Run `pnpm run format` before committing to auto-format your code.

Example:
```typescript
export function computeStats(events: UsageEvent[]): Stats {
  const map = new Map<string, {
    tokens: TokenSummary
    cost: number
  }>()
  
  for (const e of events) {
    // ...
  }
  
  return map
}
```

## Testing Guidelines

- Test files: `tests/**/*.test.ts`
- Use **Vitest** (test framework)
- Mock database when possible
- Test edge cases (empty data, large datasets)

Example:
```typescript
import { test, expect } from 'vitest'
import { computeOverview } from '../src/aggregator'

test('computeOverview handles empty events', () => {
  const result = computeOverview([], [])
  expect(result.messageCount).toBe(0)
  expect(result.cost).toBe(0)
})
```

## Reporting Issues

### Bugs

Include:
- TACO version (`taco --version`)
- Node.js/Bun version
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Error messages (if any)

### Feature Requests

Include:
- Use case description
- Proposed solution (if you have one)
- Alternatives considered

## Performance Considerations

TACO handles potentially large datasets. Keep these in mind:

- **Use streaming** for large data processing
- **Add query limits** to prevent unbounded memory usage
- **Prefer SQLite aggregations** over loading data into Node.js
- **Test with large datasets** (100k+ rows)

See `src/data/queries.ts` for examples of memory-efficient patterns.

## Questions?

- Open an issue for questions
- Check existing issues/PRs first
- Be respectful and constructive

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to TACO! 🌮**
