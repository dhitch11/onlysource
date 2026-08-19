/*
 * <RecommendationPanel /> Owner: @BUILD-THE-WIRES.
 *
 * THE ANSWER TO "WHAT DO I BID", AND THE EVIDENCE UNDER IT, ON ONE SURFACE.
 *
 * -------------------------------------------------------------------------------------
 * WHY THIS PANEL LOOKS THE WAY IT DOES
 * -------------------------------------------------------------------------------------
 * The owner lifted the rule that forbade a single recommended number, because a product that
 * refuses to answer the only question the operator has is not being careful, it is being
 * useless. What the lift did NOT do is make a weak basis strong. So the number is large and the
 * rung that produced it is printed immediately under it, in the same visual breath: the operator
 * should never be able to read the figure without reading what it stands on.
 *
 * FOUR THINGS ARE STRUCTURAL, NOT STYLING:
 *
 * 1. A BAND AND A POINT ARE RENDERED DIFFERENTLY AND SHARE NO NUMERIC SLOT. The engine's own
 *    types share no field name across the two arms, so a render that reads a band as a point
 *    fails to compile. This component keeps that property rather than flattening both into a
 *    string upstream, which would throw the distinction away at the last moment.
 *
 * 2. WHAT WE SEND AND WHAT DLA COMPARES ARE NEVER ADJACENT AND NEVER SUMMED. The evaluated
 *    figure sits in its own block, under its own heading, saying in words that it is not our
 *    quote. An operator who folds the evaluation factors into the bid quotes high and loses an
 *    award they had won.
 *
 * 3. THE ABSTENTION IS A FIRST-CLASS RENDER, NOT AN EMPTY DIV. When no rung reaches, the panel
 *    says which input was missing and what would resolve it. A blank here would read as "no
 *    opportunity", which is the permissive direction on a page whose whole job is to say
 *    whether there is one.
 *
 * 4. THE LADDER IS ALWAYS SHOWN, INCLUDING THE RUNGS THAT DID NOT RESOLVE. A rung that could
 *    not fire is the roadmap: it names the one fact that would move this row up a tier.
 */
import { StatusChip } from '@/components/ui/StatusChip'
import {
  classifyAwardMultiple,
  OPERATOR_AWARD_MULTIPLE,
} from '@/lib/intelligence/pricing/recommend'
import type { PriceRecommendation, RecommendationRung } from '@/lib/intelligence/pricing/recommend'
import styles from './recommendation.module.css'

const usd = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const usdWhole = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

/**
 * Confidence IS the rung. There is no separate score, because a second number invented to
 * summarise the first is exactly the kind of figure this product refuses to print.
 */
const RUNG_TONE: Record<RecommendationRung, 'verified' | 'active' | 'idle'> = {
  R1_MANUFACTURER_ANCHOR: 'verified',
  // Overridden on R2 by the multiple in force. See `confidenceFor` below.
  R2_LAST_AWARD_MULTIPLE: 'idle',
  R3_RECENT_AWARD_BAND: 'active',
  R4_AWARD_TREND: 'active',
  R5_FSC_PEER_BAND: 'idle',
}

/*
 * ★ R2 IS NO LONGER LABELLED "High confidence", AND THIS IS A CORRECTION OF A FALSE CLAIM RATHER
 * THAN A WORDING PREFERENCE. MEASURED over 40,184 consecutive award pairs: a tripled quote came
 * in at or below the price the item actually cleared at 0.8% of the time (0.3% on sole-source
 * rows). A known limitation plus an absolute claim is a false statement, and "High confidence"
 * printed beside a figure our own corpus says clears under one percent of the time is exactly
 * that. The rung still renders, because it is the operator's own stated rule and it is his to
 * use; what it may not do is wear a confidence it does not have.
 */
const RUNG_CONFIDENCE: Record<RecommendationRung, string> = {
  R1_MANUFACTURER_ANCHOR: 'Highest confidence',
  // R2 never reads this entry. Its tier depends on the multiple, not on the rung: see below.
  R2_LAST_AWARD_MULTIPLE: 'Your stated rule, not a measured basis',
  R3_RECENT_AWARD_BAND: 'Moderate confidence',
  R4_AWARD_TREND: 'Moderate confidence',
  R5_FSC_PEER_BAND: 'Lowest confidence',
}

/*
 * ★ THE TIER ON R2 FOLLOWS THE MULTIPLE IN FORCE, NOT THE RUNG. Corrected by @REFUTE-OPERATOR-VIEW
 * after reading the live dossier: the chip above the recommended figure read "Your stated rule,
 * not a measured basis" while the number in force was 1x, whose own caveat two lines below cites
 * 19,475 measured award events. The same claim had already been corrected on the pricing board
 * (`app/(app)/pricing/wire.ts`), and this panel kept a second copy of the pre-correction string
 * keyed by rung name. A rung is not a basis: the same rung means different things at 0.98, at 1
 * and at 3, so the stance is read from the engine's own classifier and the operator's own rule is
 * named BY IDENTITY, never by position or by a literal that goes stale when the default moves.
 *
 * Why the direction of the error mattered enough to fix on sight: the operator's stated rule IS
 * 3x, and this product measures 3x clearing essentially never. A chip telling him the figure he
 * is looking at is his own unmeasured rule invites him to discard the best-measured number in the
 * product and fall back to the one it refuted.
 */
function confidenceFor(rec: Extract<PriceRecommendation, { resolved: true }>): {
  readonly label: string
  readonly tone: 'verified' | 'active' | 'idle'
} {
  if (rec.rung !== 'R2_LAST_AWARD_MULTIPLE') {
    return { label: RUNG_CONFIDENCE[rec.rung], tone: RUNG_TONE[rec.rung] }
  }
  const multiple = rec.awardMultiple
  if (multiple === OPERATOR_AWARD_MULTIPLE) {
    return { label: 'Your stated rule, not a measured basis', tone: 'idle' }
  }
  const stance = classifyAwardMultiple(multiple)
  if (stance === 'MEASURED_OPTIMUM' || stance === 'INSIDE_THE_MEASURED_BAND') {
    return {
      label: multiple === 1 ? 'The measured clearing estimate' : 'Inside the measured band',
      tone: 'verified',
    }
  }
  return { label: 'A multiple you set, outside the measured band', tone: 'idle' }
}

export function RecommendationPanel({ rec }: { rec: PriceRecommendation }) {
  if (!rec.resolved) {
    return (
      <section className={styles.panel} data-resolved="false" aria-labelledby="rec-title">
        <div className={styles.head}>
          <h2 className={styles.title} id="rec-title">
            Recommended quote
          </h2>
          <StatusChip tone="idle">not enough evidence</StatusChip>
        </div>
        <p className={styles.abstain}>{rec.sentence}</p>
        <p className={styles.abstainWhat}>
          Missing input: <span className="mono">{rec.missingInput}</span>
        </p>
        {rec.ladder.length > 0 ? <Ladder rec={rec} /> : null}
      </section>
    )
  }

  const fig = rec.recommended
  const confidence = confidenceFor(rec)

  return (
    <section className={styles.panel} data-resolved="true" data-rung={rec.rung} aria-labelledby="rec-title">
      <div className={styles.head}>
        <h2 className={styles.title} id="rec-title">
          Recommended quote
        </h2>
        <StatusChip tone={confidence.tone}>{confidence.label}</StatusChip>
      </div>

      {/* ---------------------------------------------------------------- the figure */}
      {/*
        `data-kind` carries the shape to CSS so a band and a point read differently AT A GLANCE,
        before the text is read. @PRICE-SURFACE measured why this is load-bearing rather than
        cosmetic: ZERO of the served rows currently produce a POINT, because every basis award is
        at least some days old and the age widening turns each figure into a band. An arm with no
        live example is held honest only by a fixture, so the two shapes must stay visibly
        distinct or the day a point appears it will look like a band that lost an endpoint.
      */}
      {fig.kind === 'POINT' ? (
        <p className={styles.figure} data-kind="POINT">
          <span className={styles.figureNum}>{usd(fig.unitPriceUsd)}</span>
          <span className={styles.figureUnit}>per unit</span>
        </p>
      ) : (
        <p className={styles.figure} data-kind="BAND">
          <span className={styles.figureNum}>
            {usd(fig.lowUnitPriceUsd)} to {usd(fig.highUnitPriceUsd)}
          </span>
          <span className={styles.figureUnit}>per unit</span>
        </p>
      )}

      <p className={styles.basis}>
        <span className={styles.basisLabel}>{rec.rungLabel}</span>
        <span className={styles.basisSep} aria-hidden="true">
          ·
        </span>
        <span className={styles.basisState}>{rec.evidenceState}</span>
      </p>

      {/*
        ★ `rec.sentence` IS DELIBERATELY NOT RENDERED HERE, AND THIS IS A DUPLICATION FIX RATHER
        THAN A REMOVAL. Measured by reading the panel at 320: it restates the rung label verbatim
        and the arithmetic verbatim, both of which are already on this panel as structured,
        scannable fields directly above and below it. Asserted, not assumed:
        `sentence.includes(rungLabel)` and `sentence.includes(arithmetic)` are both true.

        On a phone that was five lines of repeated label plus three of repeated arithmetic inside
        a run-on paragraph, in a panel already 1,543px tall.

        The ONE thing the sentence carried that lives nowhere else is the quoted-versus-evaluated
        qualifier, and that is now stated unconditionally in the What we send block below rather
        than only when an evaluated context happens to be available.
      */}

      {/* ------------------------------------------------------- the arithmetic shown */}
      <p className={styles.arith}>
        <span className={styles.arithLabel}>How this was computed</span>
        <span className="mono">{rec.arithmetic}</span>
      </p>

      {/* -------------------------------------------------------------- what we send */}
      {rec.quotedTotal ? (
        <div className={styles.totals}>
          <div className={styles.totalBlock} data-role="send">
            <span className={styles.totalLabel}>What we send</span>
            <span className={styles.totalValue}>
              {rec.quotedTotal.kind === 'QUOTED_TOTAL_RANGE_WHAT_WE_SEND'
                ? `${usdWhole(rec.quotedTotal.lowUsd)} to ${usdWhole(rec.quotedTotal.highUsd)}`
                : usdWhole(rec.quotedTotal.usd)}
            </span>
            <span className={styles.totalNote}>
              {rec.requirementQuantity != null
                ? `${rec.requirementQuantity.toLocaleString()} units on this requirement`
                : 'Requirement quantity not read on this row'}
            </span>
            {/*
              UNCONDITIONAL. This used to reach the operator only inside `rec.sentence`, and the
              separate "What DLA compares" block that repeats it appears only when an evaluated
              context is available, which is often not the case. The one sentence that stops
              somebody adding DLA's factors into their own quote may not be conditional on DLA's
              factors being computable.
            */}
            <span className={styles.totalNote}>
              This is what we send. The evaluation factors DLA adds when it ranks offers are the
              buyer&rsquo;s arithmetic and are never added to it.
            </span>
          </div>

          {/*
            THE SEPARATION IS THE POINT. This is DLA's arithmetic on our number, not a line we
            add to our own quote. It is in a different block, under a different heading, and the
            note says so in a sentence rather than relying on the heading being read.
          */}
          {rec.evaluatedPriceContext.available ? (
            <div className={styles.totalBlock} data-role="evaluated">
              <span className={styles.totalLabel}>What DLA compares</span>
              <span className={styles.totalValue}>
                {rec.evaluatedPriceContext.evaluatedAtRecommendation.kind ===
                'EVALUATED_TOTAL_RANGE_WHAT_DLA_COMPARES_NEVER_WHAT_WE_SEND'
                  ? `${usdWhole(rec.evaluatedPriceContext.evaluatedAtRecommendation.lowUsd)} to ${usdWhole(
                      rec.evaluatedPriceContext.evaluatedAtRecommendation.highUsd,
                    )}`
                  : usdWhole(rec.evaluatedPriceContext.evaluatedAtRecommendation.usd)}
              </span>
              <span className={styles.totalNote}>
                {rec.evaluatedPriceContext.isFloor
                  ? 'A floor. A factor applies that the solicitation states no amount for. The buyer adds this when ranking offers, and you do not add it to what you send.'
                  : 'The buyer adds this when ranking offers. Do not add it to what you send.'}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ caveats */}
      {rec.caveats.length > 0 ? (
        <ul className={styles.caveats}>
          {rec.caveats.map((c) => (
            <li key={c.code} className={styles.caveat}>
              {c.sentence}
            </li>
          ))}
        </ul>
      ) : null}

      {/* ------------------------------------------------- what would sharpen the read */}
      {rec.wouldSharpenWith.length > 0 ? (
        <div className={styles.sharpen}>
          <span className={styles.sharpenLabel}>What would sharpen this</span>
          <ul className={styles.sharpenList}>
            {rec.wouldSharpenWith.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <Ladder rec={rec} />
    </section>
  )
}

/**
 * EVERY RUNG, RESOLVED OR NOT.
 *
 * The unresolved rungs carry their own reason, and that reason is the most actionable text on
 * the page: it names the single fact that would move this row to a firmer basis.
 */
function Ladder({ rec }: { rec: PriceRecommendation }) {
  const chosen = rec.resolved ? rec.rung : null
  return (
    <details className={styles.ladder}>
      <summary className={styles.ladderSummary}>The full ladder, including what did not reach</summary>
      <ol className={styles.ladderList}>
        {rec.ladder.map((r) => (
          <li
            key={r.rung}
            className={styles.rung}
            data-resolved={r.resolved ? 'true' : 'false'}
            data-chosen={r.rung === chosen ? 'true' : 'false'}
          >
            <div className={styles.rungHead}>
              <span className={styles.rungLabel}>{r.rungLabel}</span>
              {r.rung === chosen ? <StatusChip tone="accent">used</StatusChip> : null}
              {!r.resolved ? <StatusChip tone="idle">did not reach</StatusChip> : null}
            </div>
            {r.resolved ? (
              <p className={styles.rungBody}>
                <span className="mono">{r.arithmetic}</span>
              </p>
            ) : (
              <p className={styles.rungBody}>{r.sentence}</p>
            )}
          </li>
        ))}
      </ol>
    </details>
  )
}
