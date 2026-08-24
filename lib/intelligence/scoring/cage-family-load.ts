/**
 * Load the corporate-family resolver off the FLIS cage index. Separated from `cage-family.ts`
 * so the ALGORITHM is pure and testable against a hand-built index, while the I/O lives here.
 *
 * Memoized per process, like every other index in this codebase. A pm2 restart clears it, and
 * the deploy script restarts pm2, so a redeployed index is picked up without an extra step.
 *
 * ★ AN ABSENT INDEX IS AN ABSENCE, NOT A ZERO. `ok: false` carries the path that was looked for
 * and the reason, and every consumer must withhold the signal rather than score it as "nobody
 * is related to anybody", which is the shape that granted the false +15 in the first place.
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { resolveDataRoot } from '@/lib/data-root'
import { buildCageFamilyIndex, type CageFamilyIndex, type CageIndexShape } from './cage-family'

export type CageFamilyState =
  | { ok: true; index: CageFamilyIndex; file: string }
  | { ok: false; reason: string; file: string }

let cache: CageFamilyState | null = null

export function loadCageFamilyIndex(): CageFamilyState {
  if (cache) return cache
  const root = resolveDataRoot()
  const file = path.join(root.root, 'flis', 'cage-index.json')
  if (!existsSync(file)) {
    cache = {
      ok: false,
      file,
      reason:
        'No FLIS cage index on disk, so corporate family cannot be resolved. The award-silence ' +
        'signal withholds rather than crediting a silence it cannot ground.',
    }
    return cache
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<CageIndexShape>
    if (!Array.isArray(parsed.companies) || !Array.isArray(parsed.associations)) {
      cache = { ok: false, file, reason: 'The FLIS cage index is present but carries no companies/associations arrays.' }
      return cache
    }
    cache = { ok: true, file, index: buildCageFamilyIndex({ companies: parsed.companies, associations: parsed.associations }) }
    return cache
  } catch (e) {
    cache = { ok: false, file, reason: `The FLIS cage index could not be parsed: ${(e as Error).message}` }
    return cache
  }
}

export function resetCageFamilyCache(): void {
  cache = null
}
