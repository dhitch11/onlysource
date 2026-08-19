/**
 * THE SURPLUS FLAG: ONE INTERPRETATION, ONE ROLLUP, ONE SET OF CUT POINTS.
 *
 * The government sometimes buys a part from surplus material rather than from new production,
 * and when it does, the NSN-Now Procurement sheet records it in a column called `Surplus`. That
 * one cell is the closest thing this feed has to a direct statement that a used or overstock
 * article was ACCEPTED for a stock number — which is the difference between a dealer who can
 * quote from a warehouse and one who has to go buy new.
 *
 * This module exists because that cell was being interpreted in three places with three
 * different rules. `classify/index.ts` had the careful three-state reader; `competitor/
 * rural-route.ts` has its own `/^y|^true|^surplus/i` test; the award index stored the raw string
 * and rolled nothing up at all. Three readers of one cell is how two surfaces come to disagree
 * about the same company, so the reader, the per-item rollup and the banding live here and the
 * award index and the classifier both import them.
 *
 * ★ ONE READER IS STILL OUTSTANDING, STATED RATHER THAN QUIETLY LEFT: `competitor/rural-route.ts`
 *   lines 768-769 keep their own regex over their own workbook rows. Measured, the two agree on
 *   every row of the deployed export, because the column only ever holds 'Yes' or nothing — but
 *   they disagree in principle on an unrecognised value, which rural-route counts as neither
 *   flagged NOR unread and therefore drops. That surface belongs to another lane and its counts
 *   are rendered, so it is reported here and not changed from this one.
 *
 * =====================================================================================
 * WHAT THE COLUMN ACTUALLY CONTAINS. MEASURED 2026-08-18 OVER THE DEPLOYED EXPORT.
 * =====================================================================================
 *   42,698  deduped award rows
 *      311  rows with anything at all in the Surplus cell           0.73%
 *        1  distinct value ever observed, and it is the string "Yes"
 *        0  rows saying "No", in any spelling, ever
 *      186  of 2,514 NSNs carry at least one flagged award
 *      158  of those 186 are MIXED: same stock number, some awards flagged, some blank
 *       73  of 1,680 awardee CAGEs won at least one flagged award
 *       73  NSNs whose most recent award is flagged
 *
 * TWO CONSEQUENCES, AND THEY ARE THE WHOLE DESIGN OF THIS FILE.
 *
 * ONE: THE FLAG IS POSITIVE-ONLY. A blank means the export said nothing, not that the article
 * was new. With no "No" anywhere in 42,698 rows, "not flagged" carries no information at all,
 * and folding a blank into `false` would manufacture 42,387 negative findings out of silence.
 * So absence is a first-class state (`surplus_unread`) at every level: the cell, the award, the
 * stock number, the company. `DedicatedPullView.tsx` already words this correctly for the
 * operator and this module keeps the same words: UNREAD, NOT NO.
 *
 * TWO: IT IS AN ATTRIBUTE OF A DELIVERY, NOT OF AN ITEM OR OF A FIRM. 158 of the 186 flagged
 * stock numbers are mixed, so "this NSN is a surplus item" is not a thing the data supports.
 * What it supports is "on this award, this company delivered surplus and the government took
 * it". Every field below is therefore counted per award and reported with its denominator.
 *
 * Pure: no I/O, no clock, no network.
 */

/**
 * The three states of the free-text Surplus cell. `unread` is a first-class value, not a gap.
 *
 * Moved here from `suppliers/classify/index.ts` (which re-exports it, so existing imports are
 * unchanged) so that the award index and the classifier cannot drift apart on what the cell means.
 */
export type SurplusState = 'surplus_yes' | 'surplus_no' | 'surplus_unread'

/**
 * THE ONE PLACE the free-text Surplus cell is interpreted. Three-state, conservative.
 * A yes-shaped token is surplus; an explicit no is not; everything else (blank, unrecognised)
 * is UNREAD, never silently a no.
 *
 * The `surplus_no` branch has never fired on real data — the export has never written a "No".
 * It stays because the alternative is worse in exactly the expensive direction: if a future
 * export starts writing "No", a two-state reader would read that literal denial as a positive
 * surplus flag (any filled cell being truthy) and would badge MANUFACTURERS as surplus dealers.
 * That is the error `tmp/dealers.py` made. A branch that is currently unreached is not dead
 * code here, it is the guard, and the test suite covers it directly.
 */
export function readSurplus(surplus: string | null | undefined): SurplusState {
  if (surplus == null) return 'surplus_unread'
  const v = surplus.trim().toLowerCase()
  if (v === '') return 'surplus_unread'
  if (/^(no|n|false|0|none|n\/a|na)$/.test(v)) return 'surplus_no'
  if (/\b(y|yes|surplus|x)\b/.test(v) || v.includes('surplus')) return 'surplus_yes'
  return 'surplus_unread'
}

/** The only three fields of an award row this module reads. Structural, so `AwardRecord` fits. */
export type SurplusAward = {
  surplus: string | null
  cage: string | null
  awardDateIso: string | null
}

/**
 * The surplus history of ONE stock number, counted from its award rows.
 *
 * Nothing here is a verdict about the item. `flaggedAwards` is a count of deliveries the
 * government accepted as surplus, and it always travels with `totalAwards` and `readFraction`
 * so a surface can publish the sample size next to whatever it renders.
 */
export type SurplusRollup = {
  /** Awards whose Surplus cell reads yes. The badge's numerator. */
  flaggedAwards: number
  /** Awards whose Surplus cell explicitly says no. Zero throughout the deployed export. */
  explicitNoAwards: number
  /** Awards whose Surplus cell was blank or unrecognised. Unread, NOT "not surplus". */
  unreadAwards: number
  /** Every award on this stock number. The badge's denominator. */
  totalAwards: number
  /** flagged + explicitNo — the awards where the cell said anything at all. */
  readAwards: number
  /**
   * readAwards / totalAwards, or NULL when there are no awards to read.
   *
   * Null rather than zero on purpose: a stock number with no award history has an UNKNOWN read
   * fraction, and a zero there would read as "we looked at its awards and none were filled in".
   */
  readFraction: number | null
  /**
   * The state of the MOST RECENT award, or null when no award carries a date to order by.
   *
   * Recency is the part an operator acts on: a stock number the government last bought as
   * surplus is one where a surplus offer has just been accepted, whatever happened in 2016.
   *
   * TIE RULE, and it is load-bearing: 68 stock numbers have more than one award sharing their
   * newest date. Where any award on that date is flagged, this reads `surplus_yes`, because the
   * claim being made is "the government accepted surplus on the most recent buying date" and
   * one flagged award on that date makes it true. As measured, the tie rule changes nothing
   * today — every one of the 73 has ALL of its newest-date awards flagged, not merely one — but
   * a rule that only happens to be right is written down before it stops being right.
   */
  latestAwardState: SurplusState | null
  /**
   * The awardee CAGEs whose award on this stock number carried the flag, sorted, deduplicated.
   *
   * This is the join the badge needs: the flag belongs to a delivery, so naming the item without
   * naming who delivered it would attach a company's history to a competitor's quote.
   */
  flaggedCages: string[]
}

/** Roll up one stock number's awards. An empty list is a valid input and yields an honest zero. */
export function rollUpSurplus(awards: readonly SurplusAward[]): SurplusRollup {
  let flaggedAwards = 0
  let explicitNoAwards = 0
  let unreadAwards = 0
  const flagged = new Set<string>()

  // The newest award date present, found before the flags are read so the two passes cannot
  // disagree about which award is "latest".
  let newestIso: string | null = null
  for (const a of awards) {
    if (a.awardDateIso === null || a.awardDateIso === '') continue
    if (newestIso === null || a.awardDateIso > newestIso) newestIso = a.awardDateIso
  }

  let latestAwardState: SurplusState | null = null
  for (const a of awards) {
    const state = readSurplus(a.surplus)
    if (state === 'surplus_yes') {
      flaggedAwards += 1
      const cage = (a.cage ?? '').trim().toUpperCase()
      if (cage !== '') flagged.add(cage)
    } else if (state === 'surplus_no') {
      explicitNoAwards += 1
    } else {
      unreadAwards += 1
    }

    // The tie rule, applied in one place: yes wins over no, and no wins over unread, among the
    // awards sharing the newest date.
    if (newestIso !== null && a.awardDateIso === newestIso) {
      if (state === 'surplus_yes') latestAwardState = 'surplus_yes'
      else if (state === 'surplus_no' && latestAwardState !== 'surplus_yes') latestAwardState = 'surplus_no'
      else if (latestAwardState === null) latestAwardState = 'surplus_unread'
    }
  }

  const totalAwards = awards.length
  const readAwards = flaggedAwards + explicitNoAwards
  return {
    flaggedAwards,
    explicitNoAwards,
    unreadAwards,
    totalAwards,
    readAwards,
    readFraction: totalAwards > 0 ? readAwards / totalAwards : null,
    latestAwardState,
    flaggedCages: [...flagged].sort(),
  }
}

/**
 * THE POPULATION FIGURE, so any badge can publish its own sample size.
 *
 * A red badge on 311 rows out of 42,698 is a very different claim from a red badge on 311 out of
 * 400, and the operator cannot tell which they are looking at from the badge. So the index
 * carries this census and every surface that renders a flag can render "311 of 42,698 award
 * rows, 0.73%" beside it without recomputing anything.
 */
export type SurplusCensus = {
  /** Award rows considered. The denominator of the honesty number. */
  totalRows: number
  /** Award rows whose Surplus cell reads yes. 311 on the deployed export. */
  flaggedRows: number
  /** Award rows whose Surplus cell explicitly says no. 0 on the deployed export. */
  explicitNoRows: number
  /** flaggedRows + explicitNoRows. */
  readRows: number
  /** readRows / totalRows, or null when there are no rows at all. 0.0073 as measured. */
  readFraction: number | null
  /** Stock numbers with at least one award row. 2,514 as measured. */
  nsnsWithAwards: number
  /** Stock numbers with at least one flagged award. 186 as measured. */
  nsnsFlagged: number
  /** Stock numbers whose MOST RECENT award is flagged. 73 as measured. */
  nsnsLatestFlagged: number
  /** Stock numbers where some awards are flagged and some are not. 158 as measured — the proof
   *  that this is an attribute of a delivery and not of an item. */
  nsnsMixed: number
  /** Distinct awardee CAGEs across every award row. 1,680 as measured. */
  distinctAwardeeCages: number
  /** Distinct awardee CAGEs with at least one flagged award. 73 as measured. */
  flaggedAwardeeCages: number
  /**
   * Every distinct non-empty raw value the column carried, so the claim "it only ever says Yes"
   * is a measurement the consumer can re-read rather than a promise this file makes.
   */
  observedValues: string[]
  /** True when `observedValues` was capped. A flag column with 25 spellings is itself a finding. */
  observedValuesTruncated: boolean
}

/** Distinct raw values retained before the census stops collecting them. */
const OBSERVED_VALUE_CAP = 25

/**
 * Build the census FROM THE PER-NSN ROLLUPS, never from a second walk of the rows.
 *
 * Deliberate: if the population figure were counted independently it could disagree with the
 * sum of the parts, and the surface would then be able to show a badge on a stock number that
 * the census says does not exist. Derived from the same objects, they cannot diverge. The
 * independent re-derivation lives in the test, which is where a second instrument belongs.
 */
export function summariseSurplusCensus(
  rollups: readonly SurplusRollup[],
  observed: { distinctAwardeeCages: number; observedValues: readonly string[] },
): SurplusCensus {
  let totalRows = 0
  let flaggedRows = 0
  let explicitNoRows = 0
  let nsnsWithAwards = 0
  let nsnsFlagged = 0
  let nsnsLatestFlagged = 0
  let nsnsMixed = 0
  const flaggedCages = new Set<string>()

  for (const r of rollups) {
    totalRows += r.totalAwards
    flaggedRows += r.flaggedAwards
    explicitNoRows += r.explicitNoAwards
    if (r.totalAwards > 0) nsnsWithAwards += 1
    if (r.flaggedAwards > 0) nsnsFlagged += 1
    if (r.flaggedAwards > 0 && r.flaggedAwards < r.totalAwards) nsnsMixed += 1
    if (r.latestAwardState === 'surplus_yes') nsnsLatestFlagged += 1
    for (const c of r.flaggedCages) flaggedCages.add(c)
  }

  const values = [...new Set(observed.observedValues)].sort()
  return {
    totalRows,
    flaggedRows,
    explicitNoRows,
    readRows: flaggedRows + explicitNoRows,
    readFraction: totalRows > 0 ? (flaggedRows + explicitNoRows) / totalRows : null,
    nsnsWithAwards,
    nsnsFlagged,
    nsnsLatestFlagged,
    nsnsMixed,
    distinctAwardeeCages: observed.distinctAwardeeCages,
    flaggedAwardeeCages: flaggedCages.size,
    observedValues: values.slice(0, OBSERVED_VALUE_CAP),
    observedValuesTruncated: values.length > OBSERVED_VALUE_CAP,
  }
}

/**
 * HOW MUCH OF A COMPANY'S RECORD THE FLAG COVERS. A PRODUCT CHOICE, NOT A MEASUREMENT.
 *
 * =====================================================================================
 * THE DEFECT THIS EXISTS TO FIX
 * =====================================================================================
 * The rule in front of the badge was, in effect, `flaggedAwards > 0`. Measured against the
 * deployed export, that rule renders the same mark on:
 *
 *     P & R TRADING INCORPORATED          6 / 6      100.00%
 *     SIKORSKY AIRCRAFT CORPORATION       5 / 5,933    0.08%
 *     ATLANTIC DIVING SUPPLY, INC.        1 / 4,126    0.02%
 *     CUMMINS INC                         1 / 335      0.30%
 *     RAYTHEON COMPANY                    1 / 13       7.69%
 *
 * and 33 of the 73 flagged companies rest on a SINGLE award. A badge that cannot separate a
 * six-for-six surplus house from one accepted surplus delivery in four thousand is not
 * information, and an operator who is burned once by the second kind stops reading the first.
 *
 * =====================================================================================
 * THE CUT POINTS ARE CHOSEN, AND ARE NOT CLAIMED TO BE ANYTHING ELSE
 * =====================================================================================
 * There is NO measurement in this feed that says 10% is where occasional becomes frequent. The
 * feed measures counts; where a product draws a line across those counts is an editorial
 * decision, and pretending otherwise would be the same category error as reading a blank cell
 * as a no. What IS measured is the shape of the distribution the bands have to separate: 1
 * company at 0.08%, 33 resting on one award, 28 at or above half their record. So:
 *
 *     no_flagged_award   0 flagged. Says nothing about whether they deal surplus (see below).
 *     single_award       exactly 1 flagged award, at ANY ratio. n=1 is an anecdote even at 1/1.
 *     occasional         ratio below 10%
 *     frequent           ratio below 50%
 *     predominant        ratio at or above 50%
 *
 * As measured over the 1,680 awardee CAGEs: 1,607 no_flagged_award, 33 single_award,
 * 1 occasional, 11 frequent, 28 predominant.
 *
 * `single_award` deliberately outranks the ratio, which is why Raytheon at 1/13 (7.69%) lands
 * there rather than in `occasional` and why a 1/1 company does not reach `predominant`. One
 * award is one award.
 *
 * =====================================================================================
 * WHAT NO BAND MEANS
 * =====================================================================================
 * `no_flagged_award` is NOT "does not deal in surplus". With the column 0.73% populated, the
 * overwhelming majority of firms in this band have simply never had the cell filled in. The
 * band names what the record shows, and the record is mostly silent. Callers rendering the
 * absence must say so — unread, not no — and the rollup's `readFraction` is there to let them.
 */
export type SurplusBand = 'no_flagged_award' | 'single_award' | 'occasional' | 'frequent' | 'predominant'

/** The chosen cut points, exported so a caller can render them rather than restate them. */
export const SURPLUS_BAND_CUTS = {
  /** Below this share of the company's awards, the flag is `occasional`. A product choice. */
  occasionalBelow: 0.1,
  /** Below this share, `frequent`; at or above it, `predominant`. A product choice. */
  frequentBelow: 0.5,
} as const

/**
 * Band a flagged count against its denominator.
 *
 * The denominator is EVERY award, including the ones whose Surplus cell was never read, so the
 * ratio is a FLOOR on how much of a company's delivered business was surplus and never a
 * ceiling. Restricting the denominator to read awards was considered and rejected: since the
 * export never writes "No", that ratio is 1.0 for all 73 flagged companies and separates nothing.
 */
export function bandSurplus(flaggedAwards: number, totalAwards: number): SurplusBand {
  if (flaggedAwards <= 0) return 'no_flagged_award'
  if (flaggedAwards === 1) return 'single_award'
  if (totalAwards <= 0) return 'single_award'
  const ratio = flaggedAwards / totalAwards
  if (ratio < SURPLUS_BAND_CUTS.occasionalBelow) return 'occasional'
  if (ratio < SURPLUS_BAND_CUTS.frequentBelow) return 'frequent'
  return 'predominant'
}
