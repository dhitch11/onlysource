import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * THE CONTACTED LEDGER — which suppliers have already been reached, so nobody is double-touched.
 *
 * A single JSON array of CAGE codes in the state directory (gitignored, survives deploys). The estate
 * rule is that outreach dedups against a contacted list; this is that list for the supplier book. It
 * is per-operator and honest: it records exactly the CAGEs the operator marked, nothing inferred.
 */

function stateDir(): string {
  return process.env.ONLYSOURCE_STATE_DIR || path.join(process.cwd(), '.state')
}
function filePath(): string {
  return path.join(stateDir(), 'contacted-suppliers.json')
}

export function readContacted(): string[] {
  try {
    const p = filePath()
    if (!existsSync(p)) return []
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Toggle a CAGE in the ledger; returns the new full list. */
export function toggleContacted(cage: string): string[] {
  const set = new Set(readContacted())
  if (set.has(cage)) set.delete(cage)
  else set.add(cage)
  const list = [...set]
  const dir = stateDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath(), JSON.stringify(list, null, 2), 'utf8')
  return list
}
