import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './test/helper/setup.ts',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/bin/**', // CLI tools - tested manually
        'src/interfaces/**', // Type definitions only
        'src/index.ts', // Re-exports only
        'src/utils.ts', // Utility generator - not used in core logic
      ],
    },
  },
});
