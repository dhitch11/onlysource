import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { readWorkbookSheets } from '@/lib/intelligence/seed/xlsx'
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
  | { ok: true; competitors: CompetitorTeardown[] }
  | { ok: false; reason: string }

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
  const files = readdirSync(dir).filter((f) => /-parts\.xlsx$/i.test(f))
  if (files.length === 0) {
    cache = { ok: false, reason: 'No <company>-parts.xlsx export is on disk yet.' }
    return cache
  }

  const competitors: CompetitorTeardown[] = []
  for (const file of files) {
    const wb = readWorkbookSheets(path.join(dir, file))
    const mcrl = wb.sheets.get('MCRL')
    if (!mcrl) continue

    // Group MCRL rows by NSN, collecting every approved source per NSN.
    type Src = { cage: string; company: string | null; amsc: string | null; partNumber: string | null; description: string }
    const byNsn = new Map<string, Src[]>()
    const cageFreq = new Map<string, number>()
    const cageCompany = new Map<string, string | null>()

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
      if (!cageCompany.has(cage)) cageCompany.set(cage, src.company)
    }

    // The subject of the file is the CAGE that appears on the most stock numbers.
    let subjectCage = ''
    let best = -1
    for (const [cage, n] of cageFreq) {
      if (n > best) {
        best = n
        subjectCage = cage
      }
    }
    if (!subjectCage) continue

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
    // Sole-source positions first (their monopolies), then most-competed.
    parts.sort((a, b) => Number(b.soleSource) - Number(a.soleSource) || a.sourceCount - b.sourceCount)

    competitors.push({
      cage: subjectCage,
      company: cageCompany.get(subjectCage) ?? null,
      fileLabel: file,
      parts,
      summary: {
        parts: parts.length,
        soleSource: parts.filter((p) => p.soleSource).length,
        competed: parts.filter((p) => !p.soleSource).length,
        distinctRivals: rivals.size,
      },
    })
  }

  cache = competitors.length > 0 ? { ok: true, competitors } : { ok: false, reason: 'No MCRL sheet found in the parts exports.' }
  return cache
}
