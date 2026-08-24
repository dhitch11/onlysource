/**
 * H10 — resolve `server-only` to its own empty.js for standalone tsx harnesses.
 *
 * `server-only` throws at IMPORT time outside a React Server Component, so a script that reaches
 * any module importing it dies before one line of it runs. vitest.config.mts already solves this
 * for the test runner with a resolve alias to the package's own `empty.js` (the file its own
 * `react-server` export condition points at). This is that same alias for Node's CommonJS
 * resolver, which is the one tsx actually uses.
 *
 * Scoped to this ONE specifier, exactly as the vitest alias is. It is a preload for scripts only
 * and is never bundled into the app.
 *
 * Usage: npx tsx --require ./scripts/h10/server-only.cjs scripts/score-nsn.mts <nsn>
 */
const Module = require('node:module')
const path = require('node:path')
const EMPTY = path.join(__dirname, '..', '..', 'node_modules', 'server-only', 'empty.js')
const original = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'server-only') return EMPTY
  return original.call(this, request, ...rest)
}
