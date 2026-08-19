/**
 * THE QUOTE VIEW: the one step of the money journey that has the money in it, adapted from a
 * corner dossier into the FOUR separately auditable figures the doctrine requires.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------------------------------------------------------------------
 * `lib/engine/pricing/**` is 1,593 lines encoding the owner's locked pricing doctrine and its
 * only importer was `lib/intelligence/shelf.ts`, whose only importer was its own test. So the
 * entire answer to "what do I bid" terminated in a test file, and the Documents page asked a
 * human to type the unit price into an empty box. The engine was not wrong, it was unreachable.
 *
 * The gap was never arithmetic. It was that the engine's inputs (an ORIGINAL manufacturer award
 * price, a base year, an evaluation-factor applicability, an explicit pricing instant) are not
 * the shape a dossier carries, and nothing translated between them. That translation is this
 * file, and translating honestly means abstaining far more often than it answers.
 *
 * ---------------------------------------------------------------------------------------
 * FOUR NUMBERS, NEVER ONE. THIS IS A CONSTRAINT, NOT A LAYOUT PREFERENCE
 * ---------------------------------------------------------------------------------------
 * BD-19, verbatim: "No single blended 'recommended quote' number on the UI. Must show FOUR
 * separately visible numbers: anchor with its arithmetic inline, recent-flip band, evaluated
 * price, tripwire band, so the principal can audit each on a napkin."
 *
 * So `QuoteView.figures` is a fixed four-tuple in a fixed order, there is no scalar headline
 * anywhere on the type, and the anchor figure deliberately carries no single unit price: it
 * carries two lines, CPI and DoD procurement, and a caller has to name which index it is
 * rendering. `assertFourSeparateFigures` is the runtime guard that says so out loud, and it is
 * exported so a page-level test can run it against whatever a screen actually renders.
 *
 * ---------------------------------------------------------------------------------------
 * WHAT THE ANCHOR NEEDS, AND WHY MOST LIVE ROWS CANNOT SUPPLY IT
 * ---------------------------------------------------------------------------------------
 * The anchor inflates the ORIGINAL manufacturer award forward. It does NOT anchor on recent
 * surplus flips, because those flips are contaminated by exactly the gouging this product
 * exists to detect, and a fallback to them would understate the item by about the whole margin
 * the business harvests. `anchorPrice` cannot make that mistake: it is never handed the surplus
 * history at all. This adapter must not make it either, so when the manufacturer award is not
 * identifiable the answer is a NAMED abstention carrying the missing input, and the figure has
 * no numeric field on that arm at all.
 *
 * MEASURED over the live NSN-Now feed on 2026-08-18 (7 workbooks, 42,698 procurement rows,
 * 2,514 stock numbers carrying award history, 13,762 approved-source rows):
 *
 *     stock numbers with award history                       2,514
 *     with an award to a company on their approved-source
 *       list, priced and dated (the anchor's required input)   818   32.5%
 *     with that award in 2017, the base year the only two
 *       inflation factors on file are stated for                49    1.9%
 *
 * The second line is the finding worth stating plainly: the factors are single-vintage. The
 * expert stated 1.3223 and 1.40 as 2017-to-2026 judgements and named no published series, so
 * they cannot be re-based to a 2023 award without inventing a number. An anchor computed by
 * applying a 2017 factor to a 2023 award would be wrong by nine years of inflation and would
 * look exactly as confident as a correct one. So the year must match, and 1.9% of rows can
 * anchor today. The fix is a dated inflation SERIES with a published id, not a looser rule
 * here, and the abstention names that so an operator is told what is missing rather than
 * handed a plausible figure.
 *
 * ---------------------------------------------------------------------------------------
 * THE ADDERS ARE THE BUYER'S ARITHMETIC, NOT OURS
 * ---------------------------------------------------------------------------------------
 * BD-18. The $200 (unused former Government surplus) and $600 (CSI surplus evaluation by each
 * ESA) figures are DLA's EVALUATION factors, added by the buyer to our total to form the number
 * it compares against competitors. They are not part of the quote we send and not a cost we
 * pay. Getting this backwards makes an operator quote $600 too high and lose the line.
 *
 * The engine already separates `QuotedTotal` from `EvaluatedTotal` by type name. This file goes
 * one step further because a type NAME does not stop arithmetic: both engine types expose plain
 * `number` fields, and `quoted.totalUsd + evaluated.evaluatedTotalUsd` compiles cleanly. So the
 * two figures leave this module as `QuotedTotalUsd` and `EvaluatedTotalUsd`, which are OBJECTS.
 * `a + b` on them is a type error, and at runtime a naive sum produces a string rather than a
 * plausible wrong dollar figure. The distinction is enforced by the compiler, not by a comment.
 */

import type { AwardHistoryState } from '../awards/nsn-now'
import {
  INDEX_CONFIG_1650,
  NSN_1650_01_059_8221,
  PRICING_CONFIG,
  anchorPrice,
  evaluatedTotal,
  quotedTotal,
  reconcileStatedApproximation,
  tripwireBand,
  type AdderCode,
  type AnchorIndexConfig,
  type IndexKind,
  type PricingConfig,
  type RoundingRuleName,
  type SourceCitation,
  type TripwireBandKind,
} from '@/lib/engine/pricing'

/* ------------------------------------------------------------------------------------ */
/* THE EVIDENCE STATE VOCABULARY                                                          */
/* ------------------------------------------------------------------------------------ */

/**
 * Every figure and every input into a figure carries one of these, and they never render at
 * equal confidence.
 *
 *   MEASURED   read from a government file, or arithmetic over values read from one
 *   ESTIMATED  derived by us from a measured value and a stated judgement
 *   PRIOR      somebody's judgement, stated in the corpus, with no published series behind it
 *   UNREAD     the file exists and we did not read it
 *   ABSENT     the file does not answer this
 */
export const QUOTE_EVIDENCE_STATES = ['MEASURED', 'ESTIMATED', 'PRIOR', 'UNREAD', 'ABSENT'] as const

export type QuoteEvidenceState = (typeof QUOTE_EVIDENCE_STATES)[number]

/**
 * A computed figure is only as strong as its weakest input, so combining is a MINIMUM and never
 * an average. Averaging two evidence states would produce a middle grade nobody can cite, which
 * is the same error as blending two inflation indices into one price.
 */
export function weakestEvidenceState(
  ...states: readonly QuoteEvidenceState[]
): QuoteEvidenceState {
  let weakest: QuoteEvidenceState = 'MEASURED'
  for (const s of states) {
    if (QUOTE_EVIDENCE_STATES.indexOf(s) > QUOTE_EVIDENCE_STATES.indexOf(weakest)) weakest = s
  }
  return weakest
}

/** One input a figure consumed, with where it came from, so the figure can be audited. */
export type FigureInput = {
  readonly label: string
  /** Formatted for reading, not for arithmetic. The numbers live on the figure itself. */
  readonly renderedValue: string
  readonly evidenceState: QuoteEvidenceState
  /** The file, sheet, column or regulation this value was read from. Never a vague "the data". */
  readonly source: string
  /** Present when the value traces to a cited text rather than to a feed row. */
  readonly citation: SourceCitation | null
}

/* ------------------------------------------------------------------------------------ */
/* MONEY THAT CANNOT BE ADDED TO THE WRONG OTHER MONEY                                    */
/* ------------------------------------------------------------------------------------ */

/**
 * What we send to the buyer. An object rather than a branded number on purpose: TypeScript
 * happily adds two branded numbers together and hands back a plain `number`, so a brand would
 * document the distinction without enforcing it.
 */
export type QuotedTotalUsd = {
  readonly kind: 'QUOTED_TOTAL_WHAT_WE_SEND'
  readonly usd: number
}

/** What DLA compares against competitors. Never what we send. */
export type EvaluatedTotalUsd = {
  readonly kind: 'EVALUATED_TOTAL_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND'
  readonly usd: number
}

/**
 * The floor arm's figure carries a DIFFERENT FIELD NAME from the total arm's, mirroring the
 * engine, so a call site that reads a floor as though it were a total fails to compile rather
 * than quietly understating what the buyer will compare us against.
 */
export type EvaluatedFloorUsd = {
  readonly kind: 'EVALUATED_FLOOR_THE_TRUE_FIGURE_IS_HIGHER'
  readonly atLeastUsd: number
}

/* ------------------------------------------------------------------------------------ */
/* THE INPUT: WHAT A CORNER DOSSIER ALREADY HAS                                           */
/* ------------------------------------------------------------------------------------ */

/**
 * One award row as the dossier carries it.
 *
 * `surplusAsWorded` is the export's own word, kept as text. A null is NOT "this was new
 * material": the Surplus column is populated on 311 of 42,698 rows, so a blank means the export
 * states nothing, and reading it as "not surplus" would turn a silence into an all-clear on
 * 99.3% of the corpus.
 */
export type DossierAward = {
  readonly awardDateIso: string | null
  /**
   * The per-unit figure the awards module derives. It is Final Price divided by quantity whenever
   * Final Price is positive, and the row's own Unit Price otherwise. That division is a
   * DERIVATION, not a reading, and the two fields below exist so this module can check it against
   * the row it came from rather than trusting it. See `checkPriceColumns`.
   */
  readonly effectiveUnitPriceUsd: number | null
  /** The Unit Price column exactly as the export states it. Null when the column is blank. */
  readonly statedUnitPriceUsd: number | null
  /** The Final Price column. An EXTENDED total for the whole award, never a per-unit figure. */
  readonly extendedPriceUsd: number | null
  readonly quantity: number | null
  readonly awardeeCage: string | null
  readonly awardeeCompany: string | null
  readonly surplusAsWorded: string | null
  readonly contractNo: string | null
}

export type QuoteViewInput = {
  /** The 13 digit stock number, however the caller formats it. Normalised here for matching. */
  readonly nsn: string
  readonly awards: readonly DossierAward[]
  /**
   * Companies on the item's approved-source list, from the export's MCRL sheet. EMPTY means the
   * export names none for this item, which is an unread state and not a statement that nobody is
   * approved. Nothing downstream may read an empty list as "every awardee is a dealer".
   */
  readonly approvedSourceCages: readonly string[]
  /** Quantity on the live requirement, or null when the index row did not parse one. */
  readonly solicitationQuantity: number | null
  /** The solicitation number, carried so its ninth character can be reported as read. */
  readonly solicitation: string | null
  /** T or U in the ninth position: an alternate offer cannot win the instant buy. Null = unparsed. */
  readonly automatedSolicitation: boolean | null
  /**
   * The instant this quote is being priced at. REQUIRED and explicit: every threshold and band in
   * the engine is dated, and no module in this product reads wall time to decide a price.
   */
  readonly atInstantMs: number
  /** The award-date span of the feed, so any "earliest observed" claim can state its bound. */
  readonly feedWindow: { readonly firstAwardIso: string | null; readonly lastAwardIso: string | null }

  /**
   * ★ WHAT THE EXPORT ESTABLISHED ABOUT THIS STOCK NUMBER'S AWARD HISTORY, when the caller knows.
   *
   * An empty `awards` array means one of two opposite things and the array cannot tell them
   * apart. Measured on the real export: 235 stock numbers were asked about and honestly answered
   * "nothing", while 669 were never answered at all, because a Procurement sheet stopped at
   * exactly its 20,000-row ceiling before reaching them. Saying "no award history is on file" of
   * those 669 is a claim about the market derived from a download that stopped early.
   *
   * OPTIONAL, and its absence is NOT `'none'`. A caller that has not been taught the difference
   * keeps today's wording rather than being handed a confident answer it never established.
   */
  readonly awardHistoryState?: AwardHistoryState

  /** What the operator is considering quoting per unit, when they have typed one. */
  readonly proposedUnitPriceUsd?: number | null

  /**
   * Is the material WE would offer unused former Government surplus? Three states, and the
   * unknown one is not false. Passing false while the answer is unknown omits an applicable
   * evaluation factor, which overstates our competitiveness on a price-alone evaluation and
   * loses the award while every figure on screen looks correct.
   */
  readonly offeringUnusedFormerGovernmentSurplus?: boolean | null
  /** How many ESAs must coordinate. Null is unknown, which is not zero. */
  readonly esaCoordinationCount?: number | null
  /** Part I para 3(b)(3). Optional because unknown and "does not apply" are different facts. */
  readonly buyAmericanOrBalanceOfPayments?: boolean | null

  /** Injected so a real dated inflation series can replace the corpus factors without a rewrite. */
  readonly indices?: AnchorIndexConfig
  readonly config?: PricingConfig
  /** The recency window for the flip band, in months. See `DEFAULT_FLIP_WINDOW_MONTHS`. */
  readonly flipWindowMonths?: number
}

/**
 * OUR window, not a regulation's, and it is surfaced on the figure for exactly that reason.
 *
 * DLAD 17.7505 measures over twelve months, but twelve months is too thin to form a band on most
 * items in this corpus: the median stock number here sees an award every few years, so a twelve
 * month window would abstain on nearly everything and teach an operator nothing. Thirty six
 * months is a judgement we are making, it is graded PRIOR on the figure, and it is an input a
 * caller can change rather than a constant buried here.
 */
export const DEFAULT_FLIP_WINDOW_MONTHS = 36

/* ------------------------------------------------------------------------------------ */
/* IDENTIFYING THE MANUFACTURER AWARD                                                     */
/* ------------------------------------------------------------------------------------ */

export type OemAwardIdentificationFailure =
  | 'NO_AWARD_HISTORY'
  /**
   * ★ WE ASKED AND NEVER GOT AN ANSWER. Distinct from NO_AWARD_HISTORY, which is a statement
   * about DLA; this is a statement about our own acquisition. 669 stock numbers reach here
   * because a batch-export Procurement sheet stopped at exactly its 20,000-row ceiling before
   * reaching them. The abstention is the same; the SENTENCE must not be.
   */
  | 'AWARD_HISTORY_NEVER_ANSWERED'
  | 'NO_APPROVED_SOURCE_LIST'
  | 'NO_AWARD_TO_AN_APPROVED_SOURCE'
  | 'APPROVED_SOURCE_AWARD_CARRIES_NO_PRICE_OR_DATE'
  /** Every candidate row contradicts itself about what one unit cost. */
  | 'NO_APPROVED_SOURCE_AWARD_WHOSE_PRICE_COLUMNS_AGREE'
  /** Several awards share the earliest date and state different unit prices. */
  | 'EARLIEST_APPROVED_SOURCE_AWARDS_DISAGREE_ON_PRICE'

export type OemAwardIdentification =
  | {
      readonly identified: true
      readonly method: 'EARLIEST_AWARD_TO_AN_APPROVED_SOURCE_WITHIN_THE_FEED_WINDOW'
      readonly unitPriceUsd: number
      readonly awardYear: number
      readonly quantity: number
      readonly awardDateIso: string
      readonly awardeeCage: string
      readonly awardeeCompany: string | null
      readonly contractNo: string | null
      readonly evidenceState: 'MEASURED'
      readonly limitation: string
    }
  | {
      readonly identified: false
      readonly reason: OemAwardIdentificationFailure
      readonly missingInput: string
      readonly sentence: string
    }

const normaliseCage = (v: string | null | undefined): string => (v ?? '').trim().toUpperCase()
const digitsOnly = (v: string): string => v.replace(/[^0-9]/g, '')

/** The export's own word for surplus, read affirmatively only. A blank stays a blank. */
function isFlaggedSurplus(award: DossierAward): boolean {
  const w = (award.surplusAsWorded ?? '').trim().toUpperCase()
  return w === 'YES' || w === 'Y' || w === 'TRUE'
}

/* ------------------------------------------------------------------------------------ */
/* THE ROW HAS TO AGREE WITH ITSELF BEFORE THE ANCHOR MULTIPLIES IT                       */
/* ------------------------------------------------------------------------------------ */

/**
 * One cent, and the tolerance is a rounding allowance rather than a fudge factor.
 *
 * The awards module rounds its derived figure to cents (`Math.round(final / qty * 100) / 100`)
 * while the Unit Price column is carried raw, so a perfectly clean row whose stated price has
 * more than two decimals can differ from its own derivation by up to half a cent. Anything past
 * a cent is not rounding, it is the two columns saying different things.
 */
const UNIT_PRICE_AGREEMENT_TOLERANCE_USD = 0.01

type PriceColumnCheck =
  | { readonly agrees: true }
  | {
      readonly agrees: false
      /**
       * THREE REASONS, NOT TWO, AND THE THIRD ONE WAS MISLABELLED.
       *
       * A row carrying no DERIVED figure is a different silence from a row carrying no STATED
       * one, and the first arm of `checkPriceColumns` used to return the second name for the
       * first fact. That was unreachable from `identifyOemAward`, whose `dated` filter already
       * drops a row with no derived price, and it became reachable the moment this check was
       * reused for the resale band and the tripwire, which is exactly what this repair does.
       * A wrong name on an abstention is a wrong sentence on a screen.
       */
      readonly why: 'COLUMNS_DISAGREE' | 'NO_STATED_UNIT_PRICE' | 'NO_DERIVED_UNIT_PRICE'
      /** A clause a person reads, carrying BOTH figures so the contradiction is visible. */
      readonly clause: string
    }

/**
 * Does this row agree with itself about what one unit cost?
 *
 * MEASURED, live NSN-Now feed, 2026-08-18, over the 11,392 approved-source award rows that carry
 * a date, a positive derived price and a positive quantity (the pool this anchor draws from):
 *
 *     rows whose derived price and stated Unit Price differ by more than a cent      68  (0.60%)
 *       of those, Final Price EQUALS Unit Price with quantity > 1 (a unit price
 *         sitting in the extended-price column, so the division fabricates one)       4
 *       of those, the stated Unit Price is a $1.00 placeholder, the shape the
 *         derivation exists to correct                                                0
 *       of those, neither shape: a modification, a partial figure, or a stray        64
 *     rows carrying no stated Unit Price at all                                        0
 *
 * The zero on the third line is the finding. The derivation was introduced to repair $1.00
 * placeholders, and there is not one placeholder row in the anchor's pool, while there are four
 * rows where the division INVENTS a unit price nothing on the row supports. On NSN 5905-01-413-6345
 * it divided a $94.26 unit price by a quantity of 25 and published $3.77, a figure 25 times too
 * low, graded MEASURED, on an item whose resale band on the same screen reads $140.
 *
 * So a candidate row must state a unit price and its own extended total must reproduce it. When
 * the two columns disagree we do not know which is the unit price, and picking one would be
 * exactly the estimate-dressed-as-a-measurement this product refuses. When the row states no unit
 * price at all there is nothing to check the derivation against, and a derived figure with no
 * corroboration is not a reading either. Both are set aside, by name, with both figures printed.
 */
function checkPriceColumns(award: DossierAward): PriceColumnCheck {
  const derived = award.effectiveUnitPriceUsd
  const stated = award.statedUnitPriceUsd
  const where = `${award.awardDateIso ?? 'an undated award'}${
    award.contractNo === null ? '' : ` (${award.contractNo})`
  }`
  if (typeof derived !== 'number' || !Number.isFinite(derived)) {
    const statedText =
      typeof stated === 'number' && Number.isFinite(stated)
        ? `its Unit Price column states ${money(stated)} and no extended total divides out to ` +
          'confirm it'
        : 'neither of its price columns carries a figure'
    return {
      agrees: false,
      why: 'NO_DERIVED_UNIT_PRICE',
      clause: `${where} carries no derived per-unit figure, and ${statedText}`,
    }
  }
  if (typeof stated !== 'number' || !Number.isFinite(stated)) {
    return {
      agrees: false,
      why: 'NO_STATED_UNIT_PRICE',
      clause:
        `${where} states no Unit Price of its own, so the only per-unit figure on it is ` +
        `${money(derived)} divided out of an extended total, with nothing on the row to check it ` +
        'against',
    }
  }
  if (Math.abs(derived - stated) > UNIT_PRICE_AGREEMENT_TOLERANCE_USD) {
    const extended =
      typeof award.extendedPriceUsd === 'number' && Number.isFinite(award.extendedPriceUsd)
        ? `a Final Price of ${money(award.extendedPriceUsd)}`
        : 'its Final Price column'
    const over =
      typeof award.quantity === 'number' && Number.isFinite(award.quantity)
        ? ` over a quantity of ${award.quantity}`
        : ''
    return {
      agrees: false,
      why: 'COLUMNS_DISAGREE',
      clause:
        `${where} states a Unit Price of ${money(stated)} while ${extended}${over} divides to ` +
        `${money(derived)} a unit`,
    }
  }
  return { agrees: true }
}

/** A row the price-column check refused, kept beside the reason so the sentence can name both. */
type SetAsideRow = {
  readonly award: DossierAward
  readonly check: Extract<PriceColumnCheck, { agrees: false }>
}

/**
 * ONE PARTITION, USED BY EVERY FIGURE THAT PUBLISHES A PER-UNIT FIGURE OFF A ROW.
 *
 * The first repair of this module put `checkPriceColumns` in front of the ANCHOR and nowhere
 * else, which fixed one figure and left the resale band publishing the same fabrication on the
 * same screen at the same MEASURED grade. MEASURED over the live NSN-Now feed on 2026-08-18:
 * of 1,783 resolved resale bands, 115 contained a row that contradicts its own Unit Price by more
 * than a cent and 91 carried one AS AN ENDPOINT, which is the number a bidder undercuts. On NSN
 * 6140-01-482-9031 the low endpoint read $22.38 off a row STATING $179.00 with a Final Price of
 * $179.00 on a quantity of 8: the division fabricated a figure eight times too low, and the band
 * is what an operator prices against.
 *
 * The tripwire carried it too. With an operator-typed price the tripwire resolves on 1,531 live
 * stock numbers, 7 of them measured against a row that contradicts itself, and on NSN
 * 2940-01-535-9467 the CROSSED verdict itself flips: the shipped figure reads 311.0% CROSSED off
 * a derived $24.33 while the row's own Unit Price column of $81.11 gives 23.3% and NOT crossed.
 * That is not a rounding difference, it is the operational conclusion of the figure changing
 * with which column you believe.
 *
 * So the check lives here, once, and every pool that is about to become a published number runs
 * through it. WHICH COLUMN IS RIGHT IS NOT DECIDABLE AND THIS DOES NOT DECIDE IT: on NSN
 * 6505-01-146-0539 the row states $0.06 against a derived $32.34 and there the derivation is the
 * truth, so preferring the stated column would be as wrong as preferring the derived one.
 * Abstaining on the contradiction is the only rule that is correct in both directions.
 *
 * THE COST, MEASURED RATHER THAN ASSUMED: 461 of 42,698 live award rows contradict themselves,
 * 1.08%. Zero carry no stated Unit Price column and zero carry no derived figure, so those two
 * arms are unreachable from today's export and one feed revision from being reachable.
 */
function partitionByPriceColumns(pool: readonly DossierAward[]): {
  readonly agreeing: readonly DossierAward[]
  readonly setAside: readonly SetAsideRow[]
} {
  const checked = pool.map((award) => ({ award, check: checkPriceColumns(award) }))
  return {
    agreeing: checked.filter((c) => c.check.agrees).map((c) => c.award),
    setAside: checked.filter((c): c is SetAsideRow => c.check.agrees === false),
  }
}

/** The earliest set-aside row by award date. Undated rows sort first, which is where they belong. */
function earliestSetAsideRow(setAside: readonly SetAsideRow[]): SetAsideRow | undefined {
  return [...setAside].sort((a, b) =>
    (a.award.awardDateIso ?? '').localeCompare(b.award.awardDateIso ?? ''),
  )[0]
}

/**
 * How many rows fell to each reason. Counted rather than inferred by subtraction, because
 * "everything that is not a contradiction must be an unstated column" stopped being true the
 * moment the third reason got its own name.
 */
function countSetAsideReasons(setAside: readonly SetAsideRow[]): {
  readonly disagree: number
  readonly unstated: number
  readonly underived: number
} {
  return {
    disagree: setAside.filter((c) => c.check.why === 'COLUMNS_DISAGREE').length,
    unstated: setAside.filter((c) => c.check.why === 'NO_STATED_UNIT_PRICE').length,
    underived: setAside.filter((c) => c.check.why === 'NO_DERIVED_UNIT_PRICE').length,
  }
}

/** The three counts as clauses, so every sentence that reports a set-aside reports it the same way. */
function setAsideReasonClauses(setAside: readonly SetAsideRow[]): string {
  const { disagree, unstated, underived } = countSetAsideReasons(setAside)
  return (
    (disagree > 0
      ? `${disagree} state a Unit Price their own Final Price divided by quantity does not ` +
        'reproduce. '
      : '') +
    (unstated > 0 ? `${unstated} state no Unit Price at all. ` : '') +
    (underived > 0 ? `${underived} carry no derived per-unit figure to check. ` : '')
  )
}

/**
 * Find the award the anchor is allowed to run on.
 *
 * The rule is membership of the item's approved-source list, because a company allowed to supply
 * the item is the manufacturer or its design-control holder, and a surplus dealer flipping stock
 * is not on that list. The earliest such award inside the feed window is the closest thing to the
 * ORIGINAL award that the data can support, and the limitation string says so rather than letting
 * "earliest observed" quietly read as "original".
 */
export function identifyOemAward(input: QuoteViewInput): OemAwardIdentification {
  if (input.awards.length === 0) {
    if (input.awardHistoryState === 'never_answered') {
      return {
        identified: false,
        reason: 'AWARD_HISTORY_NEVER_ANSWERED',
        missingInput: 'the award history for this stock number, which was requested and never returned',
        sentence:
          'We asked for this stock number\u2019s award history and never received it: the export ' +
          'report stopped at its row ceiling before reaching it. So we do not know whether a ' +
          'manufacturer award exists. This is an unread input, not a finding that nobody has bought ' +
          'this item, and it is fixed by re-requesting the report rather than by pricing around it.',
      }
    }
    return {
      identified: false,
      reason: 'NO_AWARD_HISTORY',
      missingInput: 'any award row for this stock number',
      sentence:
        'No award history is on file for this stock number, so there is no manufacturer award to ' +
        'carry forward. This is an abstention and not a zero.',
    }
  }

  const cages = new Set(input.approvedSourceCages.map(normaliseCage).filter((c) => c !== ''))
  if (cages.size === 0) {
    return {
      identified: false,
      reason: 'NO_APPROVED_SOURCE_LIST',
      missingInput: 'the approved-source list (the export MCRL sheet) for this stock number',
      sentence:
        'The export names no approved source for this item, so no award can be attributed to the ' +
        'manufacturer rather than to a dealer. Anchoring on an award we cannot attribute would be ' +
        'anchoring on a possible surplus flip, which is the one input the doctrine forbids.',
    }
  }

  const attributed = input.awards.filter(
    (a) => cages.has(normaliseCage(a.awardeeCage)) && !isFlaggedSurplus(a),
  )
  if (attributed.length === 0) {
    return {
      identified: false,
      reason: 'NO_AWARD_TO_AN_APPROVED_SOURCE',
      missingInput: "an award whose awardee appears on this item's approved-source list",
      sentence:
        'Every award on file went to a company that is not on the approved-source list, or was ' +
        'flagged as surplus by the export. Those are resale prices. The anchor does not fall back ' +
        'to them: they are contaminated by the same overcharging this product exists to detect.',
    }
  }

  const dated = attributed.filter(
    (a) =>
      a.awardDateIso !== null &&
      a.effectiveUnitPriceUsd !== null &&
      a.effectiveUnitPriceUsd > 0 &&
      a.quantity !== null &&
      a.quantity > 0,
  )

  if (dated.length === 0) {
    return {
      identified: false,
      reason: 'APPROVED_SOURCE_AWARD_CARRIES_NO_PRICE_OR_DATE',
      missingInput: 'a dated, positively priced, positively quantified award to an approved source',
      sentence:
        `${attributed.length} award(s) on file went to an approved source, and none of them carries ` +
        'a date, a positive unit price and a positive quantity together. The anchor multiplies a ' +
        'unit price by an inflation factor, so a row missing any of those cannot be carried forward.',
    }
  }

  /*
   * THE SELF-CONTRADICTING ROWS COME OUT FIRST, AND THE ORDER MATTERS.
   *
   * Filtering before the earliest-award choice rather than after it is the difference between an
   * abstention and an answer on the two live rows that provoked this guard. On NSN 5905-01-413-6345
   * five approved-source awards share the earliest date, four state $94.26 consistently and one
   * divides to $3.77; dropping the contradicting row leaves four rows that agree with each other
   * and with themselves, so the anchor runs on $94.26. Checking the tie first would have thrown
   * away four corroborating readings because a fifth row was corrupt.
   *
   * What is NOT allowed is letting the exclusion go unsaid: removing an earlier row changes what
   * "the earliest award" means, so the count and the earliest excluded row are written into the
   * limitation below.
   */
  // One pass, then partitioned, so the kept set and the set-aside set cannot drift apart later.
  const { agreeing: agreeingUnsorted, setAside } = partitionByPriceColumns(dated)
  const agreeing = [...agreeingUnsorted].sort((a, b) =>
    (a.awardDateIso ?? '').localeCompare(b.awardDateIso ?? ''),
  )

  const firstAgreeing = agreeing[0]
  if (firstAgreeing === undefined) {
    const earliestSetAside = earliestSetAsideRow(setAside)
    return {
      identified: false,
      reason: 'NO_APPROVED_SOURCE_AWARD_WHOSE_PRICE_COLUMNS_AGREE',
      missingInput:
        "an approved-source award whose Unit Price column and Final Price column agree on what one " +
        'unit cost',
      sentence:
        `${dated.length} approved-source award(s) on file carry a date, a price and a quantity, and ` +
        'not one of them agrees with itself about the unit price. ' +
        setAsideReasonClauses(setAside) +
        (earliestSetAside === undefined ? '' : `The earliest: ${earliestSetAside.check.clause}. `) +
        'The anchor multiplies a unit price by an inflation factor, so a figure the row itself ' +
        'contradicts would ship looking exactly as confident as a correct one. This is an ' +
        'abstention and not a zero.',
    }
  }

  /*
   * A TIE ON THE EARLIEST DATE IS NOT A TIE-BREAK.
   *
   * `localeCompare` on equal ISO dates returns 0, so the sort is stable and `[0]` is whichever row
   * the workbook happened to list first. File order is an artefact of how a spreadsheet was
   * assembled and carries no information about which award was first, so when the earliest-dated
   * rows disagree on price there is no earliest award to report. MEASURED live: 6 of the 818 stock
   * numbers with a usable approved-source pool land here once the contradicting rows are out.
   */
  const awardDateIso = firstAgreeing.awardDateIso as string
  const tied = agreeing.filter((a) => a.awardDateIso === awardDateIso)
  const tiedPricesInCents = new Set(
    tied.map((a) => Math.round((a.effectiveUnitPriceUsd as number) * 100)),
  )
  if (tiedPricesInCents.size > 1) {
    const prices = [...new Set(tied.map((a) => money(a.effectiveUnitPriceUsd as number)))]
    return {
      identified: false,
      reason: 'EARLIEST_APPROVED_SOURCE_AWARDS_DISAGREE_ON_PRICE',
      missingInput:
        'a single earliest approved-source award, or a stated rule for choosing between awards ' +
        'made to approved sources on the same day',
      sentence:
        `${tied.length} approved-source awards share the earliest date on file, ${awardDateIso}, and ` +
        `they state different unit prices: ${prices.join(', ')}. "The earliest award" is not a fact ` +
        'when several awards are the earliest, and the order the workbook lists them in is not a ' +
        'tie-break. No anchor is reported for this item until the awards can be told apart.',
    }
  }

  const earliest = firstAgreeing
  /*
   * THE EXCLUSION IS ALWAYS DISCLOSED. THE RETRACTION IS NOT, AND THAT DISTINCTION IS THE REPAIR.
   *
   * The first version of this note fired whenever ANY row was set aside and then withdrew the
   * earliest-award claim: "not necessarily the earliest approved-source award on file." MEASURED
   * over the live feed on 2026-08-18: 34 of the 808 identified anchors, 4.2%, carry that
   * retraction while every set-aside row on the item is dated AFTER the chosen award. NSN
   * 8145-01-512-1012 chose 2023-01-17 and the earliest row it set aside is dated 2025-01-31.
   * Nothing earlier was dropped, the chosen row IS the earliest approved-source award on file,
   * and the hedge withdrew a measured fact. The wording made it worse by reading temporally
   * ("set aside before this one was chosen") in a sentence whose whole subject is dates, so a
   * reader was invited to conclude an earlier award had been discarded.
   *
   * A FALSE REFUSAL IS A DEFECT. An abstention that fires when the answer is known teaches an
   * operator that our abstentions are noise, and the whole evidence-state contract is spent the
   * moment they start reading past them. So the retraction is emitted only in the case it is
   * actually about: a set-aside row dated AT OR BEFORE the chosen award, which is the only
   * shape that can weaken "this is the earliest". Equality counts as weakening, because a row
   * sharing the earliest date would have gone to the tie check had it survived.
   *
   * When every set-aside row is later, the exclusion is still stated out loud (it is real and it
   * changed the pool) and the earliest-award claim is stated plainly rather than withdrawn.
   */
  const earliestSetAside = earliestSetAsideRow(setAside)
  const retractsTheEarliestClaim =
    earliestSetAside !== undefined &&
    (earliestSetAside.award.awardDateIso ?? '') <= awardDateIso
  const setAsideNote =
    earliestSetAside === undefined
      ? ''
      : ` ${setAside.length} approved-source award row(s) were excluded from this choice, because ` +
        'the row disagrees with itself about the unit price and the anchor cannot carry forward a ' +
        `figure the row contradicts. ${setAsideReasonClauses(setAside)}` +
        `The earliest of those: ${earliestSetAside.check.clause}. ` +
        (retractsTheEarliestClaim
          ? 'One of them is dated at or before this award, so this is the earliest approved-source ' +
            'award whose price columns AGREE, which is not necessarily the earliest ' +
            'approved-source award on file.'
          : 'Every one of them is dated AFTER this award, so nothing earlier was dropped and this ' +
            'IS the earliest approved-source award on file.')
  return {
    identified: true,
    method: 'EARLIEST_AWARD_TO_AN_APPROVED_SOURCE_WITHIN_THE_FEED_WINDOW',
    unitPriceUsd: earliest.effectiveUnitPriceUsd as number,
    awardYear: Number(awardDateIso.slice(0, 4)),
    quantity: earliest.quantity as number,
    awardDateIso,
    awardeeCage: normaliseCage(earliest.awardeeCage),
    awardeeCompany: earliest.awardeeCompany,
    contractNo: earliest.contractNo,
    evidenceState: 'MEASURED',
    limitation:
      'This is the EARLIEST award to an approved source that the feed carries, over a window of ' +
      `${input.feedWindow.firstAwardIso ?? 'an unstated start'} to ` +
      `${input.feedWindow.lastAwardIso ?? 'an unstated end'}. An earlier original award outside ` +
      'that window would not appear here, so read this as the earliest OBSERVED manufacturer ' +
      'award, never as proven to be the first one. The export also states surplus status on a ' +
      'small minority of rows, so a blank surplus column was treated as unread and not as proof ' +
      'the material was new.' +
      setAsideNote,
  }
}

/* ------------------------------------------------------------------------------------ */
/* THE PRICING BASIS                                                                      */
/* ------------------------------------------------------------------------------------ */

/**
 * The unit price the evaluated figure and the tripwire figure do their arithmetic against.
 *
 * IT IS NOT A RECOMMENDED QUOTE AND THE TYPE SAYS SO IN ITS `note`. The evaluated total and the
 * tripwire band are both functions of a candidate price: one has to exist for either to compute
 * at all. When the operator has typed one, that is the basis. When they have not, the preferred
 * anchor line is used as a stated basis so the two dependent figures can still be audited, and
 * the fact that it is a basis rather than a recommendation is carried on the value.
 */
export type PricingBasis =
  | {
      readonly kind: 'OPERATOR_PROPOSED'
      readonly unitPriceUsd: number
      readonly note: string
    }
  | {
      readonly kind: 'ANCHOR_PREFERRED_INDEX'
      readonly unitPriceUsd: number
      readonly indexKind: IndexKind
      readonly note: string
    }
  | {
      readonly kind: 'NONE'
      readonly missingInput: string
      readonly note: string
    }

const BASIS_NOT_A_RECOMMENDATION =
  'A basis for the evaluated and tripwire arithmetic only. This product publishes no single ' +
  'recommended quote, and this figure is not one.'

/* ------------------------------------------------------------------------------------ */
/* THE FOUR FIGURES                                                                       */
/* ------------------------------------------------------------------------------------ */

export const QUOTE_FIGURE_IDS = [
  'ANCHOR',
  'RECENT_FLIP_BAND',
  'EVALUATED_PRICE',
  'TRIPWIRE_BAND',
] as const

export type QuoteFigureId = (typeof QUOTE_FIGURE_IDS)[number]

/**
 * The abstained arm of every figure. It carries NO numeric field of any kind, deliberately: a
 * page cannot read a price off an abstention by accident, because there is no price on it to
 * read. `missingInput` names the thing to go and get, because "insufficient data" tells an
 * operator nothing they can act on.
 */
export type FigureAbstention<TReason extends string> = {
  readonly resolved: false
  readonly reason: TReason
  readonly missingInput: string
  readonly sentence: string
}

/** One index applied to the manufacturer award. Two of these exist and they are never averaged. */
export type AnchorLine = {
  readonly indexKind: IndexKind
  readonly factor: number
  /** The unrounded product, so the arithmetic shown inline is the arithmetic performed. */
  readonly exactUnitPriceUsd: number
  readonly unitPriceUsd: number
  readonly preferred: boolean
  readonly preferenceRationale: string | null
  /** The factor is the expert's stated judgement and names no published series. */
  readonly factorEvidenceState: 'PRIOR'
  /** "1537.85 x 1.40 = 2152.99". Checkable on a napkin, which is the whole requirement. */
  readonly arithmetic: string
  /** His written figure reconciled against the true product, never asserted as the product. */
  readonly statedApproximation: {
    readonly statedUsd: number
    readonly statedVerbatim: string
    readonly deltaUsd: number
    readonly reproducibleByRoundingRules: readonly RoundingRuleName[]
  } | null
  readonly citation: SourceCitation
}

export type AnchorFigureAbstentionReason =
  | 'NO_MANUFACTURER_AWARD_IDENTIFIED'
  | 'NO_INFLATION_FACTOR_FOR_THE_AWARD_YEAR'
  | 'ENGINE_ABSTAINED'

export type AnchorFigure =
  | {
      readonly figureId: 'ANCHOR'
      readonly label: string
      readonly resolved: true
      readonly evidenceState: QuoteEvidenceState
      /** Exactly two, CPI first and DoD procurement second. There is no scalar anchor price. */
      readonly lines: readonly [AnchorLine, AnchorLine]
      readonly preferredIndexKind: IndexKind
      readonly inputs: readonly FigureInput[]
      readonly limitation: string
    }
  | ({
      readonly figureId: 'ANCHOR'
      readonly label: string
    } & FigureAbstention<AnchorFigureAbstentionReason>)

export type FlipObservation = {
  readonly awardDateIso: string
  readonly unitPriceUsd: number
  readonly awardeeCompany: string | null
  readonly awardeeCage: string | null
  readonly whyCountedAsSecondary:
    | 'FLAGGED_SURPLUS_BY_THE_EXPORT'
    | 'AWARDEE_NOT_ON_THE_APPROVED_SOURCE_LIST'
}

export type FlipBandAbstentionReason =
  | 'NO_AWARD_HISTORY'
  /** Asked, never answered: the report was cut short before reaching this stock number. */
  | 'AWARD_HISTORY_NEVER_ANSWERED'
  | 'CANNOT_CLASSIFY_SECONDARY_WITHOUT_AN_APPROVED_SOURCE_LIST'
  /**
   * Awards exist and not one of them carries a price. NOT a finding about who is buying: with no
   * priced row, no buy has been attributed to anybody, so nothing can be said about a corner.
   */
  | 'NO_PRICED_AWARD_ON_FILE'
  /** Resale awards exist, and none of them is recent enough to form a band. */
  | 'NO_SECONDARY_AWARD_IN_THE_WINDOW'
  /**
   * Recent resale awards exist and every one of them contradicts itself about the unit price, so
   * there is no endpoint the row it came from would agree with. See `partitionByPriceColumns`.
   */
  | 'NO_RESALE_AWARD_IN_THE_WINDOW_WHOSE_PRICE_COLUMNS_AGREE'
  /** Every PRICED award on file went to an approved source. A finding, not a window problem. */
  | 'NO_SECONDARY_AWARD_ON_FILE'

export type RecentFlipBandFigure =
  | {
      readonly figureId: 'RECENT_FLIP_BAND'
      readonly label: string
      readonly resolved: true
      readonly evidenceState: QuoteEvidenceState
      readonly lowUnitPriceUsd: number
      readonly highUnitPriceUsd: number
      readonly sampleCount: number
      readonly windowMonths: number
      readonly windowStartIso: string
      readonly windowEndIso: string
      readonly observations: readonly FlipObservation[]
      readonly arithmetic: string
      readonly inputs: readonly FigureInput[]
      readonly limitation: string
    }
  | ({
      readonly figureId: 'RECENT_FLIP_BAND'
      readonly label: string
    } & FigureAbstention<FlipBandAbstentionReason>)

export type EvaluatedAdderLine = {
  readonly code: AdderCode
  readonly unitAmountUsd: number
  readonly appliedCount: number
  readonly subtotalUsd: number
  readonly citation: SourceCitation
  readonly laterAmendmentsUnverified: boolean
}

export type EvaluatedFigureAbstentionReason =
  | 'NO_BASIS_UNIT_PRICE'
  | 'SOLICITATION_QUANTITY_ABSENT'
  | 'SURPLUS_OFFER_STATUS_UNDECLARED'
  | 'ESA_COORDINATION_COUNT_UNDECLARED'
  | 'ENGINE_ABSTAINED'

/**
 * The resolved arm splits TOTAL from FLOOR with different field names, mirroring the engine. A
 * caller that reads `evaluatedTotal` on a floor fails to compile, which is the only way to stop
 * an understated comparison basis from shipping silently.
 */
export type EvaluatedPriceFigure =
  | {
      readonly figureId: 'EVALUATED_PRICE'
      readonly label: string
      readonly resolved: true
      readonly kind: 'TOTAL'
      readonly evidenceState: QuoteEvidenceState
      readonly quotedTotal: QuotedTotalUsd
      readonly evaluatedTotal: EvaluatedTotalUsd
      readonly adders: readonly EvaluatedAdderLine[]
      readonly adderTotalUsd: number
      readonly arithmetic: string
      readonly basis: PricingBasis
      readonly inputs: readonly FigureInput[]
      readonly limitation: string
    }
  | {
      readonly figureId: 'EVALUATED_PRICE'
      readonly label: string
      readonly resolved: true
      readonly kind: 'FLOOR'
      readonly evidenceState: QuoteEvidenceState
      readonly quotedTotal: QuotedTotalUsd
      readonly evaluatedFloor: EvaluatedFloorUsd
      readonly adders: readonly EvaluatedAdderLine[]
      readonly unpricedFactorCodes: readonly AdderCode[]
      readonly directionOfError: 'ACTUAL_IS_HIGHER_THAN_THIS'
      readonly arithmetic: string
      readonly basis: PricingBasis
      readonly inputs: readonly FigureInput[]
      readonly limitation: string
    }
  | ({
      readonly figureId: 'EVALUATED_PRICE'
      readonly label: string
    } & FigureAbstention<EvaluatedFigureAbstentionReason>)

export type TripwireFigureAbstentionReason =
  | 'NO_BASIS_UNIT_PRICE'
  | 'SOLICITATION_QUANTITY_ABSENT'
  | 'NO_PRIOR_AWARD_WITH_A_PRICE'
  /**
   * The most recent prior award exists and contradicts itself about the unit price, so the one
   * figure DLAD 17.7505 measures against is not readable. See `partitionByPriceColumns`.
   */
  | 'MOST_RECENT_PRIOR_AWARD_CONTRADICTS_ITSELF_ON_PRICE'
  | 'PRIOR_PRICE_OUTSIDE_TRAILING_12_MONTHS'
  | 'PRIOR_PRICE_NOT_POSITIVE'
  | 'MICRO_PURCHASE_THRESHOLD_NOT_RESOLVABLE_AT_INSTANT'
  | 'BAND_NOT_RESOLVABLE_AT_INSTANT'

export type TripwireBandFigure =
  | {
      readonly figureId: 'TRIPWIRE_BAND'
      readonly label: string
      readonly resolved: true
      readonly evidenceState: QuoteEvidenceState
      readonly impliedIncreasePercent: number
      readonly impliedMultipleOfPrior: number
      readonly band: TripwireBandKind
      readonly bandThresholdPercent: number
      readonly crossed: boolean
      readonly microPurchaseThresholdUsd: number
      readonly consequence: {
        readonly awardPathway: 'AUTOMATED' | 'REQUIRES_SENIOR_NOTIFICATION'
        readonly capsPrice: false
        readonly makesAwardIllegal: false
        readonly requiredAction: string | null
        readonly operationalMeaning: string
      }
      readonly arithmetic: string
      readonly basis: PricingBasis
      readonly inputs: readonly FigureInput[]
      readonly limitation: string
      readonly bandCitation: SourceCitation
    }
  | ({
      readonly figureId: 'TRIPWIRE_BAND'
      readonly label: string
    } & FigureAbstention<TripwireFigureAbstentionReason>)

/* ------------------------------------------------------------------------------------ */
/* RECORDED OBSERVATIONS: A NUMBER A HUMAN WROTE, NEVER A NUMBER WE COMPUTED               */
/* ------------------------------------------------------------------------------------ */

/**
 * The $3,565 case, and the reason this whole concept exists.
 *
 * The expert really did quote $3,565 and really did draw a counter-offer request. His own
 * sentence gives the derivation: "three times the unit price of the previous award", which is
 * 3 x $1,188.33, a different rule on a different input. The anchor chain yields $2,033.50 (CPI)
 * and $2,152.99 (DoD) and never reaches $3,565. Forcing the waterfall to land there means
 * back-solving a coefficient until the number appears, which is fabricated arithmetic on the one
 * surface where a wrong number costs a customer their standing with their buyer.
 *
 * So it is recorded, with its derivation named, and `reproducedByAnchor` is MEASURED against the
 * anchor lines that were actually computed rather than asserted as false by a constant. If some
 * future edit did make the anchor produce it, the flag flips and the surface says so.
 */
export type RecordedQuoteObservation = {
  readonly label: string
  readonly valueUsd: number
  readonly derivationStatedBySource: string
  readonly evidenceState: 'PRIOR'
  readonly citation: SourceCitation
  /** Computed by comparing against every anchor line, not declared. */
  readonly reproducedByAnchor: boolean
  /** The napkin proof, with the coefficient the anchor would need in order to reach it. */
  readonly reproductionCheck: string
  readonly note: string
}

type RecordedObservationSeed = {
  readonly label: string
  readonly valueUsd: number
  readonly derivationStatedBySource: string
  readonly citation: SourceCitation
  readonly note: string
}

/**
 * The corpus records exactly one quoted price, for one stock number, in one sentence. It is an
 * observed decision and NOT the engine's pricing rule, so it attaches to that stock number only
 * and nothing generalises "three times the previous award" into a formula.
 */
export function recordedObservationSeedsForNsn(nsn: string): readonly RecordedObservationSeed[] {
  if (digitsOnly(nsn) !== digitsOnly(NSN_1650_01_059_8221.nsn)) return []
  const q = NSN_1650_01_059_8221.observations.quotedUnitPriceUsd
  return [
    {
      label: 'Quote the expert actually sent',
      valueUsd: q.value,
      derivationStatedBySource: q.derivationStatedBySource,
      citation: NSN_1650_01_059_8221.citation,
      note: q.note,
    },
  ]
}

/* ------------------------------------------------------------------------------------ */
/* THE VIEW                                                                               */
/* ------------------------------------------------------------------------------------ */

export type QuoteView = {
  readonly nsn: string
  readonly atInstantMs: number
  readonly oemAward: OemAwardIdentification
  readonly basis: PricingBasis
  /** Exactly four, in a fixed order. A page cannot render three of them and call it the quote. */
  readonly figures: readonly [
    AnchorFigure,
    RecentFlipBandFigure,
    EvaluatedPriceFigure,
    TripwireBandFigure,
  ]
  readonly recordedObservations: readonly RecordedQuoteObservation[]
  /** The sentence a surface must render above the four figures. */
  readonly doctrineNotice: string
  /** Named, never empty by omission. */
  readonly gaps: readonly string[]
}

const DOCTRINE_NOTICE =
  'Four figures, each auditable on its own. This product publishes no single blended ' +
  'recommended quote: the anchor, the recent resale band, the evaluated price and the ' +
  'tripwire band answer different questions and are shown separately so each can be checked ' +
  "by hand. The evaluation factors belong to the buyer's comparison arithmetic, not to the " +
  'price we send and not to any cost we pay.'

/* ------------------------------------------------------------------------------------ */
/* ARITHMETIC RENDERED FOR A HUMAN                                                        */
/* ------------------------------------------------------------------------------------ */

/** Two decimals, no thousands separators, so a reader can retype it into a calculator. */
const money = (usd: number): string => usd.toFixed(2)

/**
 * Two decimal places minimum, then as many more as the factor actually carries.
 *
 * The source writes "1.40" and "1.3223". Rendering 1.4 as "1.4" is the same number and a
 * different string, and an operator checking our arithmetic against the expert's sentence should
 * not have to decide whether a shortened factor is the one he stated.
 */
function factorText(factor: number): string {
  const trimmed = factor.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  const [whole, decimals = ''] = trimmed.split('.')
  return decimals.length >= 2 ? trimmed : `${whole}.${decimals.padEnd(2, '0')}`
}

/** Enough places to show the exact product when it is not a whole number of cents. */
function exactText(usd: number): string {
  const rounded = Math.round(usd * 100) / 100
  return usd === rounded ? usd.toFixed(2) : String(usd)
}

function monthsBeforeUtc(instantMs: number, months: number): number {
  const d = new Date(instantMs)
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() - months,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  )
}

const isoDay = (instantMs: number): string => new Date(instantMs).toISOString().slice(0, 10)

/* ------------------------------------------------------------------------------------ */
/* FIGURE 1: THE ANCHOR                                                                   */
/* ------------------------------------------------------------------------------------ */

const ANCHOR_LABEL = 'Anchor: the manufacturer award carried forward, two indices, never blended'

function buildAnchorFigure(
  input: QuoteViewInput,
  oem: OemAwardIdentification,
  indices: AnchorIndexConfig,
): AnchorFigure {
  if (!oem.identified) {
    return {
      figureId: 'ANCHOR',
      label: ANCHOR_LABEL,
      resolved: false,
      reason: 'NO_MANUFACTURER_AWARD_IDENTIFIED',
      missingInput: oem.missingInput,
      sentence:
        `${oem.sentence} The anchor is the only figure here that answers what the item is ` +
        'actually worth, and it cannot be computed without that award.',
    }
  }

  /*
   * THE VINTAGE CHECK, and it is the strictest thing in this file.
   *
   * Both factors on file are stated as carrying 2017 dollars forward. Applying one to a 2023
   * award silently claims nine extra years of inflation, and the result is indistinguishable on
   * screen from a correct one. Neither factor names a published series, so neither can be
   * re-based: there is no series to look 2023 up in. Requiring the years to match costs coverage
   * (49 of 2,514 live stock numbers today) and is the only reading the evidence supports.
   */
  const cpiBase = indices.cpi.vintage.baseYear
  const dodBase = indices.dodProcurement.vintage.baseYear
  if (cpiBase !== dodBase || oem.awardYear !== cpiBase) {
    return {
      figureId: 'ANCHOR',
      label: ANCHOR_LABEL,
      resolved: false,
      reason: 'NO_INFLATION_FACTOR_FOR_THE_AWARD_YEAR',
      missingInput:
        `an inflation factor with a base year of ${oem.awardYear}, from a published series ` +
        '(a BLS CPI-U reading or a DoD procurement deflator) rather than a stated judgement',
      sentence:
        `The manufacturer award is dated ${oem.awardDateIso}. The two factors on file are the ` +
        `expert's stated judgements for a base year of ${cpiBase === dodBase ? cpiBase : `${cpiBase} and ${dodBase}`} ` +
        'and name no published series, so there is nothing to re-base them against. Applying a ' +
        `${cpiBase} factor to a ${oem.awardYear} award would overstate the anchor by the difference ` +
        'between those years and would look exactly as confident as a correct figure. No anchor is ' +
        'reported for this item until a dated inflation series is on file.',
    }
  }

  const outcome = anchorPrice(
    { unitPriceUsd: oem.unitPriceUsd, awardYear: oem.awardYear, quantity: oem.quantity },
    indices,
  )
  if (!outcome.anchored) {
    return {
      figureId: 'ANCHOR',
      label: ANCHOR_LABEL,
      resolved: false,
      reason: 'ENGINE_ABSTAINED',
      missingInput: 'a well formed anchor configuration and a positive manufacturer unit price',
      sentence: outcome.detail,
    }
  }

  const stated = NSN_1650_01_059_8221.observations.statedApproximations
  const isReferenceItem = digitsOnly(input.nsn) === digitsOnly(NSN_1650_01_059_8221.nsn)

  /*
   * A named function over ONE result, applied to each element of the engine's two-element tuple
   * by hand. Mapping the tuple with `.map` would hand back `AnchorLine[]`, and widening a tuple
   * to an array is exactly the door through which a third line, or a single blended one, gets in
   * later. The tuple stays a tuple all the way to the type.
   */
  const toLine = (r: (typeof outcome.results)[number]): AnchorLine => {
    /*
     * The expert's written approximations belong to ONE worked example. Attaching them to any
     * other stock number would present his rounding of a 2017 Moog price as commentary on a
     * different item, which is a fabricated association even though every number in it is real.
     */
    const approx =
      isReferenceItem && r.kind === 'cpi'
        ? reconcileStatedApproximation(r.adjustedUnitPriceExactUsd, stated.cpiUsd, stated.cpiVerbatim)
        : isReferenceItem && r.kind === 'dod_procurement'
          ? reconcileStatedApproximation(
              r.adjustedUnitPriceExactUsd,
              stated.dodUsd,
              stated.dodVerbatim,
            )
          : null

    const exact = exactText(r.adjustedUnitPriceExactUsd)
    const rounds =
      r.adjustedUnitPriceExactUsd === r.adjustedUnitPriceUsd
        ? ''
        : ` (rounds to ${money(r.adjustedUnitPriceUsd)})`

    return {
      indexKind: r.kind,
      factor: r.factor,
      exactUnitPriceUsd: r.adjustedUnitPriceExactUsd,
      unitPriceUsd: r.adjustedUnitPriceUsd,
      preferred: r.preferred,
      preferenceRationale: r.preferenceRationale,
      factorEvidenceState: 'PRIOR',
      arithmetic: `${money(oem.unitPriceUsd)} x ${factorText(r.factor)} = ${exact}${rounds}`,
      statedApproximation: approx
        ? {
            statedUsd: approx.statedUsd,
            statedVerbatim: approx.statedVerbatim,
            deltaUsd: approx.deltaUsd,
            reproducibleByRoundingRules: approx.reproducibleBy,
          }
        : null,
      citation: r.citation,
    }
  }
  const lines: readonly [AnchorLine, AnchorLine] = [
    toLine(outcome.results[0]),
    toLine(outcome.results[1]),
  ]

  return {
    figureId: 'ANCHOR',
    label: ANCHOR_LABEL,
    resolved: true,
    /*
     * ESTIMATED, stated rather than combined, and the distinction is not pedantry.
     *
     * The obvious move is `weakestEvidenceState('MEASURED', 'PRIOR')` over the two inputs, which
     * returns PRIOR. That is wrong: PRIOR means somebody's bare judgement, and this figure is not
     * one. It is arithmetic we performed on a measured award price, using a judged factor. The
     * act of deriving is what makes it ESTIMATED, and the factor's PRIOR grade is carried where a
     * reader can see it, on the factor's own input line. Taking a minimum over inputs is the
     * right rule for a figure that merely COMBINES values, which is why the evaluated and
     * tripwire figures below use it, and the wrong rule for one that DERIVES a new value.
     */
    evidenceState: 'ESTIMATED',
    lines,
    preferredIndexKind: outcome.preferred.kind,
    inputs: [
      {
        label: 'Manufacturer award unit price',
        renderedValue: `${money(oem.unitPriceUsd)} on ${oem.awardDateIso} to ${
          oem.awardeeCompany ?? oem.awardeeCage
        }`,
        evidenceState: 'MEASURED',
        source:
          'NSN-Now Batch Export, Procurement sheet, joined to the MCRL approved-source sheet on ' +
          'the awardee CAGE. A commercial redistribution of DLA award data, not a file read from ' +
          'DLA directly.',
        citation: null,
      },
      {
        label: 'CPI factor',
        renderedValue: factorText(indices.cpi.factor),
        evidenceState: 'PRIOR',
        source: indices.cpi.vintage.note,
        citation: indices.cpi.citation,
      },
      {
        label: 'DoD procurement factor',
        renderedValue: factorText(indices.dodProcurement.factor),
        evidenceState: 'PRIOR',
        source: indices.dodProcurement.vintage.note,
        citation: indices.dodProcurement.citation,
      },
    ],
    limitation:
      'Two figures, deliberately, and there is no average of them anywhere on this view. Both ' +
      "factors are the expert's stated judgement rather than a published index reading, so the " +
      'anchor is an estimate built on a measured award price. ' +
      oem.limitation,
  }
}

/* ------------------------------------------------------------------------------------ */
/* FIGURE 2: THE RECENT RESALE BAND                                                       */
/* ------------------------------------------------------------------------------------ */

const FLIP_LABEL = 'Recent resale band: what the secondary market has been clearing at'

function buildFlipBandFigure(input: QuoteViewInput, windowMonths: number): RecentFlipBandFigure {
  if (input.awards.length === 0) {
    if (input.awardHistoryState === 'never_answered') {
      return {
        figureId: 'RECENT_FLIP_BAND',
        label: FLIP_LABEL,
        resolved: false,
        reason: 'AWARD_HISTORY_NEVER_ANSWERED',
        missingInput: 'the award history for this stock number, which was requested and never returned',
        sentence:
          'The award history for this stock number was requested and never returned \u2014 the export ' +
          'report stopped at its row ceiling before reaching it \u2014 so no resale range can be read. ' +
          'Unknown, not empty.',
      }
    }
    return {
      figureId: 'RECENT_FLIP_BAND',
      label: FLIP_LABEL,
      resolved: false,
      reason: 'NO_AWARD_HISTORY',
      missingInput: 'any award row for this stock number',
      sentence: 'No award history is on file, so no resale range can be read.',
    }
  }

  const cages = new Set(input.approvedSourceCages.map(normaliseCage).filter((c) => c !== ''))
  const windowStartMs = monthsBeforeUtc(input.atInstantMs, windowMonths)

  const classify = (a: DossierAward): FlipObservation['whyCountedAsSecondary'] | null => {
    if (isFlaggedSurplus(a)) return 'FLAGGED_SURPLUS_BY_THE_EXPORT'
    /*
     * With no approved-source list, "not on the list" is a silence and not a finding. Calling
     * every awardee a dealer because the MCRL sheet is empty for this item would read a blank as
     * a value, which is the failure this whole view is built to refuse.
     */
    if (cages.size === 0) return null
    if (!cages.has(normaliseCage(a.awardeeCage))) return 'AWARDEE_NOT_ON_THE_APPROVED_SOURCE_LIST'
    return null
  }

  const priced = input.awards.filter(
    (a) => a.awardDateIso !== null && a.effectiveUnitPriceUsd !== null && a.effectiveUnitPriceUsd > 0,
  )
  const secondaryAll = priced.filter((a) => classify(a) !== null)
  /*
   * The exact complement of `priced`, split so the sentence can say WHICH silence it hit. These
   * two sets do not overlap and together with `priced` they cover every award row: a row is here
   * because it carries no positive price, or because it carries one with no award date.
   */
  const withoutAPrice = input.awards.filter(
    (a) => a.effectiveUnitPriceUsd === null || a.effectiveUnitPriceUsd <= 0,
  )
  const pricedButUndated = input.awards.filter(
    (a) =>
      a.awardDateIso === null && a.effectiveUnitPriceUsd !== null && a.effectiveUnitPriceUsd > 0,
  )
  const unread = [...withoutAPrice, ...pricedButUndated]

  /*
   * WHY THE UNREAD ROWS ARE COUNTED BY REASON AND NOT BY A BOOLEAN.
   *
   * The first repair wrote `unread.filter((a) => classify(a) !== null)` and printed the result as
   * "N of them went to a company that is not on the approved-source list". But `classify` returns
   * a non-null value for TWO different facts and only one of them is membership: it returns
   * FLAGGED_SURPLUS_BY_THE_EXPORT for any surplus-flagged row whoever took it, and it returns
   * AWARDEE_NOT_ON_THE_APPROVED_SOURCE_LIST when the CAGE is blank, because `normaliseCage(null)`
   * is the empty string and the empty string is never in the approved set. So an unread award to
   * the approved source ITSELF, and an unread award whose awardee is not recorded at all, were
   * both published as a named finding that a dealer took a buy on this item.
   *
   * That is a silence and a different fact rendered as the same finding, which is the exact
   * failure the corner sentence was repaired to stop making in the other direction. A blank CAGE
   * is an unread awardee, and it is read here the same way an empty approved-source list is read
   * four lines above: as a silence, never as evidence against the manufacturer.
   *
   * Latency, stated rather than assumed: MEASURED on 2026-08-18, 0 of 42,698 live rows are undated
   * or unpriced and 0 carry a blank CAGE, so none of this can fire from today's export and all of
   * it is one feed revision from firing.
   */
  type UnreadBucket =
    | 'FLAGGED_SURPLUS'
    | 'AWARDEE_UNREAD'
    | 'NOT_ON_THE_APPROVED_SOURCE_LIST'
    | 'ON_THE_APPROVED_SOURCE_LIST'
    | 'UNCLASSIFIABLE_WITHOUT_A_LIST'

  const bucketUnread = (a: DossierAward): UnreadBucket => {
    if (isFlaggedSurplus(a)) return 'FLAGGED_SURPLUS'
    if (cages.size === 0) return 'UNCLASSIFIABLE_WITHOUT_A_LIST'
    if (normaliseCage(a.awardeeCage) === '') return 'AWARDEE_UNREAD'
    return cages.has(normaliseCage(a.awardeeCage))
      ? 'ON_THE_APPROVED_SOURCE_LIST'
      : 'NOT_ON_THE_APPROVED_SOURCE_LIST'
  }
  const countUnread = (b: UnreadBucket): number =>
    unread.filter((a) => bucketUnread(a) === b).length
  const unreadToANonSource = countUnread('NOT_ON_THE_APPROVED_SOURCE_LIST')
  const unreadFlaggedSurplus = countUnread('FLAGGED_SURPLUS')
  const unreadAwardeeUnread = countUnread('AWARDEE_UNREAD')

  /*
   * NO PRICED ROW IS NOT A CORNER, AND THIS ARM EXISTS SO IT CANNOT BE READ AS ONE.
   *
   * Everything below classifies PRICED awards. Without this branch, a stock number whose awards
   * all carry a null or zero price falls through to NO_SECONDARY_AWARD_ON_FILE and the surface
   * prints "the manufacturer has taken every recorded buy" over a file that has attributed no buy
   * to anybody. MEASURED on 2026-08-18: 0 of 42,698 live award rows carry a non-positive price, so
   * this is unreachable from today's feed and one feed revision from being reachable. The type
   * already says the row can be silent (`effectiveUnitPriceUsd: number | null`), and a claim that
   * depends on a field never being null is a claim waiting to become false.
   */
  if (priced.length === 0) {
    return {
      figureId: 'RECENT_FLIP_BAND',
      label: FLIP_LABEL,
      resolved: false,
      reason: 'NO_PRICED_AWARD_ON_FILE',
      missingInput: 'an award row carrying a positive unit price and an award date',
      sentence:
        `${input.awards.length} award(s) are on file for this stock number and not one of them ` +
        'carries a price this band can read. ' +
        (withoutAPrice.length > 0 ? `${withoutAPrice.length} carry no price at all. ` : '') +
        (pricedButUndated.length > 0
          ? `${pricedButUndated.length} carry a price with no award date, so it cannot be placed in ` +
            'or out of a window. '
          : '') +
        'No buy on this item has been attributed to anyone, so nothing here says who is supplying ' +
        'it. This is a silence in the price columns and it is NOT a finding that the manufacturer ' +
        'holds the item.',
    }
  }

  if (secondaryAll.length === 0 && cages.size === 0) {
    return {
      figureId: 'RECENT_FLIP_BAND',
      label: FLIP_LABEL,
      resolved: false,
      reason: 'CANNOT_CLASSIFY_SECONDARY_WITHOUT_AN_APPROVED_SOURCE_LIST',
      missingInput: 'the approved-source list (the export MCRL sheet) for this stock number',
      sentence:
        'No award on file is flagged as surplus and the export names no approved source, so no ' +
        'award can be attributed to a dealer rather than to the manufacturer. An empty ' +
        'approved-source list is a silence, and it is not read here as "every awardee is a dealer".',
    }
  }

  const inWindow = secondaryAll
    .filter((a) => {
      const t = Date.parse(a.awardDateIso as string)
      return Number.isFinite(t) && t >= windowStartMs && t <= input.atInstantMs
    })
    .sort((a, b) => (a.awardDateIso ?? '').localeCompare(b.awardDateIso ?? ''))

  if (secondaryAll.length === 0) {
    /*
     * Distinct from the window abstention below, and the distinction is the finding. "No resale
     * award is recent enough" and "every award on file went to the approved source" say opposite
     * things about an item: the second is the shape of a corner, and reporting it as a window
     * problem would bury it.
     */
    /*
     * THE CORNER SENTENCE IS THE LOUDEST COMMERCIAL CLAIM ON THIS SURFACE, SO IT IS SCOPED TO
     * WHAT WAS ACTUALLY LOOKED AT.
     *
     * `secondaryAll` is filtered out of `priced`, so this arm has only ever examined awards
     * carrying a price. "Every recorded buy" was therefore a claim about rows this branch never
     * read. Unpriced rows are counted out loud instead, and when one of them went to a company
     * that is not on the approved-source list the sentence says the corner is contradicted rather
     * than leaving the reader to notice.
     */
    /*
     * Each count is printed under its own name and only the membership count licenses the
     * attribution. A surplus flag is a statement about the MATERIAL, not about who took the award,
     * so it is reported as what it is and it does not become "a buy went to a dealer".
     */
    const unreadBreakdown =
      (unreadToANonSource > 0
        ? `${unreadToANonSource} of them went to a company that is not on the approved-source ` +
          'list. '
        : '') +
      (unreadFlaggedSurplus > 0
        ? `${unreadFlaggedSurplus} of them ${unreadFlaggedSurplus === 1 ? 'was' : 'were'} flagged ` +
          'as surplus by the export, which describes the material and not the awardee. '
        : '') +
      (unreadAwardeeUnread > 0
        ? `${unreadAwardeeUnread} of them ${unreadAwardeeUnread === 1 ? 'carries' : 'carry'} no ` +
          'awardee CAGE, so who took them is unread and they are attributed to nobody. '
        : '')

    const unreadNote =
      unread.length === 0
        ? ' On this item the manufacturer has taken every priced buy on file, and every award on ' +
          'file carries a price, so that covers every recorded buy.'
        : unreadToANonSource > 0
          ? ` ${unread.length} further award(s) were not read here, because they carry no price or ` +
            `no award date. ${unreadBreakdown}So this is NOT a corner: a recorded buy on this item ` +
            'went to a company that is not on the approved-source list and only its price is ' +
            'missing.'
          : ` On this item the manufacturer has taken every priced buy on file. ${unread.length} ` +
            'further award(s) were not read here, because they carry no price or no award date. ' +
            `${unreadBreakdown}They are attributed to nobody and they are not covered by that ` +
            'sentence.'
    return {
      figureId: 'RECENT_FLIP_BAND',
      label: FLIP_LABEL,
      resolved: false,
      reason: 'NO_SECONDARY_AWARD_ON_FILE',
      missingInput: 'a priced award to a company that is not on the approved-source list',
      sentence:
        'Every priced award on file went to a company on the approved-source list and none is ' +
        'flagged as surplus, so there is no secondary market to read a band from.' +
        unreadNote,
    }
  }

  if (inWindow.length === 0) {
    const outside = secondaryAll.length
    const oldest = secondaryAll
      .map((a) => a.awardDateIso as string)
      .sort()
      .at(0)
    return {
      figureId: 'RECENT_FLIP_BAND',
      label: FLIP_LABEL,
      resolved: false,
      reason: 'NO_SECONDARY_AWARD_IN_THE_WINDOW',
      missingInput: `a secondary-market award dated inside the ${windowMonths} month window ending ${isoDay(
        input.atInstantMs,
      )}`,
      sentence:
        `No resale award falls inside the ${windowMonths} month window ending ` +
        `${isoDay(input.atInstantMs)}. ${outside} resale award(s) sit outside it` +
        `${oldest ? `, the earliest dated ${oldest}` : ''}. They are not stretched into the band: ` +
        'a range formed over an unstated window is not a band, it is a shape.',
    }
  }

  /*
   * THE BAND RUNS THE SAME PRICE-COLUMN CHECK THE ANCHOR RUNS, AND FOR THE SAME REASON.
   *
   * A band endpoint is not a soft number. The low end is what a bidder undercuts and the high end
   * is what the gap against the anchor is measured from, so a fabricated endpoint moves a quote
   * directly. The check is applied AFTER the window filter, deliberately: the counts the two
   * abstentions above report ("resale awards exist, none recent enough") are about attribution and
   * dates, and narrowing the pool before them would misreport what is on file.
   *
   * The classification of a row as secondary is untouched by this. WHO took an award is read from
   * the CAGE and the surplus column, neither of which is a price, so a row whose price columns
   * disagree still counts as a resale award for every claim this figure makes about attribution.
   * Only its NUMBER is refused.
   */
  const { agreeing: bandRows, setAside: bandSetAside } = partitionByPriceColumns(inWindow)

  if (bandRows.length === 0) {
    const earliest = earliestSetAsideRow(bandSetAside)
    return {
      figureId: 'RECENT_FLIP_BAND',
      label: FLIP_LABEL,
      resolved: false,
      reason: 'NO_RESALE_AWARD_IN_THE_WINDOW_WHOSE_PRICE_COLUMNS_AGREE',
      missingInput:
        'a resale award inside the window whose Unit Price column and Final Price column agree on ' +
        'what one unit cost',
      sentence:
        `${inWindow.length} resale award(s) fall inside the ${windowMonths} month window ending ` +
        `${isoDay(input.atInstantMs)}, and not one of them agrees with itself about the unit ` +
        `price. ${setAsideReasonClauses(bandSetAside)}` +
        (earliest === undefined ? '' : `The earliest: ${earliest.check.clause}. `) +
        'A band endpoint is the number a bidder undercuts, so a figure the row itself contradicts ' +
        'cannot be one. Which column is right is not decidable from the row, and picking one would ' +
        'be an estimate rendered as a measurement. This is an abstention and not a zero.',
    }
  }

  const prices = bandRows.map((a) => a.effectiveUnitPriceUsd as number)
  const low = Math.min(...prices)
  const high = Math.max(...prices)
  const lowRow = bandRows.find((a) => a.effectiveUnitPriceUsd === low)
  const highRow = bandRows.find((a) => a.effectiveUnitPriceUsd === high)

  /*
   * Named out loud on the resolved arm, with BOTH figures, exactly as `identifyOemAward` names
   * them. A row silently dropped from a range is a range whose sample count stopped meaning what
   * it says, and the reader cannot see the difference.
   */
  const bandSetAsideNote =
    bandSetAside.length === 0
      ? ''
      : ` ${bandSetAside.length} resale award(s) inside the window were set aside and are NOT in ` +
        `this band, because the row disagrees with itself about the unit price. ${setAsideReasonClauses(
          bandSetAside,
        )}` +
        bandSetAside.map((c) => c.check.clause).join('; ') +
        '. Neither column is preferred: on some rows the stated Unit Price is the truth and on ' +
        'others the division is, so a contradicting row is refused rather than resolved.'

  const observations = bandRows.map(
    (a): FlipObservation => ({
      awardDateIso: a.awardDateIso as string,
      unitPriceUsd: a.effectiveUnitPriceUsd as number,
      awardeeCompany: a.awardeeCompany,
      awardeeCage: a.awardeeCage,
      whyCountedAsSecondary: classify(a) as FlipObservation['whyCountedAsSecondary'],
    }),
  )

  return {
    figureId: 'RECENT_FLIP_BAND',
    label: FLIP_LABEL,
    resolved: true,
    evidenceState: 'MEASURED',
    lowUnitPriceUsd: low,
    highUnitPriceUsd: high,
    sampleCount: bandRows.length,
    windowMonths,
    windowStartIso: isoDay(windowStartMs),
    windowEndIso: isoDay(input.atInstantMs),
    observations,
    arithmetic:
      `low ${money(low)} (${lowRow?.awardDateIso ?? 'undated'}, ${
        lowRow?.awardeeCompany ?? lowRow?.awardeeCage ?? 'unnamed awardee'
      }) to high ${money(high)} (${highRow?.awardDateIso ?? 'undated'}, ${
        highRow?.awardeeCompany ?? highRow?.awardeeCage ?? 'unnamed awardee'
      }) across ${bandRows.length} resale award(s) in the ${windowMonths} months to ${isoDay(
        input.atInstantMs,
      )}${
        bandSetAside.length === 0
          ? ''
          : `, with ${bandSetAside.length} further in-window award(s) set aside as ` +
            'self-contradicting'
      }`,
    inputs: [
      {
        label: 'Resale awards in window',
        renderedValue:
          `${bandRows.length} of ${secondaryAll.length} priced resale awards on file` +
          (bandSetAside.length === 0
            ? ''
            : `, after ${bandSetAside.length} in-window row(s) were set aside for contradicting ` +
              'themselves on the unit price'),
        evidenceState: 'MEASURED',
        source: 'NSN-Now Batch Export, Procurement sheet, rows not attributed to an approved source or flagged surplus',
        citation: null,
      },
      {
        label: 'Window length',
        renderedValue: `${windowMonths} months`,
        evidenceState: 'PRIOR',
        source:
          'Our chosen recency window, not a regulation. DLAD 17.7505 measures over twelve months, ' +
          'which is too thin to form a band on most items in this corpus.',
        citation: null,
      },
    ],
    limitation:
      'CONTAMINATED BY CONSTRUCTION and never a recommendation. These are prices a dealer paid or ' +
      'charged to move existing stock, which is the behaviour this product exists to detect. The ' +
      'band is here so the gap between it and the anchor is visible, because that gap is where the ' +
      'margin comes from. Quoting inside it hands the margin back. Every price in it was read off ' +
      'a row whose Unit Price column and Final Price column agree with each other to within a ' +
      'cent, so no endpoint here is a figure its own row contradicts.' +
      bandSetAsideNote,
  }
}

/* ------------------------------------------------------------------------------------ */
/* FIGURE 3: THE EVALUATED PRICE                                                          */
/* ------------------------------------------------------------------------------------ */

const EVALUATED_LABEL = 'Evaluated price: what the buyer compares, never what we send'

function buildEvaluatedFigure(
  input: QuoteViewInput,
  basis: PricingBasis,
  config: PricingConfig,
): EvaluatedPriceFigure {
  if (basis.kind === 'NONE') {
    return {
      figureId: 'EVALUATED_PRICE',
      label: EVALUATED_LABEL,
      resolved: false,
      reason: 'NO_BASIS_UNIT_PRICE',
      missingInput: basis.missingInput,
      sentence:
        "The evaluated price is our total plus the buyer's evaluation factors, so it needs a " +
        'candidate unit price to add them to. There is none: no anchor was computed and the ' +
        'operator has proposed no price.',
    }
  }

  const quantity = input.solicitationQuantity
  if (quantity === null || !(quantity > 0)) {
    return {
      figureId: 'EVALUATED_PRICE',
      label: EVALUATED_LABEL,
      resolved: false,
      reason: 'SOLICITATION_QUANTITY_ABSENT',
      missingInput: 'the quantity on the live requirement',
      sentence:
        'The evaluation factors are flat amounts on the TOTAL, not per unit, so their weight ' +
        'depends entirely on the quantity. On a one-unit buy the surplus factor alone can be two ' +
        'thirds of the line. Without a quantity the evaluated figure cannot be formed, and ' +
        'assuming one unit would understate the total on every multi-unit line.',
    }
  }

  /*
   * THE TWO DECLARATIONS THAT CANNOT BE GUESSED. Both describe what WE would offer, and nothing
   * in a government feed answers either. Reading an undeclared value as false omits an applicable
   * factor, which understates the number the buyer compares us on and loses the award while every
   * figure on screen looks right. So the abstention names the two questions, and a page turns
   * them into two controls rather than into a default.
   */
  const surplusOffer = input.offeringUnusedFormerGovernmentSurplus
  if (surplusOffer === undefined || surplusOffer === null) {
    return {
      figureId: 'EVALUATED_PRICE',
      label: EVALUATED_LABEL,
      resolved: false,
      reason: 'SURPLUS_OFFER_STATUS_UNDECLARED',
      missingInput:
        'whether the material we would offer is unused former Government surplus (a $200 evaluation factor)',
      sentence:
        'Nobody has stated whether this offer would be unused former Government surplus. That is a ' +
        'fact about our own material and no government file answers it. Treating the silence as ' +
        '"no" would drop a $200 factor the buyer will add anyway, so no evaluated figure is shown ' +
        'until it is declared.',
    }
  }

  const esaCount = input.esaCoordinationCount
  if (esaCount === undefined || esaCount === null) {
    return {
      figureId: 'EVALUATED_PRICE',
      label: EVALUATED_LABEL,
      resolved: false,
      reason: 'ESA_COORDINATION_COUNT_UNDECLARED',
      missingInput: 'how many Engineering Support Activities must coordinate on this item ($600 each)',
      sentence:
        'The ESA coordination count has not been stated. Zero and unknown are different facts, and ' +
        'a silent zero here understates the evaluated price by $600 for every ESA that turns out ' +
        'to apply.',
    }
  }

  const quoted = quotedTotal(basis.unitPriceUsd, quantity)
  const outcome = evaluatedTotal(
    quoted,
    {
      isUnusedFormerGovernmentSurplus: surplusOffer,
      esaCoordinationCount: esaCount,
      ...(input.buyAmericanOrBalanceOfPayments === true
        ? { buyAmericanOrBalanceOfPayments: true as const }
        : {}),
    },
    config,
    input.atInstantMs,
  )

  if (outcome.kind === 'EVALUATED_TOTAL_ABSTENTION') {
    return {
      figureId: 'EVALUATED_PRICE',
      label: EVALUATED_LABEL,
      resolved: false,
      reason: 'ENGINE_ABSTAINED',
      missingInput: 'a dated evaluation factor covering the pricing instant',
      sentence: outcome.detail,
    }
  }

  /*
   * A price the operator typed is PRIOR, not MEASURED. It is their judgement about what to bid
   * and no file on earth states it. Grading it MEASURED because the $200 factor beside it came
   * from the Master Solicitation would launder the operator's own guess into a government
   * reading, on the one screen where that matters most.
   */
  const basisState: QuoteEvidenceState = basis.kind === 'OPERATOR_PROPOSED' ? 'PRIOR' : 'ESTIMATED'

  const commonInputs: readonly FigureInput[] = [
    {
      label: 'Basis unit price',
      renderedValue: money(basis.unitPriceUsd),
      evidenceState: basisState,
      source:
        basis.kind === 'OPERATOR_PROPOSED'
          ? 'Typed by the operator on this screen.'
          : `The ${basis.indexKind === 'cpi' ? 'CPI' : 'DoD procurement'} anchor line, used as a stated basis. ${BASIS_NOT_A_RECOMMENDATION}`,
      citation: null,
    },
    {
      label: 'Quantity',
      renderedValue: String(quantity),
      evidenceState: 'MEASURED',
      source: 'The solicitation row in the daily index.',
      citation: null,
    },
    {
      label: 'Unused former Government surplus offer',
      renderedValue: surplusOffer ? 'yes, the $200 factor applies' : 'no, declared by the operator',
      evidenceState: 'MEASURED',
      source: 'Declared by the operator. No government file states what we would offer.',
      citation: null,
    },
    {
      label: 'ESA coordinations',
      renderedValue: `${esaCount} at $600 each`,
      evidenceState: 'MEASURED',
      source: 'Declared by the operator.',
      citation: null,
    },
  ]

  const adderLines = outcome.adders.map(
    (a): EvaluatedAdderLine => ({
      code: a.code,
      unitAmountUsd: a.unitAmountUsd,
      appliedCount: a.appliedCount,
      subtotalUsd: a.subtotalUsd,
      citation: a.citation,
      laterAmendmentsUnverified: a.laterAmendmentsUnverified,
    }),
  )

  const adderText = adderLines
    .map((a) => `+ ${money(a.unitAmountUsd)} x ${a.appliedCount} (${a.code})`)
    .join(' ')

  const quoteArithmetic = `${money(basis.unitPriceUsd)} x ${quantity} = ${money(
    quoted.totalUsd,
  )} quoted`

  const automatedNote =
    input.automatedSolicitation === true
      ? ' The solicitation carries T or U in its ninth position, so an alternate or surplus offer cannot win this instant buy however the evaluated price lands.'
      : input.automatedSolicitation === null
        ? ' The ninth character of the solicitation number did not parse, so whether an alternate offer can win is unread here.'
        : ''

  const sharedLimitation =
    'The evaluation factors are added BY THE BUYER to our total to form the number it compares ' +
    'against competitors. They are not part of the price we send and they are not a cost we pay. ' +
    'Adding them to the quote would overprice every offer and would lose exactly the low-value ' +
    'lines where the factor already dominates.' +
    automatedNote

  if (outcome.kind === 'EVALUATED_FLOOR_AT_LEAST') {
    return {
      figureId: 'EVALUATED_PRICE',
      label: EVALUATED_LABEL,
      resolved: true,
      kind: 'FLOOR',
      evidenceState: weakestEvidenceState(basisState, 'MEASURED'),
      quotedTotal: { kind: 'QUOTED_TOTAL_WHAT_WE_SEND', usd: outcome.quotedTotalUsd },
      evaluatedFloor: {
        kind: 'EVALUATED_FLOOR_THE_TRUE_FIGURE_IS_HIGHER',
        atLeastUsd: outcome.atLeastUsd,
      },
      adders: adderLines,
      unpricedFactorCodes: outcome.unpricedFactors.map((f) => f.code),
      directionOfError: 'ACTUAL_IS_HIGHER_THAN_THIS',
      arithmetic: `${quoteArithmetic}; ${adderText} = at least ${money(
        outcome.atLeastUsd,
      )} evaluated`,
      basis,
      inputs: commonInputs,
      limitation: `${outcome.sentence} ${sharedLimitation}`,
    }
  }

  return {
    figureId: 'EVALUATED_PRICE',
    label: EVALUATED_LABEL,
    resolved: true,
    kind: 'TOTAL',
    evidenceState: weakestEvidenceState(basisState, 'MEASURED'),
    quotedTotal: { kind: 'QUOTED_TOTAL_WHAT_WE_SEND', usd: outcome.quotedTotalUsd },
    evaluatedTotal: {
      kind: 'EVALUATED_TOTAL_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND',
      usd: outcome.evaluatedTotalUsd,
    },
    adders: adderLines,
    adderTotalUsd: outcome.adderTotalUsd,
    arithmetic:
      adderLines.length === 0
        ? `${quoteArithmetic}; no evaluation factor applies, so the evaluated total equals the quoted total at ${money(
            outcome.evaluatedTotalUsd,
          )}`
        : `${quoteArithmetic}; ${adderText} = ${money(outcome.evaluatedTotalUsd)} evaluated`,
    basis,
    inputs: commonInputs,
    limitation: sharedLimitation,
  }
}

/* ------------------------------------------------------------------------------------ */
/* FIGURE 4: THE TRIPWIRE BAND                                                            */
/* ------------------------------------------------------------------------------------ */

const TRIPWIRE_LABEL = 'Tripwire band: whether this price stays on the automated pathway'

function buildTripwireFigure(
  input: QuoteViewInput,
  basis: PricingBasis,
  config: PricingConfig,
): TripwireBandFigure {
  if (basis.kind === 'NONE') {
    return {
      figureId: 'TRIPWIRE_BAND',
      label: TRIPWIRE_LABEL,
      resolved: false,
      reason: 'NO_BASIS_UNIT_PRICE',
      missingInput: basis.missingInput,
      sentence:
        'The tripwire measures a proposed price against the most recent prior price. With no ' +
        'candidate price there is nothing to measure.',
    }
  }

  const quantity = input.solicitationQuantity
  if (quantity === null || !(quantity > 0)) {
    return {
      figureId: 'TRIPWIRE_BAND',
      label: TRIPWIRE_LABEL,
      resolved: false,
      reason: 'SOLICITATION_QUANTITY_ABSENT',
      missingInput: 'the quantity on the live requirement',
      sentence:
        'Which band applies depends on whether the procurement is valued under the micro-purchase ' +
        'threshold, and that is unit price times quantity. Without a quantity the band cannot be ' +
        'chosen, and choosing the wrong one moves the threshold from 25 percent to 51 percent.',
    }
  }

  const priorRows = input.awards
    .filter(
      (a) => a.awardDateIso !== null && a.effectiveUnitPriceUsd !== null && a.effectiveUnitPriceUsd > 0,
    )
    .sort((a, b) => (a.awardDateIso ?? '').localeCompare(b.awardDateIso ?? ''))
  const prior = priorRows.at(-1)
  if (prior === undefined) {
    return {
      figureId: 'TRIPWIRE_BAND',
      label: TRIPWIRE_LABEL,
      resolved: false,
      reason: 'NO_PRIOR_AWARD_WITH_A_PRICE',
      missingInput: 'a dated prior award carrying a positive unit price',
      sentence:
        'DLAD 17.7505 measures an increase over a prior price, and no dated priced award is on ' +
        'file for this item. Reporting the band as uncrossed would be a fabricated all-clear.',
    }
  }

  /*
   * THE SAME CHECK, ON THE ONE ROW THIS FIGURE IS ENTIRELY A FUNCTION OF.
   *
   * MEASURED over the live feed on 2026-08-18, driving the view with an operator-typed price so
   * the tripwire resolves the way it does in ordinary use: 1,531 stock numbers resolve a tripwire
   * and 7 of them measure against a row that contradicts itself. On NSN 2940-01-535-9467 the
   * CROSSED verdict flips on which column you believe: the derived $24.33 gives 311.0% and
   * CROSSED, the row's own stated Unit Price of $81.11 gives 23.3% and NOT crossed. That is the
   * whole operational conclusion of the figure, and it was shipping graded MEASURED.
   *
   * IT ABSTAINS RATHER THAN WALKING BACK TO AN OLDER CLEAN ROW, and that is the substantive
   * choice here. DLAD 17.7505 measures against the MOST RECENT prior price. Substituting an
   * earlier award would answer a different question under the same label, and it would answer it
   * in the permissive direction: an older, lower prior price makes the increase look larger and
   * an older, higher one manufactures an all-clear the real most-recent price would have crossed.
   * When the row the regulation points at is unreadable, the honest output is that it is
   * unreadable.
   */
  const priorCheck = checkPriceColumns(prior)
  if (!priorCheck.agrees) {
    return {
      figureId: 'TRIPWIRE_BAND',
      label: TRIPWIRE_LABEL,
      resolved: false,
      reason: 'MOST_RECENT_PRIOR_AWARD_CONTRADICTS_ITSELF_ON_PRICE',
      missingInput:
        'a most recent prior award whose Unit Price column and Final Price column agree on what ' +
        'one unit cost',
      sentence:
        `The most recent dated priced award is ${priorCheck.clause}. DLAD 17.7505 measures the ` +
        'increase against the MOST RECENT prior price, so this is the one row the band is a ' +
        'function of, and which of its two columns is the unit price is not decidable from the ' +
        'row. An earlier award is not substituted: that would answer a different question under ' +
        'the same label, and reporting the band as uncrossed off a figure the row contradicts ' +
        'would be a fabricated all-clear. This is an abstention and not a zero.',
    }
  }

  const outcome = tripwireBand(
    {
      proposedUnitPriceUsd: basis.unitPriceUsd,
      mostRecentPriorUnitPriceUsd: prior.effectiveUnitPriceUsd as number,
      mostRecentPriorPriceInstantMs: Date.parse(prior.awardDateIso as string),
      atInstantMs: input.atInstantMs,
      procurementValueUsd: basis.unitPriceUsd * quantity,
    },
    config,
  )

  if (!outcome.assessed) {
    return {
      figureId: 'TRIPWIRE_BAND',
      label: TRIPWIRE_LABEL,
      resolved: false,
      reason: outcome.reason,
      missingInput:
        outcome.reason === 'PRIOR_PRICE_OUTSIDE_TRAILING_12_MONTHS'
          ? `an award dated inside the twelve months ending ${isoDay(input.atInstantMs)}; the most recent one is dated ${prior.awardDateIso}`
          : 'a dated threshold and band covering the pricing instant',
      sentence: outcome.detail,
    }
  }

  // Same reading as the evaluated figure: a typed price is the operator's judgement, not a file.
  const basisState: QuoteEvidenceState = basis.kind === 'OPERATOR_PROPOSED' ? 'PRIOR' : 'ESTIMATED'
  const priorUnit = prior.effectiveUnitPriceUsd as number

  return {
    figureId: 'TRIPWIRE_BAND',
    label: TRIPWIRE_LABEL,
    resolved: true,
    evidenceState: weakestEvidenceState(basisState, 'MEASURED'),
    impliedIncreasePercent: outcome.impliedIncreasePercent,
    impliedMultipleOfPrior: outcome.impliedMultipleOfPrior,
    band: outcome.band,
    bandThresholdPercent: outcome.bandThresholdRatio * 100,
    crossed: outcome.crossed,
    microPurchaseThresholdUsd: outcome.microPurchaseThresholdUsd,
    consequence: outcome.consequence,
    arithmetic:
      `(${money(basis.unitPriceUsd)} - ${money(priorUnit)}) / ${money(priorUnit)} = ` +
      `${outcome.impliedIncreasePercent.toFixed(1)}% increase, ` +
      `${outcome.impliedMultipleOfPrior.toFixed(2)}x the prior award of ${prior.awardDateIso}; ` +
      `band is ${outcome.bandThresholdRatio * 100}% because the procurement at ${money(
        basis.unitPriceUsd * quantity,
      )} is ${outcome.band === 'UNDER_MPT_51_PERCENT' ? 'under' : 'at or above'} the ` +
      `micro-purchase threshold of ${money(outcome.microPurchaseThresholdUsd)}; ` +
      `${outcome.crossed ? 'CROSSED' : 'not crossed'}`,
    basis,
    inputs: [
      {
        label: 'Most recent prior award unit price',
        renderedValue: `${money(priorUnit)} on ${prior.awardDateIso}`,
        evidenceState: 'MEASURED',
        source:
          'NSN-Now Batch Export, Procurement sheet, latest dated priced row. Its Unit Price column ' +
          'and its Final Price column agree on this figure to within a cent, so it is a reading ' +
          'and not a division the row contradicts.',
        citation: null,
      },
      {
        label: 'Micro-purchase threshold in force at the pricing instant',
        renderedValue: money(outcome.microPurchaseThresholdUsd),
        evidenceState: 'MEASURED',
        source: outcome.thresholdResolution.entry.citation.authority,
        citation: outcome.thresholdResolution.entry.citation,
      },
      {
        label: 'Band',
        renderedValue: `${outcome.bandThresholdRatio * 100}%`,
        evidenceState: 'MEASURED',
        source: outcome.bandCitation.authority,
        citation: outcome.bandCitation,
      },
    ],
    bandCitation: outcome.bandCitation,
    limitation:
      'Crossing the band does NOT cap the price and does NOT make the award illegal. It forces an ' +
      'email notification to the Head of the Contracting Activity and retention of that message in ' +
      'the contract file, which turns an automated award into one carrying senior attention, delay ' +
      'and paperwork. Price the delay into the decision, not into the quote.' +
      (outcome.laterAmendmentsUnverified
        ? ' The pricing instant is later than the primary text on file has been read through, so re-verify the controlling threshold before quoting this externally.'
        : ''),
  }
}

/* ------------------------------------------------------------------------------------ */
/* THE BUILDER                                                                            */
/* ------------------------------------------------------------------------------------ */

/**
 * Build the four-figure view a quote screen consumes.
 *
 * Reads as a sequence of refusals on purpose, exactly like the shelf valuation it sits beside.
 * Each abstention is a place where a confident number was available and would have been wrong.
 */
export function buildQuoteView(input: QuoteViewInput): QuoteView {
  const indices = input.indices ?? INDEX_CONFIG_1650
  const config = input.config ?? PRICING_CONFIG
  const windowMonths = input.flipWindowMonths ?? DEFAULT_FLIP_WINDOW_MONTHS

  const oem = identifyOemAward(input)
  const anchor = buildAnchorFigure(input, oem, indices)

  const proposed = input.proposedUnitPriceUsd
  const preferredLine =
    anchor.resolved === true ? anchor.lines.find((l) => l.preferred) ?? anchor.lines[0] : undefined

  const basis: PricingBasis =
    proposed !== undefined && proposed !== null && proposed > 0
      ? {
          kind: 'OPERATOR_PROPOSED',
          unitPriceUsd: proposed,
          note: `Typed by the operator. ${BASIS_NOT_A_RECOMMENDATION}`,
        }
      : preferredLine !== undefined
        ? {
            kind: 'ANCHOR_PREFERRED_INDEX',
            unitPriceUsd: preferredLine.unitPriceUsd,
            indexKind: preferredLine.indexKind,
            note: `The preferred anchor line, used so the dependent figures can be audited. ${BASIS_NOT_A_RECOMMENDATION}`,
          }
        : {
            kind: 'NONE',
            missingInput:
              'either a unit price typed by the operator, or an anchor, which needs a manufacturer ' +
              'award and an inflation factor for its year',
            note: BASIS_NOT_A_RECOMMENDATION,
          }

  const figures: readonly [
    AnchorFigure,
    RecentFlipBandFigure,
    EvaluatedPriceFigure,
    TripwireBandFigure,
  ] = [
    anchor,
    buildFlipBandFigure(input, windowMonths),
    buildEvaluatedFigure(input, basis, config),
    buildTripwireFigure(input, basis, config),
  ]

  const anchorUnitPrices = anchor.resolved === true ? anchor.lines.map((l) => l.unitPriceUsd) : []
  const anchorExactPrices = anchor.resolved === true ? anchor.lines.map((l) => l.exactUnitPriceUsd) : []

  const recordedObservations = recordedObservationSeedsForNsn(input.nsn).map(
    (seed): RecordedQuoteObservation => {
      const reproduced =
        anchorUnitPrices.includes(seed.valueUsd) || anchorExactPrices.includes(seed.valueUsd)
      const coefficient = oem.identified ? seed.valueUsd / oem.unitPriceUsd : null
      return {
        label: seed.label,
        valueUsd: seed.valueUsd,
        derivationStatedBySource: seed.derivationStatedBySource,
        evidenceState: 'PRIOR',
        citation: seed.citation,
        reproducedByAnchor: reproduced,
        reproductionCheck: reproduced
          ? `An anchor line equals ${money(seed.valueUsd)}. Check this: the recorded figure is ` +
            'not an anchor output, so a match means the anchor configuration changed.'
          : coefficient === null
            ? `The anchor abstained for this item, so it produces no figure at all and certainly ` +
              `not ${money(seed.valueUsd)}.`
            : `Neither anchor line equals ${money(seed.valueUsd)}. Reaching it from the ` +
              `manufacturer award of ${money(oem.identified ? oem.unitPriceUsd : 0)} needs a factor of ` +
              `${coefficient.toFixed(6)}, which is neither configured factor nor their product.`,
        note: seed.note,
      }
    },
  )

  const gaps: string[] = []
  if (!oem.identified) gaps.push(`manufacturer award not identified: ${oem.missingInput}`)
  for (const f of figures) {
    if (f.resolved === false) gaps.push(`${f.figureId} abstained (${f.reason}): ${f.missingInput}`)
  }
  if (input.automatedSolicitation === null) {
    gaps.push(
      'the ninth character of the solicitation number did not parse, so whether an alternate offer ' +
        'can win this buy is unread',
    )
  }

  return {
    nsn: input.nsn,
    atInstantMs: input.atInstantMs,
    oemAward: oem,
    basis,
    figures,
    recordedObservations,
    doctrineNotice: DOCTRINE_NOTICE,
    gaps,
  }
}

/* ------------------------------------------------------------------------------------ */
/* THE INVARIANT                                                                          */
/* ------------------------------------------------------------------------------------ */

/** Every number anywhere in a payload, so a value check does not degrade into a text search. */
function* everyNumberIn(value: unknown, seen = new Set<unknown>()): Generator<number> {
  if (typeof value === 'number') {
    yield value
    return
  }
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  for (const child of Object.values(value as Record<string, unknown>)) {
    yield* everyNumberIn(child, seen)
  }
}

/** Any key on a rendered payload matching this is a blended headline number by another name. */
const HEADLINE_KEY = /headline|recommendedquote|recommended_quote|blended|singlenumber|thenumber/i

/**
 * Throws unless the view still shows FOUR separate figures with no blended headline.
 *
 * Exported rather than kept in a test because the constraint is on what a SCREEN renders, and a
 * page-level test needs the same check. It is written to fail on the specific shapes a collapse
 * takes: fewer than four figures, a duplicated figure id, a scalar unit price on the anchor
 * (which would mean CPI and DoD were merged), and any key that reads as a single recommended
 * number. The mean of the two anchor lines is also searched for in the serialised payload,
 * because a blend that leaked in anywhere would carry that exact value.
 */
export function assertFourSeparateFigures(view: QuoteView): void {
  const figures = view.figures as readonly { figureId: QuoteFigureId }[]
  if (figures.length !== QUOTE_FIGURE_IDS.length) {
    throw new Error(
      `The quote view must carry exactly ${QUOTE_FIGURE_IDS.length} figures, found ${figures.length}. ` +
        'Collapsing them into one recommended number is the thing the doctrine forbids.',
    )
  }
  const ids = figures.map((f) => f.figureId)
  for (const [i, expected] of QUOTE_FIGURE_IDS.entries()) {
    if (ids[i] !== expected) {
      throw new Error(
        `Figure ${i} must be ${expected}, found ${String(ids[i])}. The four figures answer ` +
          'different questions and their order is part of the contract.',
      )
    }
  }

  for (const key of Object.keys(view)) {
    if (HEADLINE_KEY.test(key)) {
      throw new Error(
        `The quote view carries "${key}", which reads as a single recommended number. Four ` +
          'separately visible figures, no blend, unless the owner rules otherwise explicitly.',
      )
    }
  }

  const anchor = view.figures[0]
  if (anchor.resolved === true) {
    if (anchor.lines.length !== 2) {
      throw new Error(
        `The anchor must carry exactly two index lines, found ${anchor.lines.length}. One line ` +
          'means CPI and DoD procurement were merged.',
      )
    }
    const [cpi, dod] = anchor.lines
    if (cpi.indexKind === dod.indexKind) {
      throw new Error(
        `Both anchor lines report the index "${cpi.indexKind}". The two must stay distinct and ` +
          'labelled, because which index produced a figure is what makes it defensible.',
      )
    }
    if (Object.prototype.hasOwnProperty.call(anchor, 'unitPriceUsd')) {
      throw new Error(
        'The anchor figure carries a scalar unitPriceUsd. There is no single anchor price: a ' +
          'caller must name the index it is rendering.',
      )
    }
    /*
     * A blend, if one ever leaked in, carries the exact mean of the two lines. This walks the
     * payload for that VALUE rather than searching the serialised text for its digits: a
     * substring search matches "2093.24" inside a legitimate 12093.24 and would throw on a
     * correct view, and a guard that cries wolf gets deleted within a week.
     *
     * WHICH IS EXACTLY WHY THE MEAN IS DISCARDED WHEN IT IS ALSO A LINE'S OWN VALUE.
     *
     * The mean of two EQUAL numbers is that number, so when both indices carry the same factor
     * every legitimate rendering of either line equals the "blend" and the guard would throw on a
     * correct view. That is not a freak coincidence: two published series printing the same
     * reading for one year is ordinary, and moving these factors onto published series is the
     * migration the anchor's own abstention asks for. The same collision arrives a second way,
     * when two lines differ but round to the same cent, because then the cent-rounded mean equals
     * both lines' cent-rounded prices. Both shapes are covered by one rule: a candidate value that
     * IS one of the two line values carries no information about blending, so it is not evidence
     * of one. When the lines genuinely differ the mean is neither of them and the guard keeps
     * every tooth it had.
     *
     * THE COST, STATED RATHER THAN HIDDEN: on a view whose two lines are identical this check can
     * no longer detect a blend, because a blend of two identical prices IS that price and no test
     * of any kind can tell them apart. That is a limit of the arithmetic, not a hole in the guard,
     * and every other branch above (four figures, their order, two distinct index kinds, no scalar
     * anchor price, no headline key) still runs on that view.
     */
    const lineValues = new Set<number>([
      cpi.exactUnitPriceUsd,
      cpi.unitPriceUsd,
      dod.exactUnitPriceUsd,
      dod.unitPriceUsd,
    ])
    const blend = (cpi.exactUnitPriceUsd + dod.exactUnitPriceUsd) / 2
    const blendToCents = Math.round(blend * 100) / 100
    const blendValues = [blend, blendToCents].filter((v) => !lineValues.has(v))
    if (blendValues.length > 0) {
      for (const n of everyNumberIn(view)) {
        if (blendValues.includes(n)) {
          throw new Error(
            `The view carries ${n}, the mean of the two anchor lines. A blended figure has leaked ` +
              'into the payload. The two indices are never averaged.',
          )
        }
      }
    }
  }
}
