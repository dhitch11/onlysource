import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The known-bad lint fixtures are deliberately broken source. They are input to the
    // lint self-test, never to the type checker or the test runner.
    exclude: ['node_modules/**', 'test/fixtures/**'],
    reporters: ['default'],
  },
})
