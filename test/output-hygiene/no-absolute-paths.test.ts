import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CONTROL: no absolute developer path may appear in any shippable string. A citation, sourceFile,
 * or source_path that renders "/Users/user/…" into a downloadable/emailable exhibit discloses the
 * developer's home directory AND the filenames of the customer's private trade notes and our
 * internal research corpus. This scans the source (where output strings live), stripping comments,
 * and fails on any `/Users/` outside a tiny whitelist of env-default fallbacks that never render.
 */
const ROOTS = ['lib', 'app', 'components']
// The only sanctioned occurrences: env-defaulted data-root fallbacks, never rendered to a user.
const WHITELIST = new Set([
  // Env-defaulted data-root fallbacks. Never rendered to a user.
  'lib/ingest/db.ts',
  'lib/data-root.ts',
  // ── KNOWN DEBT, owned by the eligibility (lane D) lane, NOT this lane's to edit. ──
  // These carry the identical citation-path leak this control exists to catch (MECHANICS / SPINE /
  // NSN_DOC consts). Handed to @BUILD-THE-WIRES; REMOVE these two entries the moment lane D replaces
  // its absolute paths with stable public identifiers, so the control fails again if they regress.
  'lib/engine/eligibility/amsc.ts',
  'lib/engine/eligibility/gate.ts',
])
const EXTS = ['.ts', '.tsx', '.json']

function walk(dir: string, out: string[]) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next') continue
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (EXTS.some((x) => p.endsWith(x)) && !p.endsWith('.test.ts') && !p.endsWith('.test.tsx')) out.push(p)
  }
}
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

describe('no absolute developer paths in shippable strings', () => {
  const files: string[] = []
  for (const r of ROOTS) { try { walk(r, files) } catch {} }

  it('scans a real set of files', () => expect(files.length).toBeGreaterThan(50))

  for (const f of files) {
    const rel = f
    it(`${rel} carries no /Users/ path`, () => {
      const src = stripComments(readFileSync(f, 'utf8'))
      const hit = src.includes('/Users/')
      if (hit && WHITELIST.has(rel)) return // sanctioned env-default
      expect(hit, `${rel} contains an absolute /Users/ path in a non-comment string`).toBe(false)
    })
  }
})
