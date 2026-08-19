/**
 * THE SURPLUS-DEALER AWARDEE CLASSIFIER. Wayne's #1 signal, made computable — and honest about
 * how thin the measured evidence for it actually is.
 *
 * ==========================================================================================
 * WHY THIS IS THE HIGHEST-VALUE UNBUILT THING IN THE PRODUCT.
 * ==========================================================================================
 * Wayne's declared #1 factor (MEETING 2.0, PROJECT, every "THROUGH MY EYES" walkthrough): **if
 * the last awardee was a SURPLUS-MATERIAL supplier, the probability of a surplus award is
 * significantly higher, and it is a purchase-for-stock candidate.** The award history already
 * carries a per-award `surplus` flag; it was read only in pricing, never in scoring, so the
 * ranked board measured a different thesis than Wayne's. This turns that flag into a per-awardee
 * verdict so the score can finally encode his #1.
 *
 * `lib/intelligence/distressed.ts` declared `ClassificationPort` and only `tmp/dealers.py` ever
 * implemented it. This is the real implementation, and it is deliberately more careful than the
 * python seed in three ways that each prevent a silent, expensive error:
 *
 *  1. THE SURPLUS FLAG IS THREE-STATE, NOT TRUTHY. `surplus_yes / surplus_no / surplus_unread`.
 *     A dealer verdict requires at least one `surplus_yes` — NEVER the mere absence of a `no`.
 *     tmp/dealers.py treated any filled cell as surplus; a literal "No" would then classify a
 *     MANUFACTURER as a surplus dealer, and Wayne's #1 signal would rank exactly the wrong rows
 *     to the top of the board he opens every morning. That is the expensive direction and it is
 *     silent, so the interpretation lives in one audited function (`readSurplus`).
 *
 *  2. THE MEASURED AND THE PRIOR ARE STRUCTURALLY SEPARATE AND NOT INTER-ASSIGNABLE. "This CAGE
 *     won on surplus material" is a government award record (`measured`). "This firm is a
 *     manufacturer" is the researcher's distressed-book label (`prior`). They are two distinct,
 *     nullable fields on the verdict; a consumer cannot pass one where the other belongs, so the
 *     discipline cannot die at the render layer.
 *
 *  3. EVERY VERDICT CARRIES ITS OWN COVERAGE. How many awards it rests on, and the fraction of
 *     that CAGE's award history whose Surplus cell was unread — so an abstention can say WHY,
 *     which is the only kind of abstention an operator does not learn to ignore.
 *
 * ★ THE HONEST HEADLINE, MEASURED not assumed: the export's Surplus column is very sparsely
 *   populated (measured live; see `measureSurplusFill` and the coverage the builder returns). A
 *   blank is therefore the ordinary case and "not flagged surplus" is almost never a fact. So
 *   the correct product is a ranked WATCHLIST with a published effective sample size, not a
 *   confident classification — and this module reports the numbers to say so out loud.
 *
 * ==========================================================================================
 * 4. PRESENCE AND STRENGTH ARE TWO DIFFERENT QUESTIONS. Added 2026-08-18.
 * ==========================================================================================
 * `class: 'surplus_dealer'` means "has delivered surplus at least once", and on the deployed
 * export that is 73 companies spanning P & R TRADING at 6 of 6 and ATLANTIC DIVING SUPPLY at 1
 * of 4,126 — with 33 of the 73 resting on a single award. One mark on all of them is not a
 * signal. So the verdict now carries `measured.surplusRatio` and a `band`, the counts stay
 * exposed so a caller can compute its own, and the cut points are declared a PRODUCT CHOICE in
 * `bandSurplus` rather than dressed up as a measurement. `class` is unchanged on purpose:
 * moving a company out of `surplus_dealer` on a chosen threshold would encode that choice as a
 * finding, in the one field every existing consumer already reads.
 *
 * Pure: no I/O, no clock, no network. Inputs injected (see ./live for the real-data assembler).
 */

import type { Cage } from '../../niin'
import type { EntityClassification, EntityClass } from '../../distressed'
import { readSurplus, bandSurplus, type SurplusState, type SurplusBand } from '../../awards/surplus'

/**
 * The reader and the bands now live in `lib/intelligence/awards/surplus.ts`, beside the award
 * index that produces the cell, and are re-exported here so every existing import keeps working.
 * One implementation, two entry points — the alternative was two implementations drifting apart,
 * which this repo has already paid for once with `competitor/rural-route.ts` holding a third.
 */
export { readSurplus, bandSurplus, SURPLUS_BAND_CUTS } from '../../awards/surplus'
export type { SurplusState, SurplusBand } from '../../awards/surplus'

export type AwardeeClass = 'surplus_dealer' | 'manufacturer' | 'distributor' | 'unknown'
export type EvidenceState = 'measured' | 'prior' | 'unknown'

/** The MEASURED half — government award records only. Never holds a researcher's opinion. */
export type MeasuredSurplus = {
  /** Awards whose Surplus cell read yes. A dealer verdict requires this to be >= 1. */
  surplusYes: number
  surplusNo: number
  surplusUnread: number
  totalAwards: number
  distinctNsns: number
  /** (yes + no) / total — the fraction of this CAGE's awards whose Surplus cell was actually read. */
  readFraction: number
  /**
   * surplusYes / totalAwards. THE FIGURE THAT SEPARATES A SURPLUS HOUSE FROM AN ACCIDENT.
   *
   * `class: 'surplus_dealer'` answers "has this company ever delivered surplus", and measured
   * over the deployed export that question puts P & R TRADING (6 of 6) and ATLANTIC DIVING
   * SUPPLY (1 of 4,126) in the same bucket. 33 of the 73 companies in that bucket rest on a
   * single award. So the count and the ratio travel on the verdict and a caller bands them.
   *
   * IT IS A FLOOR, NOT A SHARE OF BUSINESS. The denominator includes every award whose Surplus
   * cell was never filled in, which is 99.27% of the feed, so the true surplus share of a
   * company's deliveries is at least this and may be far more. It is never less.
   */
  surplusRatio: number
}

/** The PRIOR half — the distressed book's label. A separate type so it cannot pose as measured. */
export type PriorLabel = {
  bookClass: 'manufacturer' | 'distributor'
  holdsInventory: string
}

export type AwardeeVerdict = {
  cage: Cage
  companyName: string | null
  class: AwardeeClass
  evidenceState: EvidenceState
  /**
   * HOW MUCH of the company's record the surplus flag covers. Cut points are a product choice,
   * stated as such in `bandSurplus`, and are NOT derived from the data.
   *
   * `class` is deliberately unchanged and still means presence — "at least one flagged award,
   * ever". Reclassifying a thin company out of `surplus_dealer` would be hard-coding a chosen
   * threshold as if it were a finding, and would silently change what every existing consumer
   * of `class` receives. The band sits beside it so a caller can render a strong mark for
   * `predominant`, a hedged one for `single_award`, and abstain wherever it chooses to.
   *
   * `no_flagged_award` is not evidence of anything: with the column 0.73% populated, it is
   * almost always silence. Unread, not no.
   */
  band: SurplusBand
  basis: string
  /** Present only when there is award history for this CAGE. The government record. */
  measured: MeasuredSurplus | null
  /** Present only when the distressed book classified this CAGE. The researcher's read. */
  prior: PriorLabel | null
}

export type AwardInput = { cage: string | null; companyName: string | null; surplus: string | null; nsn: string | null }
export type BookInput = { cage: string | null; companyName: string | null; holdsInventory: string | null }

export type Coverage = {
  distinctAwardees: number
  surplusDealers: number
  manufacturers: number
  distributors: number
  unknown: number
  classifiedFraction: number
  /** The population-level Surplus fill rate: read cells / total award rows. The honesty number. */
  surplusFillRate: number
  awardRowsSeen: number
  awardRowsSurplusRead: number
  /**
   * How the awardees distribute across the bands. Publishable beside a badge so the operator can
   * see that `surplusDealers` is not one population: measured over the deployed export it is
   * 33 companies resting on a single award, 1 occasional, 11 frequent and 28 predominant.
   */
  bands: Record<SurplusBand, number>
}

export type AwardeeClassifier = {
  classify(cage: string | null | undefined): AwardeeVerdict | null
  coverage: Coverage
  asClassificationPort(): { classify(cage: Cage): EntityClassification | null }
}

/** Population Surplus fill rate over a set of award rows. Report it before drawing conclusions. */
export function measureSurplusFill(awards: readonly AwardInput[]): { total: number; read: number; rate: number } {
  let total = 0, read = 0
  for (const a of awards) {
    total += 1
    if (readSurplus(a.surplus) !== 'surplus_unread') read += 1
  }
  return { total, read, rate: total ? read / total : 0 }
}

function normCage(cage: string | null | undefined): Cage | null {
  if (typeof cage !== 'string') return null
  const c = cage.trim().toUpperCase()
  return c === '' ? null : (c as Cage)
}

function bookClass(holdsInventory: string | null): 'manufacturer' | 'distributor' | null {
  if (!holdsInventory) return null
  const v = holdsInventory.toLowerCase()
  const nonMfr = v.includes('non-manufactur') || v.includes('non manufactur')
  if (v.includes('manufactur') && !nonMfr) return 'manufacturer'
  if (v.includes('distribut') || v.includes('dealer') || nonMfr) return 'distributor'
  return null
}

type Agg = { name: string | null; total: number; yes: number; no: number; unread: number; nsns: Set<string> }

export function buildAwardeeClassifier(
  awards: readonly AwardInput[],
  book: readonly BookInput[] = [],
): AwardeeClassifier {
  const agg = new Map<Cage, Agg>()
  let rowsSeen = 0, rowsRead = 0
  for (const a of awards) {
    const cage = normCage(a.cage)
    if (!cage) continue
    rowsSeen += 1
    let e = agg.get(cage)
    if (!e) { e = { name: null, total: 0, yes: 0, no: 0, unread: 0, nsns: new Set() }; agg.set(cage, e) }
    e.total += 1
    if (a.companyName && !e.name) e.name = a.companyName.trim() || null
    const st = readSurplus(a.surplus)
    if (st === 'surplus_yes') { e.yes += 1; rowsRead += 1 }
    else if (st === 'surplus_no') { e.no += 1; rowsRead += 1 }
    else e.unread += 1
    if (a.nsn && a.nsn.trim()) e.nsns.add(a.nsn.trim())
  }

  const bookByCage = new Map<Cage, BookInput>()
  for (const b of book) {
    const cage = normCage(b.cage)
    if (cage && !bookByCage.has(cage)) bookByCage.set(cage, b)
  }

  const measuredOf = (e: Agg): MeasuredSurplus => ({
    surplusYes: e.yes, surplusNo: e.no, surplusUnread: e.unread, totalAwards: e.total,
    distinctNsns: e.nsns.size, readFraction: e.total ? (e.yes + e.no) / e.total : 0,
    // An Agg is only created when a row for that CAGE was seen, so `total` is at least 1 here
    // and the guard is structural belt-and-braces, never a fallback that could ship a 0.
    surplusRatio: e.total > 0 ? e.yes / e.total : 0,
  })

  const pct = (ratio: number): string => `${(ratio * 100).toFixed(ratio < 0.01 ? 2 : 1)}%`

  const verdict = (cage: Cage): AwardeeVerdict => {
    const e = agg.get(cage)
    const b = bookByCage.get(cage)
    const bc = bookClass(b?.holdsInventory ?? null)
    const measured = e ? measuredOf(e) : null
    const prior: PriorLabel | null = bc && b ? { bookClass: bc, holdsInventory: b.holdsInventory as string } : null
    const name = e?.name ?? b?.companyName ?? null
    // Banded from the measured counts, or `no_flagged_award` when there are no counts to band.
    // Note what that band does NOT say: not "this firm does not deal surplus", only "no award of
    // theirs in this export carries the flag", which for 1,607 of 1,680 companies is silence.
    const band = bandSurplus(measured?.surplusYes ?? 0, measured?.totalAwards ?? 0)

    // MEASURED surplus dealer requires an actual yes, never the absence of a no.
    if (measured && measured.surplusYes > 0) {
      // The ratio is IN the basis string, not only in the object, because the basis is what gets
      // rendered. "won 1 of 4,126" reads very differently from "won 1", and the difference is the
      // whole point of this change.
      return { cage, companyName: name, class: 'surplus_dealer', evidenceState: 'measured', band,
        basis: `won ${measured.surplusYes} of ${measured.totalAwards} recorded award${measured.totalAwards === 1 ? '' : 's'} on surplus material (${pct(measured.surplusRatio)})`,
        measured, prior }
    }
    if (prior) {
      return { cage, companyName: name, class: prior.bookClass, evidenceState: 'prior', band,
        basis: `distressed-book classification (a prior, not a government record): ${prior.holdsInventory}`,
        measured, prior }
    }
    return { cage, companyName: name, class: 'unknown', evidenceState: 'unknown', band,
      basis: measured
        ? `${measured.totalAwards} award${measured.totalAwards === 1 ? '' : 's'} on record, ${measured.surplusUnread} with an unread Surplus cell and none flagged surplus; no distressed-book label. Unread, not no.`
        : 'no award history and no distressed-book classification for this CAGE',
      measured, prior }
  }

  const cages = new Set<Cage>([...agg.keys(), ...bookByCage.keys()])
  let sd = 0, mf = 0, di = 0, uk = 0
  const bands: Record<SurplusBand, number> = {
    no_flagged_award: 0, single_award: 0, occasional: 0, frequent: 0, predominant: 0,
  }
  for (const c of cages) {
    const v = verdict(c)
    bands[v.band] += 1
    switch (v.class) {
      case 'surplus_dealer': sd++; break
      case 'manufacturer': mf++; break
      case 'distributor': di++; break
      default: uk++; break
    }
  }
  const coverage: Coverage = {
    distinctAwardees: agg.size, surplusDealers: sd, manufacturers: mf, distributors: di, unknown: uk,
    classifiedFraction: cages.size ? (sd + mf + di) / cages.size : 0,
    surplusFillRate: rowsSeen ? rowsRead / rowsSeen : 0, awardRowsSeen: rowsSeen, awardRowsSurplusRead: rowsRead,
    bands,
  }

  return {
    classify(cage) {
      const norm = normCage(cage)
      if (!norm) return null
      if (!agg.has(norm) && !bookByCage.has(norm)) return null
      return verdict(norm)
    },
    coverage,
    asClassificationPort() {
      return {
        classify(cage: Cage): EntityClassification | null {
          const norm = normCage(cage)
          if (!norm) return null
          if (!agg.has(norm) && !bookByCage.has(norm)) return null
          const vv = verdict(norm)
          const entityClass: EntityClass =
            vv.class === 'manufacturer' ? 'manufacturer' : vv.class === 'unknown' ? 'unknown' : 'dealer'
          return { cage: norm, entityClass, basis: vv.basis, observedAt: '' }
        },
      }
    },
  }
}
