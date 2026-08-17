/**
 * MANUFACTURERS: resolving a CAGE code to the company that actually operates it.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS EXISTS, IN ONE SENTENCE
 * ---------------------------------------------------------------------------------------
 * The product counts approved sources per stock number and calls a row sole-sourced when the
 * count is one. That count is a count of CAGE CODES, and a CAGE code is not a company: one
 * operator can hold several. Every place the product says "two approved sources" while both
 * belong to the same firm, it is describing a corner and calling it a competitive market.
 *
 * The known case, and the reason this module is conservative: WKF holds `3BQS1` in Stockton CA
 * and `6KB87` in Clayton CA. Same operator, two codes, two cities, two ZIPs, and company
 * strings that are not equal:
 *     3BQS1  "WKF (FRIEDMAN) ENTERPRISES, INC."
 *     6KB87  "WKF (FRIEDMAN) ENTERPRISES, INC. DBA WKF FRIEDMAN ENTERPRISES, INC."
 *
 * ---------------------------------------------------------------------------------------
 * TWO EVIDENCE STATES, NEVER ONE BOOLEAN
 * ---------------------------------------------------------------------------------------
 * `complex_confirmed`      the government's own H5 corporate-complex file puts these CAGEs in
 *                          one association. This is a record, not an inference.
 * `same_operator_suspected` the company strings agree on a normalised prefix AND the two codes
 *                          share a Contract Administration Office. Ours, not the government's.
 *
 * They are kept apart because they carry different risk. A FALSE MERGE INVENTS A CORNER: fuse
 * two genuinely separate firms and the product reports a monopoly that does not exist, and an
 * operator buys inventory against it. That is strictly worse than not merging, so the suspected
 * state never silently upgrades a row's disposition; it is surfaced for a person to judge.
 *
 * ---------------------------------------------------------------------------------------
 * WHAT DOES NOT WORK, MEASURED, SO NOBODY REBUILDS IT
 * ---------------------------------------------------------------------------------------
 * `PARENT_CAGE` is the obvious column and it is EMPTY ON ALL 119,076 ROWS of
 * `V_H5_CORPORATE.CSV`, and empty in `V_CAGE_STATUS_AND_TYPE.CSV` for the WKF pair too. It
 * exists, it types, it joins, and it resolves nothing. The derivation script asserts the
 * populated count so the day it changes we learn it from a number.
 *
 * The real linkage is `ASSOCIATION_CAGE` + `AFFILIATION_CODE` (S 84,384 / P 5,085 / blank
 * 29,607), giving 29,980 multi-CAGE complexes over 108,850 CAGEs. **It is partial**: neither
 * WKF code appears in H5 at all. That is exactly why the second state exists.
 */
import { existsSync, readFileSync } from 'node:fs'

import { dataPath } from '../../data-root'

export type CageCompany = {
  cage: string
  company: string
  city: string
  state: string
  zip: string
  country: string
  status: string
  type: string
  /** Contract Administration Office. The exact-match corroborator for a name-prefix match. */
  cao: string
}

export type CageAssociation = {
  cage: string
  /** The CAGE at the head of the corporate complex. */
  association: string
  /** P or S in practice. Blank is common and is not read as anything. */
  affiliation: string
}

export type CageIndex = {
  ok: true
  companies: Map<string, CageCompany>
  associations: Map<string, CageAssociation>
  /** association head -> every CAGE recorded under it, including the head. */
  complexes: Map<string, string[]>
  provenance: {
    parentCagePopulated: number
    referencedCages: number
    resolvedCages: number
    unresolvedCages: number
    feedDay: string
    derivedFrom: Array<{ file: string; rows: number }>
  }
}

export type CageIndexUnavailable = { ok: false; reason: string }

let cache: { key: string; value: CageIndex | CageIndexUnavailable } | null = null

export function loadCageIndex(): CageIndex | CageIndexUnavailable {
  const file = dataPath('flis', 'cage-index.json')
  if (cache && cache.key === file) return cache.value
  const value = read(file)
  cache = { key: file, value }
  return value
}

export function resetCageIndexCache(): void {
  cache = null
}

function read(file: string): CageIndex | CageIndexUnavailable {
  if (!existsSync(file)) {
    return {
      ok: false,
      reason:
        'the company index derived from the free CAGE file is not in this data directory, so approved sources are shown by code only',
    }
  }
  let parsed: {
    provenance?: CageIndex['provenance']
    companies?: CageCompany[]
    associations?: CageAssociation[]
  }
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as typeof parsed
  } catch {
    return { ok: false, reason: 'the derived company index is present but could not be read' }
  }
  const companies = new Map<string, CageCompany>()
  for (const c of parsed.companies ?? []) companies.set(c.cage.toUpperCase(), c)
  const associations = new Map<string, CageAssociation>()
  const complexes = new Map<string, string[]>()
  for (const a of parsed.associations ?? []) {
    const cage = a.cage.toUpperCase()
    associations.set(cage, { ...a, cage })
    const members = complexes.get(a.association) ?? []
    if (!members.includes(cage)) members.push(cage)
    complexes.set(a.association, members)
  }
  if (companies.size === 0) {
    return { ok: false, reason: 'the derived company index is present but carries no companies' }
  }
  return {
    ok: true,
    companies,
    associations,
    complexes,
    provenance: parsed.provenance ?? {
      parentCagePopulated: 0,
      referencedCages: 0,
      resolvedCages: companies.size,
      unresolvedCages: 0,
      feedDay: 'unknown',
      derivedFrom: [],
    },
  }
}

/* ------------------------------------------------------------------------------------ */
/* NAME NORMALISATION                                                                     */
/* ------------------------------------------------------------------------------------ */

/**
 * Corporate suffixes stripped before comparison. Deliberately short: every entry here is a
 * chance to fuse two different companies, so it holds only forms that carry no distinguishing
 * information at all. "HOLDINGS", "GROUP" and "SYSTEMS" are NOT here, because
 * "ACME SYSTEMS" and "ACME" can be genuinely different firms.
 */
const SUFFIXES = new Set([
  'INC', 'INCORPORATED', 'LLC', 'LLP', 'LP', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED',
])

/**
 * Normalise a company string for comparison.
 *
 * Everything from a ` DBA ` onward is dropped: it is a trading name for the SAME legal entity,
 * which is precisely the WKF case, and keeping it makes two records of one company look like two
 * companies.
 */
export function normalizeCompanyName(raw: string): string {
  const upper = raw.toUpperCase()
  const dba = upper.search(/\bD\/?B\/?A\b/)
  const head = dba >= 0 ? upper.slice(0, dba) : upper
  const words = head
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1]!)) words.pop()
  return words.join(' ')
}

/* ------------------------------------------------------------------------------------ */
/* THE RESOLVER                                                                           */
/* ------------------------------------------------------------------------------------ */

export type OperatorEvidence = 'complex_confirmed' | 'same_operator_suspected' | 'distinct' | 'unresolved'

export type OperatorCluster = {
  /** The CAGE codes judged to belong to one operator. Always at least one. */
  cages: string[]
  /** The clearest available name, or null when no CAGE in the cluster resolved. */
  name: string | null
  evidence: OperatorEvidence
  /** The sentence a surface renders. Never empty, never a euphemism for an unknown. */
  basis: string
}

export type OperatorGrouping = {
  clusters: OperatorCluster[]
  /** CAGE codes in, distinct operators out. The number the disposition should use. */
  cageCount: number
  operatorCount: number
  /** True when at least one cluster merged two or more codes. */
  collapsed: boolean
  /** CAGE codes the index could not resolve. Named, never silently dropped. */
  unresolved: string[]
  indexAvailable: boolean
}

/**
 * Group CAGE codes into operators.
 *
 * Order matters: the government's record is applied first, and the name heuristic is only
 * allowed to merge codes the record did not already place together. A heuristic must never
 * overrule a record.
 */
export function groupByOperator(
  cages: readonly string[],
  index: CageIndex | CageIndexUnavailable = loadCageIndex(),
): OperatorGrouping {
  const unique = [...new Set(cages.map((c) => String(c).toUpperCase().trim()))].filter(Boolean)

  if (!index.ok) {
    return {
      clusters: unique.map((cage) => ({
        cages: [cage],
        name: null,
        evidence: 'unresolved',
        basis: 'no company index is loaded, so this code could not be resolved to a company',
      })),
      cageCount: unique.length,
      operatorCount: unique.length,
      collapsed: false,
      unresolved: unique,
      indexAvailable: false,
    }
  }

  const unresolved = unique.filter((c) => !index.companies.has(c))

  // 1. THE RECORD. Codes sharing an H5 association head belong together.
  const byKey = new Map<string, { cages: string[]; recorded: boolean }>()
  for (const cage of unique) {
    const assoc = index.associations.get(cage)
    const key = assoc ? `assoc:${assoc.association}` : `cage:${cage}`
    const bucket = byKey.get(key) ?? { cages: [], recorded: Boolean(assoc) }
    bucket.cages.push(cage)
    byKey.set(key, bucket)
  }

  // 2. THE HEURISTIC, applied only ACROSS buckets the record left separate. Two buckets merge
  //    when their normalised names agree on a prefix AND they share a CAO. Both conditions,
  //    always: the name alone fuses "PRECISION" with "PRECISION AEROSPACE", and the CAO alone
  //    fuses every unrelated firm administered from the same office.
  //
  //    ★ `recorded` IS TRACKED SEPARATELY FROM `confirmed`, AND THE DISTINCTION IS LOAD-BEARING.
  //    `confirmed` means the record MERGED these codes (an association with more than one member
  //    on this item). `recorded` means the government has an association entry for the code AT
  //    ALL, whether or not it merged anything here. Two codes that each carry an association
  //    entry pointing at DIFFERENT heads have been placed in different corporate complexes BY
  //    THE RECORD, and the name heuristic is not permitted to overturn that however well the
  //    strings match. **The heuristic fills the record's silence; it never contradicts its
  //    speech.** A test pins this, and it caught the resolver doing exactly the wrong thing.
  type Bucket = { cages: string[]; confirmed: boolean; recorded: boolean; names: string[]; caos: Set<string> }
  const buckets: Bucket[] = [...byKey.values()].map((b) => ({
    cages: b.cages,
    confirmed: b.recorded && b.cages.length > 1,
    recorded: b.recorded,
    names: b.cages.map((c) => index.companies.get(c)?.company ?? '').filter(Boolean),
    caos: new Set(b.cages.map((c) => index.companies.get(c)?.cao ?? '').filter(Boolean)),
  }))

  const merged: Array<Bucket & { suspected: boolean }> = []
  for (const bucket of buckets) {
    const norm = bucket.names.map(normalizeCompanyName).filter(Boolean)
    let landed = false
    if (!bucket.confirmed && norm.length > 0) {
      for (const existing of merged) {
        if (existing.confirmed) continue
        // Both sides carry a record placing them in separate complexes. Leave them separate.
        if (existing.recorded && bucket.recorded) continue
        const eNorm = existing.names.map(normalizeCompanyName).filter(Boolean)
        const nameAgrees = norm.some((a) =>
          eNorm.some((b) => a !== '' && b !== '' && (a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `))),
        )
        const caoAgrees = [...bucket.caos].some((c) => existing.caos.has(c))
        if (nameAgrees && caoAgrees) {
          existing.cages.push(...bucket.cages)
          existing.names.push(...bucket.names)
          for (const c of bucket.caos) existing.caos.add(c)
          existing.suspected = true
          landed = true
          break
        }
      }
    }
    if (!landed) merged.push({ ...bucket, suspected: false })
  }

  const clusters: OperatorCluster[] = merged.map((b) => {
    const name = b.names[0] ?? null
    if (b.cages.length === 1) {
      const resolved = index.companies.has(b.cages[0]!)
      return {
        cages: b.cages,
        name,
        evidence: resolved ? 'distinct' : 'unresolved',
        basis: resolved
          ? 'one code, and nothing links it to another code on this item'
          : 'this code is not in the company index, so it is counted on its own',
      }
    }
    if (b.confirmed) {
      return {
        cages: b.cages,
        name,
        evidence: 'complex_confirmed',
        basis: `the government's corporate complex file records these ${b.cages.length} codes under one association`,
      }
    }
    return {
      cages: b.cages,
      name,
      evidence: 'same_operator_suspected',
      basis: `these ${b.cages.length} codes carry the same company name and the same contract administration office, which is our reading and not a government record`,
    }
  })

  return {
    clusters,
    cageCount: unique.length,
    operatorCount: clusters.length,
    collapsed: clusters.some((c) => c.cages.length > 1),
    unresolved,
    indexAvailable: true,
  }
}

/** Convenience: the company record for one code, or null. Never a fabricated placeholder. */
export function lookupCage(
  cage: string,
  index: CageIndex | CageIndexUnavailable = loadCageIndex(),
): CageCompany | null {
  if (!index.ok) return null
  return index.companies.get(String(cage).toUpperCase().trim()) ?? null
}
