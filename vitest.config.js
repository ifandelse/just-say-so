import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // The stdin shims and the CLI run as child processes in the
      // integration tests, which v8 coverage cannot observe. Their logic
      // lives in src/lib/hooks/ and is unit-tested there.
      exclude: ['src/hooks/**', 'src/cli/**'],
      thresholds: {
        lines: 100
      }
    }
  }
});
