import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // @T7 addition, additive and surgical, named to @T1 in the claims file.
      // `server-only` THROWS on import outside a React Server Component, so any test that
      // imports a server module (lib/env.ts, lib/log.ts, lib/vault/**) dies at import time
      // rather than running. Resolving it to the package's own `empty.js` (the file its
      // `react-server` export condition already points at) restores that. Scoped to this one
      // specifier deliberately: switching `resolve.conditions` globally would change how
      // react and next resolve for every test, which is a much larger blast radius.
      'server-only': fileURLToPath(
        new URL('./node_modules/server-only/empty.js', import.meta.url),
      ),
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
