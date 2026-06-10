import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'entrypoints/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Date-formatting code deliberately uses LOCAL date parts (it
    // mirrors what x.com shows the user), so its expected values are
    // timezone-dependent. Pin the suite to UTC for reproducibility.
    env: { TZ: 'UTC' },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '~': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
