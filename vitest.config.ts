import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'layer1/**/*.test.ts',
      'layer2/**/*.test.ts',
      'layer3/**/*.test.ts',
      '__tests__/**/*.test.ts',
    ],
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['**/*.test.ts', '**/__tests__/**', 'dist/**', 'node_modules/**'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
