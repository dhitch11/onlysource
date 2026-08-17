import type { Metadata } from 'next'
import { requireGateSession } from '@/lib/session/require-gate'
import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { buildFscRollup, SAMPLE_FLOOR } from '@/lib/intelligence/groups/fsc'
import { ExplainButton } from '@/components/ui/ExplainButton'
import { GroupsBoard } from './GroupsBoard'
import { alphaText, count, pct } from './format'
import {
  commercialRead,
  dominantGroup,
  groupOptions,
  rowViews,
  verdict,
} from './presentation'
import styles from './groups.module.css'

export const metadata: Metadata = { title: 'Supply Groups · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

/**
 * SUPPLY GROUPS.
 *
 * Every stock number the government buys begins with a four digit Federal Supply Class, and
 * the first two of those digits are the Federal Supply Group. This page is the corner map
 * rolled up by that prefix, so an operator can pick a lane instead of reading the whole map
 * every morning. A dealer who owns two or three classes outbuys a generalist in all of them.
 *
 * =========================================================================================
 * THE STATISTICS ARE THE DESIGN, AND THAT IS THE ENTIRE REASON THIS PAGE IS SHAPED THIS WAY
 * =========================================================================================
 * Compare thirty classes against one average and one of them looks exceptional from chance
 * alone. So the board grades the INFERENCE and never the counts: the counts are always plain
 * counts of real rows, and what changes between rows is how much of a claim the page is
 * willing to make on top of them.
 *
 *   Only a class that survives correction for the number of classes tested may present its
 *   rate as a finding, and only that class shows a lift.
 *
 *   A class that clears the row floor but not the correction shows the same real counts and
 *   the same real rate, and NO lift at all. Lift is the number a person acts on, and a
 *   caveat printed beside it is the part nobody reads.
 *
 *   A class under the row floor shows counts and no percentage. Three candidates in four
 *   rows reads as 75% and is nothing.
 *
 * On a one-day window the third state is most of the board. It therefore gets the same row
 * weight, the same type size and the same padding as every other row, with its word visible.
 * A state that is most of the board, styled as an exception, teaches the operator to read
 * exceptions as the norm.
 *
 * =========================================================================================
 * "NOTHING SEPARATES FROM THE BASELINE" IS AN ANSWER, NOT AN EMPTY SCREEN
 * =========================================================================================
 * The Bonferroni divisor is the number of classes that cleared the row floor, so as the
 * window grows and more classes clear it, the threshold tightens and the significant set can
 * go to zero with no code change at all. That state renders as the loudest block on the page
 * and says what it means, because a person who sees an empty result concludes the tool is
 * broken and a person who reads a verdict knows where he stands.
 */
export default async function GroupsPage() {
  await requireGateSession('/groups')

  const root = resolveDataRoot()
  if (!root.present) {
    return (
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Find</p>
          <h1 className={styles.h1}>Supply Groups</h1>
        </header>
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>The data directory is not mounted here</h2>
          <p>
            This board is the corner map grouped by the government&rsquo;s own supply classes,
            and this environment has no data directory to read it from. Nothing is shown rather
            than a fabricated grouping, and nothing has been assumed in its place.
          </p>
          <p className={styles.pathList}>
            <code>{root.root}</code> <span className={styles.faint}>({root.basis})</span>
          </p>
        </div>
      </main>
    )
  }

  const { cornerMap } = buildAllDatasets()
  const rollup = buildFscRollup(cornerMap.rows)
  const provenance = cornerMap.provenance
  const view = verdict(rollup)
  const rows = rowViews(rollup)
  const options = groupOptions(rollup.groups)
  const dominant = dominantGroup(rollup)
  const significant = rollup.groups.filter((g) => g.evidence === 'significant')

  // The live half of "where the number came from", for the explainer panels: the actual
  // archive these counts were read from, on this feed day, read from the corner map's own
  // provenance object at render time rather than typed into the help registry where it
  // would go stale in silence.
  const sourceDetail = `Rolled up from ${provenance.sourceArchiveKey} for feed day ${provenance.feedDay}`

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Find · feed day {provenance.feedDay}</p>
        <div className={styles.titleRow}>
          <h1 className={styles.h1}>Supply Groups</h1>
          <ExplainButton helpId="groups.map" sourceDetail={sourceDetail} />
        </div>
        <p className={styles.sub}>
          The corner map cut by the government&rsquo;s own segmentation. The first four digits
          of a stock number are its <b>Federal Supply Class</b> and the first two are its{' '}
          <b>Federal Supply Group</b>, and each class carries the government&rsquo;s written
          statement of what belongs in it and what does not. Use it to pick a lane and work
          those rows first.
        </p>
      </header>

      {/* ------------------------------------------------------------------ counted facts */}
      <section className={styles.stats} aria-label="Measured counts for this feed day">
        <div className={styles.stat}>
          <div className={styles.statN}>{count(rollup.totals.classes)}</div>
          <div className={styles.statL}>
            supply classes on the map
            <span className={styles.statHint}>
              distinct four digit classes across {count(rollup.totals.rows)} corner map rows
            </span>
          </div>
        </div>

        <div className={styles.stat}>
          <div className={styles.statN}>{count(rollup.totals.supplyGroups)}</div>
          <div className={styles.statL}>
            supply groups
            <span className={styles.statHint}>
              the two digit families those classes fall into
            </span>
          </div>
        </div>

        <div className={styles.stat}>
          <div className={styles.statHelp}>
            <ExplainButton helpId="groups.baseline" size="sm" sourceDetail={sourceDetail} />
          </div>
          <div className={styles.statN}>{pct(rollup.baseline)}</div>
          <div className={styles.statL}>
            map average candidate rate
            <span className={styles.statHint}>
              {count(rollup.totals.candidates)} candidate corners in{' '}
              {count(rollup.totals.rows)} rows, and the line every class is measured against
            </span>
          </div>
        </div>

        <div className={styles.stat}>
          <div className={styles.statHelp}>
            <ExplainButton helpId="groups.evidence" size="sm" sourceDetail={sourceDetail} />
          </div>
          <div className={styles.statN}>{count(rollup.tested)}</div>
          <div className={styles.statL}>
            classes tested
            <span className={styles.statHint}>
              {count(SAMPLE_FLOOR)} rows or more, judged at a corrected threshold of{' '}
              {alphaText(rollup.bonferroniAlpha)}
            </span>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------------- the verdict
       * The designed first-class answer. Zero significant classes is a real result and reads
       * as one, in the same block that would carry a finding if there were one.
       */}
      <section className={styles.verdict} aria-label="What the test found on this feed day">
        <span
          className={`${styles.verdictRule} ${view.significant > 0 ? styles.verdictRuleFound : ''}`}
          aria-hidden="true"
        />
        <div className={styles.verdictText}>
          <h2 className={styles.verdictHead}>{view.headline}</h2>
          <p className={styles.verdictBody}>{view.body}</p>
          <p className={styles.verdictNote}>
            The counts on this page are counts. The grades are inferences, and they are graded
            down on purpose: the threshold is divided by the number of classes tested, so the
            more of the map becomes testable, the harder a class has to work to be called a
            finding.
          </p>

          {/*
           * THE COMMERCIAL READ, ATTACHED TO ITS SUBJECT. It renders only for a class that
           * actually cleared the bar and it names that class from the row. A sentence about a
           * finding that is not on the board would be a fabrication wearing the register of
           * analysis, so there is no static copy here to go stale.
           */}
          {significant.map((row) => (
            <div key={row.fsc} className={styles.commercial}>
              <p className={styles.commercialHead}>What this is worth commercially</p>
              {commercialRead(row, dominant).map((line) => (
                <p key={line} className={styles.commercialLine}>
                  {line}
                </p>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------- the class catalogue's own state
       * `catalogAvailable: false` renders the owning module's reason VERBATIM and the board
       * still shows every count. A missing title is a missing NAME, never a missing row.
       */}
      {!rollup.catalogAvailable && rollup.catalogReason ? (
        <div className={styles.notice} role="status">
          <p className={styles.noticeHead}>The class titles are not available</p>
          <p className={styles.noticeBody}>{rollup.catalogReason}</p>
          <p className={styles.noticeBody}>
            Every count below is unaffected and is still a plain count of real rows. Each class
            renders the stated absence of its title rather than its code dressed up as a name.
          </p>
        </div>
      ) : null}

      {rollup.groups.length === 0 ? (
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>
            The corner map holds no rows for this feed day
          </h2>
          <p>
            There is nothing to group. This is the corner map&rsquo;s own state, not a failure
            of this page, and it clears the moment the map has rows again.
          </p>
        </div>
      ) : (
        <GroupsBoard rows={rows} options={options} sampleFloor={count(SAMPLE_FLOOR)} />
      )}

      {/* ------------------------------------------------------------------- the truth block */}
      <div className={styles.truth}>
        <span className={styles.truthDot} aria-hidden="true" />
        <div className={styles.truthText}>
          <p>
            This board is <b>{count(rollup.totals.rows)}</b> corner map rows for feed day{' '}
            <b>{provenance.feedDay}</b>, of which <b>{count(rollup.totals.soleSource)}</b> are
            held by a single approved source and <b>{count(rollup.totals.candidates)}</b> are
            candidate corners, bucketed by the first four digits of each stock number. The
            candidate definition is the same one the Monopoly Map ranks on, so the two surfaces
            cannot disagree about what a candidate corner is.
          </p>
          <p>
            {rollup.catalogAvailable ? (
              rollup.classesMissingFromCatalog === 0 ? (
                <>
                  Every one of the <b>{count(rollup.totals.classes)}</b> classes here is
                  answered by the government&rsquo;s own class table. That is measured on each
                  render, not assumed: a class the table cannot name renders the stated absence
                  of a name and is counted in this sentence.
                </>
              ) : (
                <>
                  <b>{count(rollup.classesMissingFromCatalog)}</b> of the{' '}
                  {count(rollup.totals.classes)} classes here are not in the
                  government&rsquo;s class table. Those rows say so instead of showing a name,
                  and their counts are unaffected.
                </>
              )
            ) : (
              <>The government class table could not be read on this render, so no class on this board carries a title. The counts are unaffected.</>
            )}
          </p>
          <p className={styles.truthProv}>
            Counted from <code>{provenance.sourceArchiveKey}</code>{' '}
            <span className={styles.faint}>
              sha256 {provenance.sourceArchiveSha256.slice(0, 12)}…
            </span>{' '}
            · class and group titles from the H2 tables of the DLA PUB LOG extract, published
            free and refreshed on the first business day of each month · source status is
            inferred from public award silence, which federal reporting does not require below
            the micro-purchase threshold, so it is a signal and not a death notice.
          </p>
        </div>
      </div>
    </main>
  )
}
