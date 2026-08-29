/**
 * ACTIONABILITY — is this row something the operator can actually DO anything with?
 *
 * ==========================================================================================
 * WHY THIS EXISTS
 * ==========================================================================================
 * David, 2026-08-29: "if the opportunity truly is not available to us ... that does not even need
 * to be in our face in any way ... we are in this for efficiency, value, and action. If the first
 * half of the 10 we click on do not even open for some sort of error or lack of data, I do not
 * want to see that in my face."
 *
 * The board's job is not to be complete, it is to be WORKABLE. A row that opens onto a dossier
 * with no price to anchor a quote and no quantity to size one costs the operator a click, a read
 * and a context switch, and returns nothing. Ten of those in a row is how a tool stops being used.
 *
 * ==========================================================================================
 * ⛔ THIS IS A CLASSIFICATION, NOT A DELETION. THREE STATES, AND THE THIRD IS THE IMPORTANT ONE.
 * ==========================================================================================
 *   actionable    positively established that the operator can price and size this buy.
 *   unactionable  positively established that he CANNOT, and the reason is named.
 *   unknown       we could not tell. THE DEFAULT VIEW KEEPS THESE.
 *
 * `unknown` exists because the alternative is a guess, and the guess is expensive in exactly one
 * direction: hiding a live opportunity the operator would have won. So a row is only ever dropped
 * from the default view on POSITIVE evidence that it is dead. Absence of evidence never demotes a
 * row, and `unknown` is never quietly promoted to `actionable` either — it is shown, labelled, and
 * counted as what it is.
 *
 * ==========================================================================================
 * ★ THE DISTINCTION THIS MODULE IS BUILT AROUND: "NOT IN THE INDEX" vs "THE INDEX IS NOT LOADED"
 * ==========================================================================================
 * These look identical at the call site and are opposite facts. If the award index was never
 * loaded, then EVERY row has no award price, and a classifier that reads that as "no price anchor"
 * would mark the ENTIRE BOARD dead and hide all of it behind a toggle. That failure would be
 * total, silent, and would look exactly like a working filter.
 *
 * So `sourcesLoaded.awards` is a REQUIRED input, not an optional hint, and when it is false every
 * row is `unknown` regardless of anything else. `lib/intelligence/scoring/cornerscore.ts` carries
 * the same rule for its legs and for the same reason; this is that rule applied to the row as a
 * whole.
 *
 * ==========================================================================================
 * WHAT IS DELIBERATELY *NOT* CLASSIFIED HERE
 * ==========================================================================================
 * A CLOSED DOOR IS NOT THIS MODULE'S CALL. Locked rows (AMC 4/5, confirmed OEM/licence locks)
 * already have their own control on the board, their own −LOCK_PENALTY, and their own stated
 * reason per row. Classifying them dead here as well would hide the same row behind two different
 * toggles, and an operator who switched one on would still not see it — a confusing non-answer to
 * "why can I not find that part". Lockup stays lockup. This module answers only the DATA question.
 */

/** Why a row was ruled unactionable, or why it could not be ruled on. Machine-readable. */
export type ActionabilityReason =
  /** The operator can anchor a price and size the buy. */
  | 'ready'
  /** No award price on file for this stock number, so no quote can be anchored. */
  | 'no_price_anchor'
  /** The requirement carries no quantity, so the buy cannot be sized. */
  | 'no_quantity'
  /** Neither a price nor a quantity. Nothing to work with at all. */
  | 'no_price_or_quantity'
  /** The award index was not loaded, so nothing about price can be established either way. */
  | 'award_index_not_loaded'

export type ActionabilityVerdict = 'actionable' | 'unactionable' | 'unknown'

export type Actionability = {
  verdict: ActionabilityVerdict
  reason: ActionabilityReason
  /** One operator-facing sentence. Says what is missing, never "this is a bad opportunity". */
  plain: string
}

/**
 * The minimum a row must expose to be classified. Deliberately structural rather than the full
 * row type, so this is callable from a test with a literal and cannot drift with the grid's shape.
 */
export type ActionabilityInput = {
  /** The modeled buy size, or null when it could not be computed. */
  valueUsd: number | null
  /** Solicited quantity, or null when the requirement does not carry one. */
  quantity: number | null
  /** The last recorded award unit price for this stock number, or null when there is none on file. */
  latestPrice: number | null
}

export type SourcesLoaded = {
  /**
   * Whether the NSN award index was loaded AND this board's rows were looked up in it.
   *
   * ⛔ REQUIRED, NOT OPTIONAL. See the module docblock: false here means EVERY row is `unknown`,
   * because otherwise a board with no award index loads and reports every single row as dead.
   */
  awards: boolean
}

/**
 * Classify one row.
 *
 * Order matters: the not-loaded check comes FIRST, because every test below it is only meaningful
 * once we know an absence is a checked absence.
 */
export function classifyActionability(row: ActionabilityInput, sources: SourcesLoaded): Actionability {
  if (!sources.awards) {
    return {
      verdict: 'unknown',
      reason: 'award_index_not_loaded',
      plain:
        'The award index is not loaded here, so whether this row can be priced is unknown. It is shown rather than hidden, because an unchecked absence is not evidence that a corner is dead.',
    }
  }

  const hasPrice = row.latestPrice != null && Number.isFinite(row.latestPrice) && row.latestPrice > 0
  const hasQty = row.quantity != null && Number.isFinite(row.quantity) && row.quantity > 0

  if (!hasPrice && !hasQty) {
    return {
      verdict: 'unactionable',
      reason: 'no_price_or_quantity',
      plain:
        'No award price and no solicited quantity are on file for this stock number, so there is nothing here to anchor or size a quote against.',
    }
  }
  if (!hasPrice) {
    return {
      verdict: 'unactionable',
      reason: 'no_price_anchor',
      plain:
        'No award price is on file for this stock number, so a quote cannot be anchored to anything the government has actually paid.',
    }
  }
  if (!hasQty) {
    return {
      verdict: 'unactionable',
      reason: 'no_quantity',
      plain:
        'The requirement carries no solicited quantity, so the size of this buy cannot be established.',
    }
  }

  /*
   * A modeled value is the PRODUCT of the two facts above, so by this point it is normally
   * present. When it is not, the two inputs disagreed with the scorer about what is computable and
   * that is a state we do not understand — `unknown`, not `actionable`. Promoting a row we cannot
   * explain is exactly the quiet promotion this module refuses to do.
   */
  if (row.valueUsd == null || !Number.isFinite(row.valueUsd)) {
    return {
      verdict: 'unknown',
      reason: 'ready',
      plain:
        'This row carries both a price and a quantity, but no modeled buy size was computed for it, so its size is unknown. It is shown rather than hidden.',
    }
  }

  return {
    verdict: 'actionable',
    reason: 'ready',
    plain: 'A recorded award price and a solicited quantity are both on file, so this buy can be priced and sized.',
  }
}

/**
 * Count a board by verdict. Returned rather than logged, because the toggle that reveals dead rows
 * must carry a COUNT: a silent disappearance is not honest, and a number is the cheapest possible
 * proof to an operator that nothing was thrown away.
 */
export function countActionability(verdicts: readonly ActionabilityVerdict[]): {
  actionable: number
  unactionable: number
  unknown: number
} {
  let actionable = 0
  let unactionable = 0
  let unknown = 0
  for (const v of verdicts) {
    if (v === 'actionable') actionable++
    else if (v === 'unactionable') unactionable++
    else unknown++
  }
  return { actionable, unactionable, unknown }
}

/* ==========================================================================================
 * ⛔ THE SAFETY INTERLOCK. A FILTER THAT WOULD HIDE MOST OF THE BOARD IS NOT FILTERING NOISE,
 *    IT IS REPORTING A BROKEN FEED, AND IT MUST SAY SO INSTEAD OF EMPTYING THE CONSOLE.
 * ==========================================================================================
 * MEASURED 2026-08-29 on the real served board, which is what forced this guard to exist:
 *
 *     rows served 15 · awardsJoined true
 *     actionable    1   ( 6.7%)
 *     unactionable 14   (93.3%)   all of them `no_price_anchor`
 *     unknown       0   ( 0.0%)
 *
 * The classifier is RIGHT about every one of those rows: there genuinely is no award price on
 * file to anchor a quote against. But the cause is not fourteen dead opportunities, it is a live
 * capture that has been paused for ~14 days, leaving a stale and sparse feed. Hiding on that
 * evidence would have left the operator looking at ONE row and drawing the conclusion that the
 * product had nothing for him.
 *
 * That failure would have passed every check we have. The unit tests pass, the types check, the
 * classifier is correct, the toggle works, and the count is honest. It is a FALSE GREEN of the
 * exact shape this estate keeps getting caught by, and the only thing that surfaced it was
 * running the thing over the real corpus and looking at the number.
 *
 * So the default is INTERLOCKED, not fixed: dead rows are hidden by default only while they are a
 * minority of the board. Past the ceiling the default flips to showing everything and the surface
 * states WHY, because at that point the honest headline is "this feed is stale", not "these
 * opportunities are unavailable". The operator keeps the toggle either way.
 *
 * This also self-heals. When capture resumes and prices repopulate, the share falls below the
 * ceiling and the filter starts working as David asked, with no code change and no one having to
 * remember to turn it back on.
 * ========================================================================================== */

/**
 * The share of positively-dead rows past which hiding them is misreporting a feed problem.
 *
 * 0.4 is a judgement, not a measurement, and is deliberately generous: at 40% the operator still
 * has a majority of his board, and below that a hidden minority reads as the tidy-up it is meant
 * to be. It is exported so a test pins it and a future owner can see what they are changing.
 */
export const SAFE_HIDE_CEILING = 0.4

export type HideDefault = {
  /** Whether the DEFAULT view should hide positively-dead rows. */
  hideByDefault: boolean
  /** The measured share of the board ruled unactionable, 0..1. */
  share: number
  /**
   * Set when the interlock tripped. A surface MUST render this rather than silently showing
   * everything, or the operator cannot tell a healthy board from a stale one.
   */
  plain: string | null
}

/**
 * Decide whether the default view may hide dead rows, given how many there are.
 *
 * ⛔ The share is measured against the WHOLE board, `unknown` included. Measuring it against only
 * the rows we could classify would let a board that is 90% unknown and 10% dead look like a 100%
 * dead one and trip the interlock backwards.
 */
export function hideDeadByDefault(counts: {
  actionable: number
  unactionable: number
  unknown: number
}): HideDefault {
  const total = counts.actionable + counts.unactionable + counts.unknown
  if (total === 0) return { hideByDefault: false, share: 0, plain: null }

  const share = counts.unactionable / total
  if (share <= SAFE_HIDE_CEILING) return { hideByDefault: true, share, plain: null }

  return {
    hideByDefault: false,
    share,
    plain:
      `${counts.unactionable.toLocaleString()} of ${total.toLocaleString()} rows ` +
      `(${Math.round(share * 100)}%) have no award price on file to anchor a quote against. That is a ` +
      `gap in the feed rather than a verdict on the opportunities, so they are being SHOWN rather ` +
      `than hidden: hiding them would leave almost nothing on the board and would report a stale ` +
      `capture as an empty market.`,
  }
}
