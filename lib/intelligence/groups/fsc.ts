/**
 * FEDERAL SUPPLY GROUPS AND CLASSES: the government's own segmentation of the catalogue.
 *
 * ---------------------------------------------------------------------------------------
 * WHAT THIS IS
 * ---------------------------------------------------------------------------------------
 * Every National Stock Number begins with a four digit Federal Supply Class, and the first
 * two of those four are the Federal Supply Group. We have parsed that prefix on every row
 * since the beginning and never once used it, because a bare four digit code tells an
 * operator nothing. `5330` is not a market. "PACKING AND GASKET MATERIALS" is.
 *
 * The titles are published free, monthly, by DLA in the H series of the PUB LOG extract,
 * and they arrive with more than a title: each class carries the government's own scope
 * prose, saying what the class INCLUDES and what it EXCLUDES. That turns a prefix into a
 * bounded market segment with a definition an operator can act on and argue with.
 *
 * Measured on the current feed: 220 distinct classes across 57 groups, and the H2 table
 * answers EVERY ONE of them. Zero rows fall outside it. That is why this module treats a
 * missing title as a fact worth reporting rather than a case worth papering over: today the
 * number is zero, and if it ever is not, the surface should say so rather than print a code.
 *
 * ---------------------------------------------------------------------------------------
 * THE HONEST PART, AND THE REASON THIS MODULE COMPUTES A P VALUE
 * ---------------------------------------------------------------------------------------
 * The reason to group at all is the hope that corners concentrate in some classes. They do:
 * across the 30 classes holding at least 20 rows, the candidate corner rate varies far more
 * than binomial chance allows (chi-square 57.0 on 29 degrees of freedom, p = 1.5e-3). So the
 * dimension is real and worth showing.
 *
 * But at this sample size ONE class survives correction for having tested thirty of them:
 * 6505 DRUGS AND BIOLOGICALS, 8 candidates in 31 rows, 25.8% against a 5.37% baseline,
 * p = 1.8e-4. Every other class is suggestive and no more. A surface that prints "10.3%,
 * 1.9x the baseline" next to a class whose exact binomial p value is 0.16 has invented a
 * finding out of thirty coin flips, and an operator who stocks against it loses money.
 *
 * So each group carries an evidence state, in the same spirit as the CornerScore legs:
 *   `significant`         the excess survives Bonferroni correction across the classes tested
 *   `indicative`          a real measured rate, not distinguishable from the baseline
 *   `insufficient_sample` fewer rows than the floor; no rate is claimed at all
 * The counts are always real. It is the INFERENCE that is graded, and it is graded down.
 */
import { readFileSync } from 'node:fs'

import { dataPath } from '../../data-root'
import { parseCsv } from '../../ingest/parse/csv'
import type { CornerRow } from '../corner'

/** A class holding fewer rows than this gets no rate and no inference. */
export const SAMPLE_FLOOR = 20

/** Family-wise error rate spent across the classes that clear the floor. */
export const FAMILY_ALPHA = 0.05

export type FscEntry = {
  /** The four digit class. */
  fsc: string
  title: string
  notes: string
  /** The government's own scope prose. Empty string where the table carries none. */
  inclusions: string
  exclusions: string
}

export type FsgEntry = {
  /** The two digit group. */
  fsg: string
  title: string
  notes: string
}

export type FscCatalog = {
  ok: true
  fsc: Map<string, FscEntry>
  fsg: Map<string, FsgEntry>
  provenance: {
    fscFile: string
    fsgFile: string
    fscRows: number
    fsgRows: number
  }
}

export type FscCatalogUnavailable = {
  ok: false
  /** Rendered to the operator verbatim. Never a zero, never a guess. */
  reason: string
}

const FSC_FILE = 'V_H2_FSC.CSV'
const FSG_FILE = 'V_H2_FSG.CSV'

/**
 * Load the H2 tables.
 *
 * These files are small (under 200 KB each) and change monthly, so they are read on demand and
 * memoized on the resolved path rather than cached for the life of the process: a data
 * directory can be remounted under a running server and a cached absence would outlive it,
 * which is the same reasoning `resolveDataRoot` documents.
 */
let cache: { key: string; value: FscCatalog | FscCatalogUnavailable } | null = null

export function loadFscCatalog(): FscCatalog | FscCatalogUnavailable {
  const fscPath = dataPath('flis', FSC_FILE)
  const fsgPath = dataPath('flis', FSG_FILE)
  const key = `${fscPath}::${fsgPath}`
  if (cache && cache.key === key) return cache.value

  const value = readCatalog(fscPath, fsgPath)
  cache = { key, value }
  return value
}

/** Drop the memo. Tests that swap the data root call this; nothing in the request path does. */
export function resetFscCatalogCache(): void {
  cache = null
}

function readCatalog(fscPath: string, fsgPath: string): FscCatalog | FscCatalogUnavailable {
  let fscText: string
  let fsgText: string
  try {
    // latin-1, not utf-8: the government files carry high bytes in the scope prose and a utf-8
    // decode replaces them with U+FFFD, which then renders as a black diamond inside a title.
    fscText = readFileSync(fscPath, 'latin1')
    fsgText = readFileSync(fsgPath, 'latin1')
  } catch {
    return {
      ok: false,
      reason:
        'the Federal Supply Class tables are not in this data directory, so classes are shown by code only',
    }
  }

  const fscRecords = parseCsv(fscText).records
  const fsgRecords = parseCsv(fsgText).records
  if (fscRecords.length < 2 || fsgRecords.length < 2) {
    return { ok: false, reason: 'the Federal Supply Class tables are present but carry no rows' }
  }

  const fsc = new Map<string, FscEntry>()
  for (const record of fscRecords.slice(1)) {
    const [code = '', title = '', notes = '', inclusions = '', exclusions = ''] = record.fields
    const key = code.trim()
    // A row without a code cannot be looked up, so it is skipped rather than stored under ''.
    if (key.length !== 4) continue
    fsc.set(key, {
      fsc: key,
      title: title.trim(),
      notes: notes.trim(),
      inclusions: inclusions.trim(),
      exclusions: exclusions.trim(),
    })
  }

  // The FSG file is keyed by CLASS and repeats the group title on every class in that group,
  // which is why the group map is built by taking the first two characters of the class key.
  const fsg = new Map<string, FsgEntry>()
  for (const record of fsgRecords.slice(1)) {
    const [code = '', title = '', notes = ''] = record.fields
    const key = code.trim()
    if (key.length !== 4) continue
    const group = key.slice(0, 2)
    if (fsg.has(group)) continue
    fsg.set(group, { fsg: group, title: title.trim(), notes: notes.trim() })
  }

  return {
    ok: true,
    fsc,
    fsg,
    provenance: { fscFile: fscPath, fsgFile: fsgPath, fscRows: fsc.size, fsgRows: fsg.size },
  }
}

/* ------------------------------------------------------------------------------------ */
/* THE ROLLUP                                                                            */
/* ------------------------------------------------------------------------------------ */

export type GroupEvidence = 'significant' | 'indicative' | 'insufficient_sample'

export type FscGroupRow = {
  fsc: string
  fsg: string
  /** Null when the H2 table does not carry this class. Rendered as a stated absence. */
  title: string | null
  fsgTitle: string | null
  inclusions: string
  exclusions: string
  /** Every count below is a plain count of real rows. Nothing here is modelled. */
  rows: number
  soleSource: number
  candidates: number
  /** Null below the sample floor: a rate on 6 rows is not a rate. */
  candidateRate: number | null
  /** Candidate rate divided by the whole-map baseline. Null below the floor. */
  lift: number | null
  /** Exact binomial P(X >= candidates | rows, baseline). Null below the floor. */
  pValue: number | null
  evidence: GroupEvidence
}

export type FscRollup = {
  groups: FscGroupRow[]
  baseline: number
  totals: { rows: number; soleSource: number; candidates: number; classes: number; supplyGroups: number }
  /** How many classes cleared the floor, and the corrected threshold they were judged against. */
  tested: number
  bonferroniAlpha: number
  /** Measured, and expected to be zero. A non-zero value is a real finding about the feed. */
  classesMissingFromCatalog: number
  catalogAvailable: boolean
  catalogReason: string | null
}

/**
 * Roll the corner map up by Federal Supply Class.
 *
 * `candidates` uses the same definition the Monopoly Map ranks on, a sole sourced row whose
 * approved source carries the award silence measurement, so the two surfaces cannot disagree
 * about what a candidate corner is.
 */
export function buildFscRollup(
  rows: readonly CornerRow[],
  catalog: FscCatalog | FscCatalogUnavailable = loadFscCatalog(),
): FscRollup {
  const buckets = new Map<string, { rows: number; sole: number; cand: number }>()
  for (const row of rows) {
    const fsc = row.nsn.slice(0, 4)
    const bucket = buckets.get(fsc) ?? { rows: 0, sole: 0, cand: 0 }
    bucket.rows += 1
    if (row.soleSource) bucket.sole += 1
    if (row.soleSource && row.silentSourceCount > 0) bucket.cand += 1
    buckets.set(fsc, bucket)
  }

  const totalRows = rows.length
  const totalCandidates = rows.filter((r) => r.soleSource && r.silentSourceCount > 0).length
  const baseline = totalRows === 0 ? 0 : totalCandidates / totalRows

  const tested = [...buckets.values()].filter((b) => b.rows >= SAMPLE_FLOOR).length
  // Bonferroni over the classes actually judged. Testing thirty classes and reporting the best
  // one at p < 0.05 finds a "finding" in pure noise roughly four times in five.
  const bonferroniAlpha = tested === 0 ? FAMILY_ALPHA : FAMILY_ALPHA / tested

  let missing = 0
  const groups: FscGroupRow[] = []
  for (const [fsc, bucket] of buckets) {
    const entry = catalog.ok ? catalog.fsc.get(fsc) : undefined
    if (catalog.ok && !entry) missing += 1
    const fsg = fsc.slice(0, 2)
    const fsgEntry = catalog.ok ? catalog.fsg.get(fsg) : undefined

    const eligible = bucket.rows >= SAMPLE_FLOOR && baseline > 0
    const rate = eligible ? bucket.cand / bucket.rows : null
    const pValue = eligible ? binomialSurvival(bucket.cand, bucket.rows, baseline) : null
    const evidence: GroupEvidence = !eligible
      ? 'insufficient_sample'
      : pValue !== null && pValue < bonferroniAlpha
        ? 'significant'
        : 'indicative'

    groups.push({
      fsc,
      fsg,
      title: entry?.title ?? null,
      fsgTitle: fsgEntry?.title ?? null,
      inclusions: entry?.inclusions ?? '',
      exclusions: entry?.exclusions ?? '',
      rows: bucket.rows,
      soleSource: bucket.sole,
      candidates: bucket.cand,
      candidateRate: rate,
      lift: rate !== null && baseline > 0 ? rate / baseline : null,
      pValue,
      evidence,
    })
  }

  // Significant first, then by candidate count, then by size. A class with no rate never
  // outranks one with a measured rate, because ordering is itself a claim about importance.
  const evidenceRank: Record<GroupEvidence, number> = {
    significant: 0,
    indicative: 1,
    insufficient_sample: 2,
  }
  groups.sort(
    (a, b) =>
      evidenceRank[a.evidence] - evidenceRank[b.evidence] ||
      b.candidates - a.candidates ||
      b.rows - a.rows ||
      a.fsc.localeCompare(b.fsc),
  )

  return {
    groups,
    baseline,
    totals: {
      rows: totalRows,
      soleSource: rows.filter((r) => r.soleSource).length,
      candidates: totalCandidates,
      classes: buckets.size,
      supplyGroups: new Set([...buckets.keys()].map((f) => f.slice(0, 2))).size,
    },
    tested,
    bonferroniAlpha,
    classesMissingFromCatalog: missing,
    catalogAvailable: catalog.ok,
    catalogReason: catalog.ok ? null : catalog.reason,
  }
}

/* ------------------------------------------------------------------------------------ */
/* EXACT BINOMIAL, IN LOG SPACE                                                          */
/* ------------------------------------------------------------------------------------ */

/**
 * P(X >= k) for X ~ Binomial(n, p), computed exactly in log space.
 *
 * Log space is not premature caution. `n` here is a row count that grows with the feed, and a
 * naive product of binomial coefficients overflows a double somewhere above n = 1030. An
 * overflow would surface as `Infinity`, then `NaN`, then a p value that silently fails every
 * comparison and grades a class `indicative` forever. The failure would be invisible.
 */
export function binomialSurvival(k: number, n: number, p: number): number {
  if (n <= 0) return 1
  if (k <= 0) return 1
  if (k > n) return 0
  if (p <= 0) return 0
  if (p >= 1) return 1

  const logP = Math.log(p)
  const logQ = Math.log1p(-p)
  let total = 0
  for (let i = k; i <= n; i += 1) {
    total += Math.exp(logChoose(n, i) + i * logP + (n - i) * logQ)
  }
  // Floating point can carry the sum a hair past 1; a probability above 1 is a bug, not a result.
  return Math.min(1, total)
}

function logChoose(n: number, k: number): number {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1)
}

/** Lanczos approximation. Accurate to ~15 significant digits over the range this module uses. */
function logGamma(z: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  if (z < 0.5) {
    // Reflection, so the approximation is only ever evaluated on its accurate half.
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
  }
  const x = z - 1
  let a = 0.99999999999980993
  const t = x + 7.5
  for (const [i, coefficient] of g.entries()) a += coefficient / (x + i + 1)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}
