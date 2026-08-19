/*
 * <ClearingCurve /> Owner: @BUILD-THE-WIRES.
 *
 * WHAT QUOTING HIGHER COSTS YOU, AS A DECISION SURFACE RATHER THAN A NUMBER.
 *
 * =========================================================================================
 * WHY THIS EXISTS INSTEAD OF A SECOND RECOMMENDED FIGURE
 * =========================================================================================
 * The product used to multiply the last award price by 3 and call it a recommendation. Measured
 * against real outcomes that clears 0.00% of the time once each stock number votes once, so it
 * was removed as a default.
 *
 * The obvious replacement is the multiple that maximises expected value. It was computed and it
 * is deliberately not shown as a recommendation: on revenue it peaked at the BOTTOM of the search
 * grid, and on margin only under an assumed cost this product cannot verify. A maximum on the
 * boundary is a symptom, not an answer, and the reason is the same in both cases: nothing here
 * holds cost of goods, and a model with no cost floor cannot represent the fact that winning
 * below cost is a LOSS rather than a small win.
 *
 * ★ THE ONE INPUT THAT DECIDES THE ANSWER IS THE ONE INPUT WE DO NOT HOLD. So the product stops
 * guessing at it. It shows what the market actually did at each price, says out loud that the
 * last step needs a number only the operator has, and lets them place themselves on the curve.
 * That is more useful than any default we could have picked, and we never have to defend a
 * multiple we invented.
 */
import { StatusChip } from '@/components/ui/StatusChip'
import type { ClearingCurve as Curve } from '@/lib/intelligence/pricing/clearing-curve'
import styles from './clearing-curve.module.css'

const pct = (n: number): string => `${(n * 100).toFixed(0)}%`

export function ClearingCurve({ curve, recommendedMultiple }: { curve: Curve; recommendedMultiple: number }) {
  if (!curve.available) {
    return (
      <section className={styles.panel} aria-labelledby="curve-title">
        <h2 className={styles.title} id="curve-title">
          What quoting higher would cost you
        </h2>
        <p className={styles.abstain}>{curve.note}</p>
        <p className={styles.abstainWhat}>
          Missing: <span className="mono">{curve.missingInput}</span>
        </p>
      </section>
    )
  }

  const peak = Math.max(...curve.points.map((p) => p.upperBoundOnWinning), 0.0001)

  return (
    <section className={styles.panel} aria-labelledby="curve-title">
      <div className={styles.head}>
        <h2 className={styles.title} id="curve-title">
          What quoting higher would cost you
        </h2>
        <StatusChip tone={curve.basis === 'FSC' ? 'verified' : 'idle'}>
          {curve.basis === 'FSC' ? `supply class ${curve.fsc}` : 'market wide'}
        </StatusChip>
      </div>

      {/*
        ★ THE MODULE'S OWN NOTE, AT THE TOP, INSTEAD OF A HAND-WRITTEN INTRO HERE AND THE NOTE
        AGAIN AT THE BOTTOM. Read at 320: the two said the same thing — "Measured over 78 stock
        numbers, each counted once however many awards it carries" and "Measured across 78 stock
        numbers, supply class 5306, each counted once however many awards it carries" — and the
        second is the one that matters, because it is the only place that says whether this curve
        is THIS SUPPLY CLASS or the market-wide fallback. That distinction changes what an
        operator concludes and it was sitting at the very bottom, after the limits.

        What the hand-written intro added beyond it, that every figure is a share of past buys, is
        already stated in the limits paragraph below in stronger terms.
      */}
      <p className={styles.intro}>{curve.note}</p>

      <ol className={styles.rows}>
        {curve.points.map((p) => {
          const isRec = p.multiple === recommendedMultiple
          const dead = p.upperBoundOnWinning === 0
          return (
            <li
              key={p.multiple}
              className={styles.row}
              data-recommended={isRec ? 'true' : 'false'}
              data-dead={dead ? 'true' : 'false'}
            >
              <span className={styles.mult}>
                {p.multiple}&times;
                {isRec ? <span className={styles.here}> your figure</span> : null}
              </span>
              <span className={styles.track}>
                <span
                  className={styles.fill}
                  style={{ width: `${(p.upperBoundOnWinning / peak) * 100}%` }}
                />
              </span>
              <span className={styles.share}>
                {dead ? 'never' : pct(p.upperBoundOnWinning)}
              </span>
            </li>
          )
        })}
      </ol>

      {curve.ceilingMultiple !== null ? (
        <p className={styles.ceiling}>
          <strong>{curve.ceilingMultiple}&times; is the ceiling.</strong> Across these stock
          numbers, nothing above it was ever observed clearing at all.
        </p>
      ) : null}

      {/*
        THE HONEST LIMIT IS PART OF THE DELIVERABLE, NOT A DISCLAIMER ON IT. It tells the operator
        exactly why the last step is theirs, and it is the difference between a product that
        respects them and one that pretends to know their business.
      */}
      <p className={styles.limit}>
        These are chances of clearing, not of winning: you also have to be the lowest responsive
        offer, so every figure here is a ceiling on how often it would have won. And the best price
        for you depends on what the part costs you, which this product does not hold. Pick your
        point on the curve.
      </p>


    </section>
  )
}
