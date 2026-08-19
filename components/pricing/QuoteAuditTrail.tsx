/*
 * <QuoteAuditTrail /> Owner: @PRICE-SURFACE.
 *
 * THE WORKING UNDER THE ANSWER. Two blocks, in this order:
 *
 *   1. THE INPUTS THE RECOMMENDATION CONSUMED, each with its own value, its date and the file
 *      or regulation it was read from.
 *   2. THE FOUR SEPARATELY AUDITABLE FIGURES, which are what this product published before it
 *      was allowed to publish a recommendation at all.
 *
 * =========================================================================================
 * WHY THE FOUR FIGURES ARE STILL HERE
 * =========================================================================================
 * The owner lifted the rule that forbade a single recommended number. He did not delete the
 * arithmetic that justifies one. The anchor, the recent resale band, the evaluated price and
 * the tripwire band answer four DIFFERENT questions, each is checkable on its own, and the
 * recommendation is added ON TOP of them rather than in place of them. An operator who wants
 * to know why the number is what it is, or who is about to defend it to a buyer, reads down.
 *
 * ★ AND THEY WERE UNREACHABLE. `buildQuoteView` and everything under it is roughly 2,270 lines
 * of tested pricing engine, and before this component NOTHING in the product called it. That
 * is this estate's dominant failure shape, "built and wired but never fed", and the cure is a
 * caller, not more engine.
 *
 * =========================================================================================
 * SUBORDINATE, NOT INVISIBLE
 * =========================================================================================
 * These figures must read as the working and never compete with the recommendation above them.
 * So they are typographically quieter (no brass, no display size, a collapsed default) while
 * still being fully present and fully legible. A detail element that a reader can open is
 * subordinate; a figure rendered at 11px in grey is hidden, and hidden evidence is the same as
 * no evidence the first time someone needs it.
 *
 * NOTHING HERE COMPUTES. Every number is read off the view object the engine returned.
 */
import { StatusChip } from '@/components/ui/StatusChip'
import type { QuoteView } from '@/lib/intelligence/pricing/quote-view'
import type { RecommendationInputValue } from '@/lib/intelligence/pricing/recommend'
import styles from './quote-audit-trail.module.css'

const usd = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * MEASURED reads as a fact; everything else reads as a judgement, and the word is printed.
 * There is no colour-only encoding here: the state is always spelled out.
 */
function EvidenceChip({ state }: { state: string }) {
  return (
    <StatusChip tone={state === 'MEASURED' ? 'verified' : 'idle'}>{state.toLowerCase()}</StatusChip>
  )
}

/* -------------------------------------------------------------- 1. the inputs consumed */

export function RecommendationInputs({ inputs }: { inputs: readonly RecommendationInputValue[] }) {
  if (inputs.length === 0) return null
  return (
    <div className={styles.inputs}>
      <h3 className={styles.blockTitle}>What the figure was computed from</h3>
      <p className={styles.blockSub}>
        Every value the winning rung consumed, with the date it carries and the file or
        regulation it was read from. A value with no date says so rather than borrowing one.
      </p>
      <ul className={styles.inputList}>
        {inputs.map((v, i) => (
          <li key={`${v.label}-${i}`} className={styles.input}>
            <div className={styles.inputHead}>
              <span className={styles.inputLabel}>{v.label}</span>
              <EvidenceChip state={v.evidenceState} />
            </div>
            <p className={`mono ${styles.inputValue}`}>{v.renderedValue}</p>
            <p className={styles.inputMeta}>
              {v.dateIso ? (
                <span className="mono">{v.dateIso}</span>
              ) : (
                <span className={styles.undated}>no date on this value</span>
              )}
              <span aria-hidden="true"> · </span>
              <span>{v.source}</span>
            </p>
            {/*
              THE AUTHORITY AND THE LINE RANGE, NOT THE FILE PATH. `sourceFile` on a citation is
              free text and has already carried an internal-derivation label; this estate has
              also shipped exhibits that leaked local filesystem paths through a citation layer.
              The authority is what an operator can check, so that is what is printed.
            */}
            {v.citation ? (
              <p className={styles.citation}>
                {v.citation.authority}
                {v.citation.sourceLines ? ` · ${v.citation.sourceLines}` : ''}
                {` · ${v.citation.grade.toLowerCase()}`}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------- 2. the four figures */

/**
 * The four figures, each in its own block, each with its own arithmetic and its own
 * limitation, and NEVER blended. There is no fifth figure here and no average of these four:
 * the recommendation above is computed by a different module from named evidence, and a
 * blended figure was the exact thing the four-figure doctrine existed to prevent.
 */
export function FourFigures({ view }: { view: QuoteView }) {
  return (
    <div className={styles.figures}>
      <h3 className={styles.blockTitle}>The four figures, each auditable on its own</h3>
      {/*
        ★ `view.doctrineNotice` IS NOT RENDERED, AND THAT IS A CORRECTION RATHER THAN AN OMISSION.
        The engine's own notice still reads "This product publishes no single blended recommended
        quote", which was true while BD-19 forbade one and became FALSE the moment a
        recommendation appeared above it on this same page. Printing it verbatim under the
        recommendation would put the product in contradiction with itself, in the operator's
        eyeline, on the surface where a wrong sentence costs the most. A UI string that describes
        the page goes stale, and this one has.

        What replaces it says the part that is STILL TRUE and is the whole reason these four are
        kept: they answer different questions, they are never averaged, and the recommendation
        above is not a blend of them. Flagged to the engine lane; that constant is theirs to edit.
      */}
      <p className={styles.blockSub}>
        Four figures, each auditable on its own. They answer different questions and are never
        blended: there is no fifth figure here and no average of these four. The recommendation
        above is computed by a different module from evidence it names, and the evaluation factors
        belong to the buyer&rsquo;s comparison arithmetic, not to the price we send and not to any
        cost we pay.
      </p>

      <ol className={styles.figureList}>
        {view.figures.map((f) => (
          <li key={f.figureId} className={styles.figure} data-resolved={f.resolved ? 'true' : 'false'}>
            <div className={styles.figureHead}>
              <span className={styles.figureLabel}>{f.label}</span>
              {f.resolved ? (
                <EvidenceChip state={f.evidenceState} />
              ) : (
                <StatusChip tone="idle">abstained</StatusChip>
              )}
            </div>

            {/*
             * THE ABSTAINED ARM CARRIES NO NUMBER, BY TYPE. There is nothing here to read as a
             * price by accident, and `missingInput` names the thing to go and get, because
             * "insufficient data" tells an operator nothing they can act on.
             */}
            {!f.resolved ? (
              <>
                <p className={styles.figureBody}>{f.sentence}</p>
                <p className={styles.missing}>
                  Needs: <span className="mono">{f.missingInput}</span>
                </p>
              </>
            ) : f.figureId === 'ANCHOR' ? (
              <>
                {/*
                 * TWO INDEX LINES, NEVER AVERAGED. CPI and the DoD procurement factor disagree,
                 * and the disagreement is information. A midpoint would delete it and would be
                 * a number no source states.
                 */}
                <dl className={styles.lines}>
                  {f.lines.map((l) => (
                    <div key={l.indexKind} className={styles.line}>
                      <dt>
                        {l.indexKind}
                        {l.preferred ? <span className={styles.preferred}> preferred</span> : null}
                      </dt>
                      <dd className="mono">{usd(l.unitPriceUsd)}</dd>
                      <dd className={`mono ${styles.lineArith}`}>{l.arithmetic}</dd>
                    </div>
                  ))}
                </dl>
                <p className={styles.limitation}>{f.limitation}</p>
              </>
            ) : f.figureId === 'RECENT_FLIP_BAND' ? (
              <>
                <p className={styles.figureValue}>
                  <span className="mono">{usd(f.lowUnitPriceUsd)}</span>
                  <span className={styles.to}>to</span>
                  <span className="mono">{usd(f.highUnitPriceUsd)}</span>
                </p>
                <p className={`mono ${styles.figureArith}`}>{f.arithmetic}</p>
                <p className={styles.limitation}>{f.limitation}</p>
              </>
            ) : f.figureId === 'EVALUATED_PRICE' ? (
              <>
                {/*
                 * BD-18 ON THE AUDIT TRAIL TOO. The quoted total and the evaluated figure are
                 * printed on separate lines under separate labels, and the labels say in words
                 * which one we send. They are different TYPES in the engine and `a + b` on them
                 * does not compile; this is the same separation, rendered.
                 */}
                <dl className={styles.lines}>
                  <div className={styles.line}>
                    <dt>What we send</dt>
                    <dd className="mono">{usd(f.quotedTotal.usd)}</dd>
                  </div>
                  <div className={styles.line}>
                    <dt>What DLA compares</dt>
                    <dd className="mono">
                      {f.kind === 'TOTAL' ? usd(f.evaluatedTotal.usd) : `${usd(f.evaluatedFloor.atLeastUsd)} or more`}
                    </dd>
                  </div>
                </dl>
                <p className={`mono ${styles.figureArith}`}>{f.arithmetic}</p>
                <p className={styles.limitation}>{f.limitation}</p>
              </>
            ) : (
              <>
                <p className={styles.figureValue}>
                  <span className="mono">{f.impliedIncreasePercent.toFixed(1)}%</span>
                  <span className={styles.to}>increase</span>
                  <StatusChip tone={f.crossed ? 'accent' : 'idle'}>
                    {f.crossed ? 'crosses the band' : 'inside the band'}
                  </StatusChip>
                </p>
                <p className={`mono ${styles.figureArith}`}>{f.arithmetic}</p>
                <p className={styles.limitation}>{f.consequence.operationalMeaning}</p>
              </>
            )}
          </li>
        ))}
      </ol>

      {view.recordedObservations.length > 0 ? (
        <div className={styles.recorded}>
          <h4 className={styles.recordedTitle}>A number a human wrote, not a number we computed</h4>
          {view.recordedObservations.map((o) => (
            <div key={o.label} className={styles.recordedItem}>
              <p className={styles.recordedHead}>
                <span>{o.label}</span>
                <span className="mono">{usd(o.valueUsd)}</span>
                <StatusChip tone={o.reproducedByAnchor ? 'verified' : 'idle'}>
                  {o.reproducedByAnchor ? 'the anchor reproduces it' : 'the anchor does not reach it'}
                </StatusChip>
              </p>
              <p className={styles.recordedBody}>{o.derivationStatedBySource}</p>
              <p className={`mono ${styles.recordedCheck}`}>{o.reproductionCheck}</p>
            </div>
          ))}
        </div>
      ) : null}

      {view.gaps.length > 0 ? (
        <div className={styles.gaps}>
          <h4 className={styles.recordedTitle}>What these four figures are still waiting on</h4>
          <ul className={styles.gapList}>
            {view.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The whole audit trail, collapsed by default.
 *
 * COLLAPSED IS A HIERARCHY DECISION, NOT A HIDING ONE. The recommendation above is the answer;
 * this is the working. `<details>` keeps every word in the DOM, findable by the browser's own
 * find, reachable by keyboard and announced by a screen reader, while making it unmistakably
 * subordinate on first paint. The summary states what is inside and how many figures, so a
 * reader knows what opening it costs.
 */
export function QuoteAuditTrail({
  view,
  inputs,
}: {
  view: QuoteView
  inputs: readonly RecommendationInputValue[]
}) {
  return (
    <section className={styles.panel} aria-labelledby="audit-title">
      <details className={styles.details}>
        <summary className={styles.summary}>
          <span className={styles.summaryTitle} id="audit-title">
            The audit trail under that number
          </span>
          {/*
            THE SUMMARY STATES WHAT IS ACTUALLY INSIDE, WHICH IS NOT THE SAME SENTENCE ON EVERY
            ROW. On an abstention there are no consumed inputs, and "0 inputs it consumed" reads
            as a failure to load rather than as the correct consequence of no rung having
            reached. A summary that promises a count the panel does not hold is a UI string
            describing a page it has stopped describing.
          */}
          <span className={styles.summarySub}>
            {inputs.length > 0
              ? `${inputs.length} input${inputs.length === 1 ? '' : 's'} the figure was computed from, each with its date and source, and the four separately auditable figures underneath it`
              : 'No rung reached, so nothing was consumed. The four separately auditable figures are here, and on a row like this one they are the only arithmetic on the page'}
          </span>
        </summary>
        <div className={styles.body}>
          <RecommendationInputs inputs={inputs} />
          <FourFigures view={view} />
        </div>
      </details>
    </section>
  )
}
