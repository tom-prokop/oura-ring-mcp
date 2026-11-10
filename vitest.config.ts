import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/worker/**', 'node_modules/**'],
        },
      },
      {
        // Worker tests run inside workerd (Miniflare) with wrangler.jsonc bindings.
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              bindings: {
                PUBLIC_BASE_URL: 'http://localhost:8787',
                OURA_CLIENT_ID: 'test-oura-client',
                OURA_CLIENT_SECRET: 'test-oura-secret',
                ALLOWED_OURA_USER_ID: 'tom-oura-id',
              },
            },
          }),
        ],
        test: {
          name: 'worker',
          include: ['src/worker/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'src/types/**',        // Generated types from OpenAPI
        'src/auth/**',         // CLI auth code (interactive, hard to test)
        'src/worker/**',       // Runs in workerd; covered by the 'worker' test project
        'dist/**',
        'node_modules/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        'scripts/**',
        'vitest.config.ts',
        'tests/fixtures/**',   // Test fixtures (JSON)
        'tests/helpers/**',    // Test helpers
        'src/utils/index.ts',  // Re-export file
      ],
      thresholds: {
        // Global thresholds
        branches: 70,
        functions: 80,
        lines: 80,
        statements: 80,
        // Per-file thresholds for utilities (higher standards)
        'src/utils/formatters.ts': {
          branches: 100,
          functions: 100,
          lines: 95,
          statements: 95
        },
        'src/utils/errors.ts': {
          branches: 95,
          functions: 100,
          lines: 95,
          statements: 95
        },
        'src/utils/analysis.ts': {
          branches: 80,
          functions: 95,
          lines: 90,
          statements: 90
        },
        'src/client.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100
        }
      }
    }
  }
});
