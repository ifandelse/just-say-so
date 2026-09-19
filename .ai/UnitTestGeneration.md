# JavaScript/Vitest Unit Testing Style Guide

Adapted for this repo from the-agency's `UnitTestGeneration.md` (v2, Jest/TypeScript). The discipline is identical; the mechanics are vitest and plain JavaScript. See "Adaptations from the-agency v2" at the end for every deliberate difference.

## Pre-Writing Checklist

Before generating any tests, complete these steps in order:

1. **Branch analysis** (Coverage-Driven Test Planning): Read the source, enumerate every branch, map each to a test scenario.
2. **Superfluous test check**: Verify each planned scenario covers a distinct branch, not the same branch with different values.
3. **Execution location check** (CRITICAL RULE 1): Execute methods under test in `beforeEach()`, not in `it()` blocks.
4. **Mock configuration check** (CRITICAL RULE 2): Configure mock behavior in `beforeEach`, not at module level.
5. **Callback invocation check** (CRITICAL RULE 3): Use `mockImplementation` for callbacks, not `mock.calls[N][M]()`.

After generating tests, run them (`npm test`) and check coverage (`npm run test:coverage`).

---

## CRITICAL RULE 1: Test Execution Location

⚠️ **NON-NEGOTIABLE** ⚠️

**Execute the method under test in `beforeEach()` blocks. Assert against results in `it()` blocks.**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { findViolations } from '../../src/lib/matcher.js';

// ✅ CORRECT: execute in beforeEach, assert in it blocks
describe('when the text contains a banned word', () => {
  let result;

  beforeEach(() => {
    result = findViolations('a SEAMLESS launch', BANNED); // ✅ execution here
  });

  it('should report one hard violation', () => {
    expect(result.hard).toHaveLength(1); // ✅ pure assertion
  });

  it('should report no advisories', () => {
    expect(result.soft).toEqual([]); // ✅ pure assertion
  });
});

// ❌ WRONG: executing in it blocks
describe('when the text contains a banned word', () => {
  it('should report one hard violation', () => {
    const result = findViolations('a SEAMLESS launch', BANNED); // ❌ NO
    expect(result.hard).toHaveLength(1);
  });
});
```

Errors, sync or async, get captured in `beforeEach` (try/catch or `.catch()`) into a variable that `it()` blocks assert on.

Self-check before writing a suite:

- [ ] Is the method under test called in `beforeEach()`?
- [ ] Do `it()` blocks contain ONLY assertions?
- [ ] Are result variables declared with `let` above `beforeEach()`?

---

## CRITICAL RULE 2: Mock Configuration Location

⚠️ **NON-NEGOTIABLE** ⚠️

**Declare `vi.fn()` mock references at module level. Configure mock behavior (return values, implementations) inside `beforeEach` — never at module level.** Module-level configuration runs once at file load and leaks between tests.

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ✅ CORRECT: declare at module level, configure in beforeEach
const mockReadRules = vi.fn();
vi.mock('../../src/lib/rules.js', () => ({
  readRules: mockReadRules,
  loadBanned: vi.fn()
}));

describe('when the reminder fires', () => {
  beforeEach(() => {
    mockReadRules.mockReturnValue('THE CONDENSED RULES'); // ✅ per scenario
    result = run(INPUT, ENV);
  });
});

// ❌ WRONG: configuring behavior at module level
const mockReadRules = vi.fn().mockReturnValue('THE CONDENSED RULES'); // ❌
```

Note: vitest hoists `vi.mock()` above imports automatically; factory-referenced mocks must be declared with `vi.hoisted()` when the factory closes over them:

```js
const { mockReadRules } = vi.hoisted(() => ({ mockReadRules: vi.fn() }));
vi.mock('../../src/lib/rules.js', () => ({ readRules: mockReadRules }));
```

Self-check:

- [ ] Are all `mockResolvedValue`/`mockReturnValue`/`mockImplementation` calls inside `beforeEach`?
- [ ] Do module-level declarations use only bare `vi.fn()` (or `vi.hoisted` wrappers)?

---

## CRITICAL RULE 3: Callback Invocation via mockImplementation

⚠️ **NON-NEGOTIABLE** ⚠️

**When testing code that passes a callback to a dependency, invoke that callback with `mockImplementation`/`mockImplementationOnce`. Never reach into `mock.calls[N][M]()`.** The call-record approach couples to call order, hides the callback's purpose, and fires after-the-fact, masking timing bugs.

```js
// ✅ CORRECT
mockEmitter.on.mockImplementationOnce((_event, cb) => {
  cb('EVENT_DATA');
});

// ❌ WRONG
const callback = mockEmitter.on.mock.calls[0][1];
callback('EVENT_DATA');
```

---

## Coverage-Driven Test Planning

⚠️ **MANDATORY PRE-WRITING STEP** ⚠️

Before writing test code, read the whole source file and list every branch point: `if`/`else`, `switch` cases (including `default`), ternaries, short-circuits (`&&`, `||`, `??`), `try`/`catch`, early returns, and loop bodies (zero/one/many where behavior differs). Write the branch map:

```
Path 1: mode "off" → early return null
Path 2: tool not in configured list → early return null
Path 3: file matches exclude glob → early return null
Path 4: hard violations + mode "block" → deny output
Path 5: hard violations + mode "warn" → additionalContext output
```

Map each path to a `describe` scenario. If a path has no scenario, add one before writing any code. Goal: 100% line coverage on `src/lib/**` (enforced in `vitest.config.js`).

## Superfluous Test Prevention

A new `describe` block is warranted only when it exercises a **different branch**: a different `if`/`else` arm, a different `switch` case, a different error path, a different early return, or a structurally different dependency response that changes downstream behavior. The same branch with a different string, number, or error message is not a new scenario.

## File Structure and Naming

- File naming: module name + `.test.js`, mirrored under `test/lib/`, `test/hooks/`, `test/integration/`.
- Hierarchical describes: outer = module, middle = exported function, inner = "when X" scenario. Max 3 levels.
- `describe` carries the "when"; `it` carries the "should". Don't repeat conditions in both.

## Error Testing Strategy

- Test all **explicit** error paths — try/catch blocks, promise rejections, guard clauses. **Do not invent error paths and then test them.** If a function has no explicit error handling, write no error tests for it.
- Verify errors bubble up correctly; test fallback behavior when dependencies fail.
- Fun fake error codes are great (`E_COLD_CALZONE`, `E_SOGGY_STROMBOLI`).

## Test Data Patterns

- UPPER_CASE for test-specific values (`'THE CONDENSED RULES'`, `SESSION_ID`).
- Playful-but-realistic data is encouraged: "Cal Zone", "cal@zone.com", 8675309, 90210.
- Minimal fixtures — only the fields the scenario needs. Each test creates its own data.
- ⚠️ Never use real customer data, credentials, production IDs/URLs, or business metrics.
- Repo-specific: banned-word fixtures ("leverage", "robust", …) stay literal — they are the subject under test. `test/**` is excluded in `.just-say-so.json` for exactly this reason.

## State Management

- Chain `let` declarations with commas above `beforeEach`; initialize inside it.
- Call `vi.clearAllMocks()` in the outer `beforeEach` of suites that use mocks.
- Use `mockReset()` on an individual mock when a nested `beforeEach` must replace behavior an outer one configured.
- Filesystem state: create a fresh sandbox per suite with `fs.mkdtempSync(path.join(os.tmpdir(), '...'))` and pass it through the code's `env`/`cwd` parameters. Never touch the developer's real `~/.config` or state directories.

## Mocking Strategy

- Mock at **project-module boundaries** (`vi.mock('../../src/lib/rules.js', …)`) when a real call adds nothing to the scenario.
- Do **not** mock `node:fs` for the thin fs-wrapper modules (`config`, `state`, `rules`, `transcript`, `glob`) — use real temp-dir sandboxes. Mocking fs there tests the mock, and the sandboxes keep the guide's mock-realism principle honest.
- Mock naming: `mock` prefix (`mockReadRules`, `mockCleanupSessions`).
- `mockReturnValue` for sync, `mockResolvedValue` for async; prefer the `Once` variants when a single call is expected.
- Always verify calls when behavior depends on them: assert `toHaveBeenCalledTimes` first, then `toHaveBeenCalledWith`.
- Prefix unused mock-implementation arguments with `_`.

## Assertions

- `toBe` for primitives; `toEqual` for objects/arrays; `toBeCloseTo` for floats. Never `toBe` on objects.
- Granularity, in order of preference: full `toEqual` match → `expect.objectContaining`/`arrayContaining` → individual property assertions (last resort).
- Prefer matching full strings over fragments.
- Count first, then arguments, for call verification. `toHaveBeenNthCalledWith` for multiple differing calls.

## Async

- `async/await` everywhere. No `done` callbacks — vitest supports promises natively; if completion depends on a mock callback firing, resolve a promise from the `mockImplementation` instead.

## Quality Guidelines

- Tests are living documentation: clarity over cleverness, one behavior per test, runnable in any order.
- If setup gets complex, split into smaller focused suites.
- Always restore fake timers, globals, and env changes (`afterEach`).
- No snapshot tests here — explicit assertions only.
- Do not over-engineer scenarios the implementation doesn't have.

---

## Adaptations from the-agency v2

Recorded so nobody "fixes" these back:

| the-agency v2 (Jest/TS) | This repo (vitest/JS) | Why |
| --- | --- | --- |
| `jest.fn` / `jest.mock` / `jest.clearAllMocks` / `jest.resetModules` | `vi.fn` / `vi.mock` / `vi.clearAllMocks` / `vi.resetModules` | Direct equivalents. |
| Implicit Jest globals | Explicit `import { describe, it, expect, beforeEach, vi } from 'vitest'` | No config magic; standard vitest ESM. |
| `export default {}` at top of every test file | Dropped | It works around Jest+TS global-scope collisions; vitest isolates test files. |
| eslint pragmas for `any`, enum-based assertions, `.test.ts` | Dropped / `.test.js` | No TypeScript. The `_` prefix for unused args stays. |
| Mock module dependencies as the default | Real temp-dir sandboxes for fs-wrapper modules; `vi.mock` at project-module boundaries | The libs are thin fs wrappers; mocking fs tests the mock. |
| Dynamic imports + `jest.resetModules()` for stateful modules | Static imports | No module here holds module-level state or singletons. |
| `done` callback as last resort | Not used at all | Vitest's promise support covers the callback-completion case. |
