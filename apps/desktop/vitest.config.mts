import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@inova': resolve(import.meta.dirname, '../../src') } },
  test: { include: ['test/**/*.test.ts'], testTimeout: 60_000 },
});
