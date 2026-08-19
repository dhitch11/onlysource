import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { readWorkbookSheets, listWorkbookFiles } from '@/lib/intelligence/seed/xlsx'
import { dataPath } from '@/lib/data-root'

/**
 * COMPETITOR TEARDOWN — take a company apart, stock number by stock number.
 *
 * A `<company>-parts.xlsx` export carries an MCRL sheet: one row per (stock number, approved source),
 * so for the company the file is about we can see every part they are approved to make AND every OTHER
 * company approved to make the same part. That is the whole game: where the company is the ONLY source,
 * it holds a private monopoly; where several sources exist, it competes. Nothing is inferred; every
 * source pairing is a row the government published. Drop any future `<name>-parts.xlsx` in and it loads.
 */

const SUPPLIERS_DIR = 'suppliers'

export type CompetitorPart = {
  nsn: string
  niin: string
  description: string
  partNumber: string | null
  amsc: string | null
  /** Every CAGE approved to make this part, from the MCRL (includes the subject). */
  sourceCount: number
  soleSource: boolean
  otherSources: Array<{ cage: string; company: string | null }>
}

export type CompetitorTeardown = {
  cage: string
  company: string | null
  fileLabel: string
  parts: CompetitorPart[]
  summary: {
    parts: number
    soleSource: number
    competed: number
    distinctRivals: number
  }
}

export type CompetitorCatalogs =
  | { ok: true; competitors: CompetitorTeardown[]; defaultCage: string }
  | { ok: false; reason: string }

/** The minimum parts for a company to get its own teardown, and the cap on how many we surface. */
const MIN_PARTS = 3
const MAX_COMPETITORS = 40

const clean = (v: string | undefined | null): string => (v ?? '').trim()
const niinOf = (nsn: string): string => nsn.replace(/[^0-9]/g, '').slice(-9)

let cache: CompetitorCatalogs | null = null

export function buildCompetitorCatalogs(): CompetitorCatalogs {
  if (cache) return cache
  const dir = dataPath(SUPPLIERS_DIR)
  if (!existsSync(dir)) {
    cache = { ok: false, reason: 'No suppliers data directory on disk.' }
    return cache
  }
  // Dot-prefixed entries are never exports. See `listWorkbookFiles`: an ending-only match let a
  // macOS AppleDouble sidecar (`._<name>-parts.xlsx`) reach the zip reader and took this page
  // down with an error boundary behind an HTTP 200.
  const files = listWorkbookFiles(readdirSync(dir), (f) => /-parts\.xlsx$/i.test(f))
  if (files.length === 0) {
    cache = { ok: false, reason: 'No <company>-parts.xlsx export is on disk yet.' }
    return cache
  }

  // Parse every parts export into one shared web of NSN -> approved sources.
  type Src = { cage: string; company: string | null; amsc: string | null; partNumber: string | null; description: string }
  const byNsn = new Map<string, Src[]>()
  const cageFreq = new Map<string, number>()
  const cageCompany = new Map<string, string | null>()
  let sawMcrl = false
  const stems: string[] = []
  /** Candidates that survived the filter and still could not be read. Reported, never swallowed. */
  const unreadable: Array<{ file: string; reason: string }> = []

  for (const file of files) {
    /*
     * ONE UNREADABLE EXPORT MUST NOT TAKE DOWN THE PAGE.
     *
     * This read was unguarded, so a single corrupt, truncated or non-zip candidate threw
     * straight out of the server render and the operator got the error boundary instead of the
     * thirty-nine companies we could still have shown. A directory of exports is not an atomic
     * object: the honest behaviour is to read what is readable, and to SAY what was not.
     *
     * The filter above removes the sidecar class specifically. This guard covers everything
     * else a directory can hand us, including whatever the next transfer between machines
     * invents, because the filter can only exclude what we already know to name.
     */
    let wb
    try {
      wb = readWorkbookSheets(path.join(dir, file))
    } catch (error) {
      unreadable.push({ file, reason: (error as Error).message })
      continue
    }
    const mcrl = wb.sheets.get('MCRL')
    if (!mcrl) continue
    sawMcrl = true
    stems.push(file.replace(/-parts\.xlsx$/i, '').replace(/[-_]+/g, ' ').toLowerCase().trim())
    for (const row of mcrl.rows) {
      const nsn = clean(row['NSN Number'])
      const cage = clean(row['Cage']).toUpperCase()
      if (!nsn || !cage) continue
      const src: Src = {
        cage,
        company: clean(row['Company']) || null,
        amsc: clean(row['AMSC']) || null,
        partNumber: clean(row['Part Number']) || null,
        description: clean(row['Description']),
      }
      const list = byNsn.get(nsn) ?? []
      list.push(src)
      byNsn.set(nsn, list)
      cageFreq.set(cage, (cageFreq.get(cage) ?? 0) + 1)
      if (!cageCompany.has(cage) && src.company) cageCompany.set(cage, src.company)
    }
  }

  if (!sawMcrl) {
    /*
     * NAME THE REASON THAT ACTUALLY APPLIES. If every candidate failed to READ, saying "no MCRL
     * sheet" sends the operator to look for a sheet inside files nothing ever opened. An empty
     * state that misdescribes its own cause is worse than no empty state, because it is acted on.
     */
    cache = {
      ok: false,
      reason:
        unreadable.length === files.length
          ? `None of the ${files.length} parts export${files.length === 1 ? '' : 's'} on disk could be read: ${unreadable
              .map((u) => `${u.file} (${u.reason})`)
              .join('; ')}`
          : 'No MCRL sheet found in the parts exports.',
    }
    return cache
  }

  // A teardown is derivable for any CAGE that appears on enough parts. Build the biggest players.
  const buildFor = (subjectCage: string): CompetitorTeardown => {
    const parts: CompetitorPart[] = []
    const rivals = new Set<string>()
    for (const [nsn, sources] of byNsn) {
      const mine = sources.find((s) => s.cage === subjectCage)
      if (!mine) continue
      const distinctCages = [...new Map(sources.map((s) => [s.cage, s])).values()]
      const others = distinctCages.filter((s) => s.cage !== subjectCage)
      others.forEach((o) => rivals.add(o.cage))
      parts.push({
        nsn,
        niin: niinOf(nsn),
        description: mine.description,
        partNumber: mine.partNumber,
        amsc: mine.amsc,
        sourceCount: distinctCages.length,
        soleSource: distinctCages.length === 1,
        otherSources: others.map((o) => ({ cage: o.cage, company: o.company })),
      })
    }
    parts.sort((a, b) => Number(b.soleSource) - Number(a.soleSource) || a.sourceCount - b.sourceCount)
    return {
      cage: subjectCage,
      company: cageCompany.get(subjectCage) ?? null,
      fileLabel: files[0] ?? '',
      parts,
      summary: {
        parts: parts.length,
        soleSource: parts.filter((p) => p.soleSource).length,
        competed: parts.filter((p) => !p.soleSource).length,
        distinctRivals: rivals.size,
      },
    }
  }

  const bigCages = [...cageFreq.entries()]
    .filter(([, n]) => n >= MIN_PARTS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_COMPETITORS)
    .map(([cage]) => cage)

  const competitors = bigCages.map(buildFor).sort((a, b) => b.summary.parts - a.summary.parts)
  if (competitors.length === 0) {
    cache = { ok: false, reason: 'No company in the parts export is an approved source for enough parts to tear down.' }
    return cache
  }

  // Default to the company the file is named for; otherwise the biggest player.
  let defaultCage = competitors[0]!.cage
  for (const stem of stems) {
    if (stem.length < 4) continue
    const match = competitors.find((c) => (c.company ?? '').toLowerCase().includes(stem))
    if (match) {
      defaultCage = match.cage
      break
    }
  }

  cache = { ok: true, competitors, defaultCage }
  return cache
}
