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
 * Pure: no I/O, no clock, no network. Inputs injected (see ./live for the real-data assembler).
 */

import type { Cage } from '../../niin'
import type { EntityClassification, EntityClass } from '../../distressed'

/** The three states of the free-text Surplus cell. `unread` is a first-class value, not a gap. */
export type SurplusState = 'surplus_yes' | 'surplus_no' | 'surplus_unread'

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
}

export type AwardeeClassifier = {
  classify(cage: string | null | undefined): AwardeeVerdict | null
  coverage: Coverage
  asClassificationPort(): { classify(cage: Cage): EntityClassification | null }
}

/**
 * THE ONE PLACE the free-text Surplus cell is interpreted. Three-state, conservative.
 * A yes-shaped token is surplus; an explicit no is not; everything else (blank, unrecognised)
 * is UNREAD, never silently a no.
 */
export function readSurplus(surplus: string | null | undefined): SurplusState {
  if (surplus == null) return 'surplus_unread'
  const v = surplus.trim().toLowerCase()
  if (v === '') return 'surplus_unread'
  if (/^(no|n|false|0|none|n\/a|na)$/.test(v)) return 'surplus_no'
  if (/\b(y|yes|surplus|x)\b/.test(v) || v.includes('surplus')) return 'surplus_yes'
  return 'surplus_unread'
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
  })

  const verdict = (cage: Cage): AwardeeVerdict => {
    const e = agg.get(cage)
    const b = bookByCage.get(cage)
    const bc = bookClass(b?.holdsInventory ?? null)
    const measured = e ? measuredOf(e) : null
    const prior: PriorLabel | null = bc && b ? { bookClass: bc, holdsInventory: b.holdsInventory as string } : null
    const name = e?.name ?? b?.companyName ?? null

    // MEASURED surplus dealer requires an actual yes, never the absence of a no.
    if (measured && measured.surplusYes > 0) {
      return { cage, companyName: name, class: 'surplus_dealer', evidenceState: 'measured',
        basis: `won ${measured.surplusYes} of ${measured.totalAwards} recorded award${measured.totalAwards === 1 ? '' : 's'} on surplus material`,
        measured, prior }
    }
    if (prior) {
      return { cage, companyName: name, class: prior.bookClass, evidenceState: 'prior',
        basis: `distressed-book classification (a prior, not a government record): ${prior.holdsInventory}`,
        measured, prior }
    }
    return { cage, companyName: name, class: 'unknown', evidenceState: 'unknown',
      basis: measured
        ? `${measured.totalAwards} award${measured.totalAwards === 1 ? '' : 's'} on record, ${measured.surplusUnread} with an unread Surplus cell and none flagged surplus; no distressed-book label`
        : 'no award history and no distressed-book classification for this CAGE',
      measured, prior }
  }

  const cages = new Set<Cage>([...agg.keys(), ...bookByCage.keys()])
  let sd = 0, mf = 0, di = 0, uk = 0
  for (const c of cages) {
    switch (verdict(c).class) {
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
