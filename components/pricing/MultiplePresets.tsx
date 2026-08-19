/*
 * <MultiplePresets /> Owner: @BUILD-THE-WIRES.
 *
 * THE CONTROL THAT MAKES THE OPERATOR'S OWN RULE REACHABLE.
 *
 * =========================================================================================
 * WHY IT EXISTS
 * =========================================================================================
 * The product default moved from his 3x to 1 because 3x was measured against real outcomes and
 * the median stock number clears at it 0.00% of the time. But a rule that lives in the engine
 * with no way to pick it has been quietly REMOVED rather than un-defaulted, and it is his rule.
 * He may also know something about a row that the corpus does not.
 *
 * =========================================================================================
 * NO PRESET IS OFFERED WITHOUT ITS RECORD
 * =========================================================================================
 * Every option carries what the measurement says about it, generated from the measured table
 * rather than retyped. A preset without its record is exactly how a figure that clears 0.00% of
 * the time came to wear "High confidence" earlier tonight. The record is not hidden behind a
 * hover: on a money control, a fact you have to discover is a fact you did not state.
 *
 * =========================================================================================
 * LINKS, NOT STATE, AND THAT IS DELIBERATE
 * =========================================================================================
 * Each option is a link that re-renders the page on the server with that multiple. So it works
 * with no client JavaScript, it is bookmarkable and shareable, the whole recommendation is
 * recomputed rather than patched, and the chosen value is VALIDATED SERVER-SIDE against the
 * preset list on every request. A number typed into the URL cannot reach the engine.
 *
 * ★ That validation is also a security boundary rather than only hygiene. A multiple outside the
 * preset list routes through `measuredRecordSentence`, which is the one place the engine can emit
 * margin-shaped prose, and margin is gated by `margin.view`. Accepting an arbitrary URL value
 * would hand an unauthenticated caller the choice of which code path to run.
 */
import Link from 'next/link'
import type { Route } from 'next'
import { StatusChip } from '@/components/ui/StatusChip'
import {
  MEASURED_CLEARANCE_BASIS,
  measuredClearanceAt,
  withoutSharedBasis,
  type AwardMultiplePreset,
} from '@/lib/intelligence/pricing/recommend'
import styles from './multiple-presets.module.css'

export function MultiplePresets({
  presets,
  active,
  basePath,
}: {
  presets: readonly AwardMultiplePreset[]
  active: number
  basePath: string
}) {
  return (
    <section className={styles.panel} aria-labelledby="presets-title">
      <h2 className={styles.title} id="presets-title">
        Price it a different way
      </h2>
      <p className={styles.intro}>
        Every figure on this page moves with the multiple. Each option says what our own award
        history measured about it, so you are never choosing blind.
      </p>
      {/*
        ★ THE SHARED BASIS, STATED ONCE. MEASURED ON A PHONE: every one of the five records opened
        with the SAME 30-word preamble naming the same sample, and at 390px this section was
        2,560px tall, three full screens for one control, with the fact that distinguishes each
        option buried at the end of a ten-line paragraph.

        Nothing is hidden and nothing is shortened: the records keep full size and full contrast,
        per the ruling. A basis shared by all five options is simply stated where a shared fact
        belongs, instead of five times where it crowds out the five facts that differ.
      */}
      <p className={styles.basis}>{MEASURED_CLEARANCE_BASIS}</p>

      <ul className={styles.list}>
        {presets.map((p) => {
          const isActive = Math.abs(p.value - active) < 1e-9
          const rate = measuredClearanceAt(p.value)?.clearedAtOrBelowShare ?? null
          return (
            <li key={p.id} className={styles.item} data-active={isActive ? 'true' : 'false'}>
              <Link
                href={`${basePath}?m=${p.value}` as Route}
                className={styles.option}
                aria-current={isActive ? 'true' : undefined}
              >
                <span className={styles.head}>
                  <span className={styles.value}>{p.value}&times;</span>
                  <span className={styles.label}>{p.label}</span>
                  {p.provenance === 'PRIOR' ? (
                    <StatusChip tone="idle">stated, not measured</StatusChip>
                  ) : (
                    <StatusChip tone="verified">measured</StatusChip>
                  )}
                  {isActive ? <StatusChip tone="accent">in use</StatusChip> : null}
                </span>
                {/*
                  ★ THE CLEAR RATE, AS A NUMBER, BESIDE THE MULTIPLE. Measured by reading the
                  rendered cards on a phone: this figure is the one fact that separates the five
                  options, and it was arriving at the END of a twenty-five word sentence on every
                  one of them. A number an operator is choosing between should not have to be
                  read out of a paragraph. The paragraph stays underneath, unchanged and at full
                  contrast; this is the same fact promoted, not a substitute for it.
                */}
                {rate === null ? null : (
                  <span className={styles.rate}>
                    <span className={styles.rateNum}>{(rate * 100).toFixed(1)}%</span>
                    <span className={styles.rateLabel}>cleared at or below</span>
                  </span>
                )}
              </Link>
              {/*
                THE RECORD SITS OUTSIDE THE LINK ON PURPOSE. Inside it, a screen reader announces
                the whole paragraph as the link text on every option, which turns a scannable list
                into an unusable one. It stays adjacent and always visible.
              */}
              <p className={styles.record}>{withoutSharedBasis(p.record, p.value)}</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
