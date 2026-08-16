import { readDealerEligibility } from '../codebook'
import { measured, unavailable, type Leg } from './evidence-state'
import type { FeedWindow, NsnAwardSummary } from '../awards/nsn-now'

/**
 * THE QUOTE CHECKLIST, COMPUTED.
 *
 * ==========================================================================================
 * WHERE THIS COMES FROM, AND WHY IT IS NOT AN INVENTED SCORE.
 * ==========================================================================================
 * The operator who taught this business wrote his own decision process down while deciding
 * whether to quote a real requirement (`Notes on 4730-00-536-2210 1-8-26.docx`, forwarded
 * 2026-08-13). It is a list of indicators, in his words, each with the reason it matters:
 *
 *   "There was little or no competitive bids (You want to quote on something with less
 *    competition. That indicates that inventories are low)"
 *   "There were large gaps in demand. It may indicate that there are maintenance
 *    opportunities ahead."
 *   "Lead time is an important indicator. The quicker they want it, the more urgently they
 *    need it and they're willing to pay for it."
 *   "They are depending on distributors to carry these items instead of them carrying it on
 *    their depot shelves."
 *
 * Every one of those was already in the data. The Batch Export carries `Offers` on all 59,990
 * procurement rows, `Delivery Days` on 58,401, `AMC`/`AMSC` on 73,714, `LTC Expiration` on
 * 56,637. None of them reached the scoring pipeline until 2026-08-16. This module reads them.
 *
 * ==========================================================================================
 * WHAT THIS MODULE WILL NOT DO.
 * ==========================================================================================
 * It does not roll the signals into a single number. The operator's own note does not either:
 * he lists indicators and then reasons about them together, and the one place he states a
 * conclusion he states it as a conditional ("if you can buy the parts at a great price you can
 * sell them at substantial margin"). A composite here would invent a weighting nobody has
 * measured, and CornerScore already owns the ranked number.
 *
 * Every signal carries its EVIDENCE STATE. A signal the rows cannot answer is UNAVAILABLE and
 * renders as such; it is never a zero, never a neutral default, and never quietly dropped.
 *
 * ==========================================================================================
 * THE CENSORING PROBLEM, STATED WHEREVER IT APPLIES.
 * ==========================================================================================
 * The award feed spans about eleven years. So "the longest gap in demand was 9.3 years" is not
 * a fact about the item, it is a fact about the item AND the window. No gap longer than the
 * window can be observed however dormant the part really was. Any signal bounded by the window
 * carries a `limitation` sentence saying so, and the interface renders it.
 */

export type QuoteSignalId =
  | 'competition'
  | 'dealer_eligibility'
  | 'approved_sources'
  | 'demand_gap'
  | 'urgency'
  | 'ltc_expiry'
  | 'first_article'
  | 'set_aside'
  | 'stock_listed'

/** Does this signal point toward quoting, away from it, or neither? Never a score. */
export type SignalDirection = 'favourable' | 'unfavourable' | 'neutral'

export type QuoteSignal = {
  id: QuoteSignalId
  /** Operator-facing name, in the words a trader uses. */
  label: string
  leg: Leg<number | string>
  /** One plain sentence: what this reading means for the decision to quote. */
  reading: string
  direction: SignalDirection
  /** What bounds or qualifies this reading, when something does. Rendered, never hidden. */
  limitation: string | null
}

const NO_AWARDS = 'No award rows for this stock number in the export, so this cannot be read.'

/**
 * Read every checklist signal for one stock number.
 *
 * `window` is required rather than optional on purpose: a dormancy reading without the window
 * it was measured in is the kind of number that looks like a fact and is not one.
 */
export function readQuoteSignals(summary: NsnAwardSummary, window: FeedWindow): QuoteSignal[] {
  const signals: QuoteSignal[] = []
  const hasAwards = summary.awards.length > 0
  const windowNote =
    window.firstAwardIso && window.lastAwardIso
      ? `Measured across the award feed, which runs ${window.firstAwardIso.slice(0, 4)} to ${window.lastAwardIso.slice(0, 4)}. A longer gap than the feed itself cannot appear here.`
      : 'The span of the award feed is unknown, so this reading is not bounded.'

  /* ---------------------------------------------------------------------------------- */
  /* COMPETITION. WITHHELD. The sharpest signal in the export, and the one it gets wrong. */
  /* ---------------------------------------------------------------------------------- */
  /*
   * This is the operator's FIRST indicator and it is the one thing here we cannot honestly
   * show. Rendering it read "9114 bidders on the last award", which prompted the count: the
   * export's `Offers` column carries a value outside any plausible bid count on 15,013 of
   * 59,990 rows, exactly 25.0%, and the stray values are the same family of numbers that
   * contaminate `LTC Expiration`. That is a column shift inside the source file, confirmed by
   * reading the raw sheet XML cell by cell and getting the same wrong value from the same cell.
   *
   * A bid count that is a stray one time in four is not a signal, it is a coin flip wearing a
   * number. So it is WITHHELD rather than shown, and the reason is rendered where the reading
   * would have been. An operator who can see that we know the column is broken can weigh it.
   * An operator shown "2 bidders" cannot.
   */
  signals.push({
    id: 'competition',
    label: 'Bids on the last award',
    leg: unavailable(
      hasAwards
        ? 'the export column that would carry this is contaminated on 25.0% of rows (15,013 of 59,990 measured), so no bid count from it can be trusted'
        : NO_AWARDS,
    ),
    reading:
      hasAwards && summary.latestOffers != null
        ? `Withheld. The export records a value here, but the column carrying it is wrong on a quarter of all rows, so this build will not put a bid count in front of a bid decision. Confirming it needs a clean export or a second source.`
        : 'The number of bids on the last award cannot be read from this export.',
    direction: 'neutral',
    limitation:
      'Measured 2026-08-16 across every procurement row in the export. The field is parsed and range checked, so this becomes a live signal the moment a clean export or an independent source confirms it.',
  })

  /* ---------------------------------------------------------------------------------- */
  /* DEALER ELIGIBILITY. Decoded by the codebook, which owns the meaning of these codes.  */
  /* ---------------------------------------------------------------------------------- */
  const eligibility = readDealerEligibility(summary.amc, summary.amsc)
  if (eligibility.unknown) {
    signals.push({
      id: 'dealer_eligibility',
      label: 'Who may supply it',
      leg: unavailable(eligibility.basis),
      reading: 'The acquisition codes are missing or unrecognised, so who may supply this is not determined.',
      direction: 'neutral',
      limitation: null,
    })
  } else {
    /*
     * TWO DIFFERENT KINDS OF GOOD NEWS, AND THEY MUST NOT READ THE SAME.
     *
     * A competitive method (1 or 2) says dealers and distributors are named among potential
     * sources, so a quote can be made on the open buy. A restrictive method with a closed
     * suffix says the opposite about MANUFACTURING and, for a surplus trader, is the better
     * news: nobody new can make it, so the approved article is the only article, and whoever
     * holds it holds the buy. That is the corner this whole product looks for.
     *
     * The earlier version rendered the codebook's raw basis line, which said "method 3 directs
     * acquisition to the manufacturer or prime" while the row was labelled favourable. Both
     * halves were true and together they read like a contradiction.
     */
    const competitive = summary.amc === '1' || summary.amc === '2'
    signals.push({
      id: 'dealer_eligibility',
      label: 'Who may supply it',
      leg: measured(
        `${summary.amc}/${summary.amsc}`,
        0.85,
        `acquisition method ${summary.amc} with suffix ${summary.amsc}`,
      ),
      reading: competitive
        ? `Open buy. Method ${summary.amc} names dealers and distributors among potential sources, so a quote stands on its own. ${eligibility.basis.split('; ')[1] ?? ''}`.trim()
        : eligibility.surplusSupplyOpen
          ? `Closed to new manufacture, open to the approved article. Method ${summary.amc} directs the buy to the manufacturer or prime, and suffix ${summary.amsc} means no new source can be qualified to make it. That is what makes surplus of the approved article the only way in, and why holding it is worth something.`
          : `Restricted. Method ${summary.amc} with suffix ${summary.amsc} closes this to anyone outside the named source.`,
      direction: eligibility.surplusSupplyOpen ? 'favourable' : 'unfavourable',
      limitation:
        'A restricted suffix bars a new source from MANUFACTURING the item. It does not by itself bar supplying surplus of the originally approved article; that gate is traceability, and this build does not answer it.',
    })
  }

  /* ---------------------------------------------------------------------------------- */
  /* APPROVED SOURCES. The first half of the corner thesis, straight from the MCRL sheet. */
  /* ---------------------------------------------------------------------------------- */
  const sourceCount = summary.approvedSources.length
  if (sourceCount > 0) {
    signals.push({
      id: 'approved_sources',
      label: 'Approved sources',
      leg: measured(sourceCount, sourceCount === 1 ? 0.9 : 0.6, `${sourceCount} approved source row${sourceCount === 1 ? '' : 's'} in the cross reference list`),
      reading:
        sourceCount === 1
          ? 'One approved source. Everything the government buys for this stock number has to come through that one company or its surplus.'
          : `${sourceCount} approved sources are listed for this stock number.`,
      direction: sourceCount === 1 ? 'favourable' : 'neutral',
      limitation:
        'An approved source is permission to make the item. It is not a statement that the company still makes it, or that anything is on a shelf.',
    })
  } else {
    signals.push({
      id: 'approved_sources',
      label: 'Approved sources',
      leg: unavailable('the cross reference list carries no approved source row for this stock number'),
      reading: 'No approved source is listed in the export, so the source position cannot be read.',
      direction: 'neutral',
      limitation: null,
    })
  }

  /* ---------------------------------------------------------------------------------- */
  /* DEMAND GAP. Dormancy then a fresh buy is the maintenance-cycle signal.               */
  /* ---------------------------------------------------------------------------------- */
  if (summary.longestDemandGapYears != null) {
    const g = summary.longestDemandGapYears
    signals.push({
      id: 'demand_gap',
      label: 'Longest quiet stretch',
      leg: measured(g, g >= 4 ? 0.7 : 0.4, `${g} years between two consecutive awards`),
      reading:
        g >= 4
          ? `The government went ${g} years without buying this, then bought it again. Long quiet stretches are where maintenance cycles surface and where incumbents have moved on.`
          : `The longest gap between awards is ${g} years. Demand has been steady rather than episodic.`,
      direction: g >= 4 ? 'favourable' : 'neutral',
      limitation: windowNote,
    })
  } else {
    signals.push({
      id: 'demand_gap',
      label: 'Longest quiet stretch',
      leg: unavailable(
        hasAwards ? 'fewer than two dated awards, so no gap between awards exists to measure' : NO_AWARDS,
      ),
      reading: 'There are not two dated awards to measure a gap between.',
      direction: 'neutral',
      limitation: null,
    })
  }

  /* ---------------------------------------------------------------------------------- */
  /* URGENCY. "The quicker they want it, the more urgently they need it."                 */
  /* ---------------------------------------------------------------------------------- */
  if (summary.latestDeliveryDays != null && summary.latestDeliveryDays > 0) {
    const d = summary.latestDeliveryDays
    signals.push({
      id: 'urgency',
      label: 'Delivery window on the last award',
      leg: measured(d, d <= 30 ? 0.7 : 0.4, `${d} days allowed for delivery`),
      reading:
        d <= 30
          ? `The government allowed ${d} days. A short window means they need it, and need tends to pay.`
          : `The government allowed ${d} days. There is no time pressure in this one.`,
      direction: d <= 30 ? 'favourable' : 'neutral',
      limitation: 'Delivery days are as awarded. A future solicitation may allow a different window.',
    })
  } else {
    signals.push({
      id: 'urgency',
      label: 'Delivery window on the last award',
      leg: unavailable(hasAwards ? 'the most recent award row carries no delivery window' : NO_AWARDS),
      reading: 'No delivery window is recorded, so urgency cannot be read.',
      direction: 'neutral',
      limitation: null,
    })
  }

  /* ---------------------------------------------------------------------------------- */
  /* LONG TERM CONTRACT EXPIRY. A corner opens the day an LTC lapses.                     */
  /* ---------------------------------------------------------------------------------- */
  /*
   * WITHHELD for the same measured reason as the bid count. `LTC Expiration` fails to parse as a
   * date on 19,947 of 56,637 populated rows, 35.2%, and the stray values are the same numbers that
   * contaminate `Offers`. A date that is wrong a third of the time would send an operator to
   * position for a contract lapse that is not happening.
   */
  signals.push({
    id: 'ltc_expiry',
    label: 'Long term contract',
    leg: unavailable(
      hasAwards
        ? 'the export column that would carry this is contaminated on 35.2% of populated rows (19,947 of 56,637 measured), so no expiry date from it can be trusted'
        : NO_AWARDS,
    ),
    reading: summary.ltcExpirationIso
      ? 'Withheld. A date is present but the column carrying it is wrong on a third of its rows, and positioning for a contract lapse that is not happening costs real money.'
      : 'No long term contract expiry can be read from this export.',
    direction: 'neutral',
    limitation:
      'Measured 2026-08-16. Values that do not parse as a date are already discarded at parse time; the problem is that a stray can also LOOK like a date.',
  })

  /* ---------------------------------------------------------------------------------- */
  /* BARRIERS. First Article and set-asides both decide whether a quote is even possible. */
  /* ---------------------------------------------------------------------------------- */
  const fat = summary.awards.find((a) => a.firstArticle)?.firstArticle ?? null
  signals.push(
    fat
      ? {
          id: 'first_article',
          label: 'First article test',
          leg: measured(fat, 0.7, `an award row records a first article requirement of "${fat}"`),
          reading: `A first article test has been required on this stock number ("${fat}"). That is real cost and real delay before a first delivery.`,
          direction: 'unfavourable',
          limitation: 'Recorded on a past award. A future solicitation may waive it, and a prior approval may carry.',
        }
      : {
          id: 'first_article',
          label: 'First article test',
          leg: unavailable(hasAwards ? 'no award row records a first article requirement' : NO_AWARDS),
          reading: 'No first article requirement is recorded on any past award.',
          direction: 'neutral',
          limitation: null,
        },
  )

  const setAside = summary.awards.find((a) => a.setAside)?.setAside ?? null
  signals.push(
    setAside
      ? {
          id: 'set_aside',
          label: 'Set aside',
          leg: measured(setAside, 0.7, `an award row records a set aside of "${setAside}"`),
          reading: `This stock number has been bought under a set aside ("${setAside}"). Eligibility for that programme decides whether a quote counts.`,
          direction: 'neutral',
          limitation: 'A set aside on a past award does not bind the next solicitation.',
        }
      : {
          id: 'set_aside',
          label: 'Set aside',
          leg: unavailable(hasAwards ? 'no award row records a set aside' : NO_AWARDS),
          reading: 'No past award records a set aside, so past buys were unrestricted.',
          direction: 'neutral',
          limitation: null,
        },
  )

  /* ---------------------------------------------------------------------------------- */
  /* STOCK. "Very few available on NSN now" is the cue to buy up what exists.             */
  /* ---------------------------------------------------------------------------------- */
  const holderCount = summary.holders.length
  const holderUnits = summary.holders.reduce((t, h) => t + (h.quantity ?? 0), 0)
  signals.push(
    holderCount > 0
      ? {
          id: 'stock_listed',
          label: 'Stock listed',
          leg: measured(holderCount, 0.5, `${holderCount} company record${holderCount === 1 ? '' : 's'} listing stock`),
          reading:
            holderCount <= 2
              ? `Only ${holderCount} company record${holderCount === 1 ? '' : 's'} list${holderCount === 1 ? 's' : ''} stock, ${holderUnits.toLocaleString()} unit${holderUnits === 1 ? '' : 's'} in total. Thin availability is the position worth controlling.`
              : `${holderCount} company records list stock, ${holderUnits.toLocaleString()} units in total.`,
          direction: holderCount <= 2 ? 'favourable' : 'neutral',
          limitation:
            'Availability is what a company listed, not what is confirmed on a shelf. Nothing here is a confirmed unit.',
        }
      : {
          id: 'stock_listed',
          label: 'Stock listed',
          leg: unavailable('no availability row for this stock number in the export'),
          reading: 'Nobody lists stock for this stock number in the export.',
          direction: 'neutral',
          limitation: null,
        },
  )

  return signals
}

export type QuoteSignalTally = {
  favourable: number
  unfavourable: number
  measuredCount: number
  unavailableCount: number
  total: number
}

/**
 * Count the signals by direction and by evidence state.
 *
 * Deliberately a COUNT and not a score. Six favourable signals out of nine is a fact about
 * the readings; a 0.67 would be a claim about the world that nothing here has calibrated.
 */
export function tallyQuoteSignals(signals: QuoteSignal[]): QuoteSignalTally {
  return {
    favourable: signals.filter((s) => s.direction === 'favourable').length,
    unfavourable: signals.filter((s) => s.direction === 'unfavourable').length,
    measuredCount: signals.filter((s) => s.leg.state === 'MEASURED').length,
    unavailableCount: signals.filter((s) => s.leg.state === 'UNAVAILABLE').length,
    total: signals.length,
  }
}
