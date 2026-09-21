import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // The stdin shims and the CLI run as child processes in the
      // integration tests, which v8 coverage cannot observe. Their logic
      // lives in src/lib/hooks/ and is unit-tested there. Test files are
      // co-located with their modules, so exclude them from coverage too.
      exclude: ['src/hooks/**', 'src/cli/**', '**/*.test.js'],
      thresholds: {
        lines: 100
      }
    }
  }
});
