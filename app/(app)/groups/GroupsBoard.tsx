'use client'

/*
 * THE SUPPLY GROUPS BOARD.
 *
 * =========================================================================================
 * WHAT THIS COMPONENT IS NOT ALLOWED TO DO, AND WHY EACH ONE IS A RULE
 * =========================================================================================
 *
 * 1. IT CANNOT REORDER THE BOARD. There is no sort control on any column and that is
 *    deliberate, not an omission. The rows arrive ordered by evidence, then candidate count,
 *    then class size, and a class with no rate can never outrank one with a measured rate.
 *    Ordering is a claim about importance. Handing an operator a "sort by rate" button on a
 *    board where 77 of 78 rates do not exist and the one that does is not distinguishable
 *    from the average would let the product make a claim the data cannot support, with one
 *    click, and blame the operator for making it.
 *
 * 2. IT CANNOT PRINT A LIFT ON AN INDICATIVE ROW. The decision is made server side in
 *    ./presentation, and the `measured` cell shape has no lift field at all, so the multiple
 *    is not merely hidden here, it does not reach this file. Lift is the number people act
 *    on and a caveat beside it is the part nobody reads.
 *
 * 3. IT CANNOT PRINT A PERCENTAGE ON A CLASS UNDER THE ROW FLOOR. Three candidates in four
 *    rows reads as 75% and is nothing.
 *
 * 4. NOTHING IS BEHIND HOVER. The scope panel opens on a real button, the explainers open on
 *    a real button, and a pointer resting on a row produces nothing at all.
 *
 * =========================================================================================
 * THE FILTERS
 * =========================================================================================
 * Two, both real, both defaulting to off, and both stating the count they would leave. When
 * a filter empties the board it names ITSELF as the cause and offers to remove exactly that
 * one, because "no results" and "your filter excludes everything" are two different facts
 * that look identical and send the reader to different remedies.
 */

import { useId, useMemo, useState } from 'react'
import { ExplainButton } from '@/components/ui/ExplainButton'
import { Scrollable } from '@/components/ui/Scrollable'
import rt from '@/components/ui/responsive-table.module.css'
import { StatusChip } from '@/components/ui/StatusChip'
import { count } from './format'
import type { GroupOption, GroupRowView } from './presentation'
import styles from './groups.module.css'

const ALL = 'all'

export interface GroupsBoardProps {
  rows: GroupRowView[]
  options: GroupOption[]
  /** The row floor, formatted, so the copy below can never disagree with the module. */
  sampleFloor: string
}

export function GroupsBoard({ rows, options, sampleFloor }: GroupsBoardProps) {
  const [fsg, setFsg] = useState<string>(ALL)
  const [onlyCandidates, setOnlyCandidates] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const selectId = useId()
  const checkId = useId()

  const withCandidates = useMemo(() => rows.filter((r) => r.candidates > 0).length, [rows])

  const shown = useMemo(
    () =>
      rows.filter(
        (r) => (fsg === ALL || r.fsg === fsg) && (!onlyCandidates || r.candidates > 0),
      ),
    [rows, fsg, onlyCandidates],
  )

  const groupLabel = options.find((o) => o.fsg === fsg)?.label ?? null
  const filtersOn = fsg !== ALL || onlyCandidates
  const culprit =
    fsg !== ALL && onlyCandidates
      ? 'the supply group filter together with the candidate filter'
      : fsg !== ALL
        ? `the supply group filter (${groupLabel ?? fsg})`
        : 'the candidate filter'

  const clearAll = () => {
    setFsg(ALL)
    setOnlyCandidates(false)
    setOpen(null)
  }

  return (
    <section className={styles.board} aria-label="Federal Supply Classes on this feed day">
      <div className={styles.boardHead}>
        <h2 className={styles.boardTitle}>Every class on the map, with its evidence</h2>
        {/*
         * A <div>, NOT a <p>, and the reason is a measured production defect rather than a
         * preference. `ExplainButton` renders its popover as a SIBLING <div popover>, and
         * `<div>` is not phrasing content, so the HTML parser force-closes an enclosing
         * `<p>` before it. The server's tree and the client's tree then disagree and React
         * throws #418 — which is invisible in dev, invisible to typecheck, invisible to a
         * grep, and shows up only as a console error on the deployed page.
         *
         * This is the second time this exact pairing has produced #418 in this repo. The
         * rule: an element that may contain an ExplainButton can never be a <p>.
         * `.boardSub` carries no p-specific styling, so the swap is purely structural.
         */}
        <div className={styles.boardSub}>
          Ordered by evidence, then by candidate count, then by class size. There is no sort
          control on this board on purpose: the order is itself a claim, and a class with no
          rate must never be able to outrank a class with a measured one. Classes under the{' '}
          {sampleFloor} row floor show their counts and no percentage at all.
          <ExplainButton helpId="groups.insufficient" size="sm" />
        </div>
      </div>

      {/* ------------------------------------------------------------------- the controls */}
      <div className={styles.controls}>
        <div className={styles.control}>
          <label className={styles.controlLabel} htmlFor={selectId}>
            Supply group
          </label>
          <select
            id={selectId}
            className={styles.select}
            value={fsg}
            onChange={(e) => {
              setFsg(e.target.value)
              setOpen(null)
            }}
          >
            <option value={ALL}>All supply groups ({count(options.length)})</option>
            {options.map((o) => (
              <option key={o.fsg} value={o.fsg}>
                {o.label} ({count(o.classes)} {o.classes === 1 ? 'class' : 'classes'})
              </option>
            ))}
          </select>
        </div>

        <div className={styles.control}>
          <label className={styles.checkRow} htmlFor={checkId}>
            <input
              id={checkId}
              type="checkbox"
              className={styles.check}
              checked={onlyCandidates}
              onChange={(e) => {
                setOnlyCandidates(e.target.checked)
                setOpen(null)
              }}
            />
            Only classes holding a candidate corner{' '}
            <span className={styles.checkCount}>
              ({count(withCandidates)} of {count(rows.length)})
            </span>
          </label>
        </div>

        <p className={styles.showing}>
          Showing <b>{count(shown.length)}</b> of <b>{count(rows.length)}</b> classes
          {filtersOn ? ' after filtering' : ''}.
        </p>
      </div>

      {/* --------------------------------------------------------------------- the table */}
      {shown.length === 0 ? (
        <div className={styles.noResults} role="status">
          <p className={styles.noResultsTitle}>Nothing matches this view</p>
          <p className={styles.noResultsBody}>
            {culprit} is excluding every class. Without it this board holds{' '}
            {count(rows.length)} classes. The data has not changed and nothing failed to load.
          </p>
          <button type="button" className={styles.clearBtn} onClick={clearAll}>
            Remove {culprit}
          </button>
        </div>
      ) : (
        <Scrollable className={`${styles.tableWrap} ${rt.cards}`}>
          <table className={styles.table}>
            <caption className="vh">
              Federal Supply Classes on this feed day, ordered by evidence, then candidate
              count, then class size.
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className={styles.headCell}>
                    Class
                    <ExplainButton helpId="groups.class" size="sm" />
                  </span>
                </th>
                <th scope="col">Supply group</th>
                <th scope="col" className={styles.numCol}>
                  Rows
                </th>
                <th scope="col" className={styles.numCol}>
                  Sole source
                </th>
                <th scope="col" className={styles.numCol}>
                  Candidates
                </th>
                <th scope="col">
                  <span className={styles.headCell}>
                    Candidate rate vs map average
                    <ExplainButton helpId="groups.baseline" size="sm" />
                  </span>
                </th>
                <th scope="col">
                  <span className={styles.headCell}>
                    Evidence
                    <ExplainButton helpId="groups.evidence" size="sm" />
                  </span>
                </th>
                <th scope="col" className={styles.detailCol}>
                  Scope
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const isOpen = open === row.key
                const panelId = `groups-scope-${row.key}`
                return (
                  <Row
                    key={row.key}
                    row={row}
                    isOpen={isOpen}
                    panelId={panelId}
                    onToggle={() => setOpen((cur) => (cur === row.key ? null : row.key))}
                  />
                )
              })}
            </tbody>
          </table>
        </Scrollable>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------------------ one row */

function Row({
  row,
  isOpen,
  panelId,
  onToggle,
}: {
  row: GroupRowView
  isOpen: boolean
  panelId: string
  onToggle: () => void
}) {
  return (
    <>
      <tr className={isOpen ? styles.rowOpen : undefined}>
        <td className={styles.classCell} data-label="Class">
          <span className={styles.code}>{row.fsc}</span>
          <span className={`${styles.name} ${row.className.stated ? styles.stated : ''}`}>
            {row.className.name}
          </span>
        </td>

        <td className={styles.groupCell} data-label="Supply group">
          <span className={styles.groupCode}>{row.fsg}</span>{' '}
          <span className={row.groupName.stated ? styles.stated : undefined}>
            {row.groupName.name}
          </span>
        </td>

        <td className={styles.numCol} data-label="Rows">{row.counts.rows}</td>
        <td className={styles.numCol} data-label="Sole source">{row.counts.soleSource}</td>
        <td className={`${styles.numCol} ${row.candidates === 0 ? styles.zero : ''}`} data-label="Candidates">
          {row.counts.candidates}
        </td>

        {/*
         * THE THREE-STATE CELL. `finding` carries the multiple, `measured` carries the rate
         * and says in words that it is not distinguishable, and `untested` carries no
         * percentage at all, only the word and the reason. There is no fourth branch and no
         * fallback, because a fallback here would be the fabrication.
         */}
        <td className={styles.rateCell} data-label="Candidate rate vs map average">
          {row.rate.kind === 'finding' ? (
            <>
              <span className={styles.rateFinding}>{row.rate.rate}</span>
              <span className={styles.rateLift}>{row.rate.lift}</span>
              <span className={styles.rateNote}>{row.rate.note}</span>
            </>
          ) : row.rate.kind === 'measured' ? (
            <>
              <span className={styles.rateMeasured}>{row.rate.rate}</span>
              <span className={styles.rateNote}>{row.rate.note}</span>
            </>
          ) : (
            <>
              <span className={styles.untested}>
                <span className={styles.untestedGlyph} aria-hidden="true" />
                <span>{row.rate.word}</span>
              </span>
              <span className={styles.untestedWhy}>{row.rate.why}</span>
            </>
          )}
        </td>

        <td data-label="Evidence">
          <StatusChip tone={row.chip.tone} srLabel={row.chip.srLabel}>
            {row.chip.word}
          </StatusChip>
        </td>

        <td className={styles.detailCol} data-label="Scope">
          <button
            type="button"
            className={styles.detailBtn}
            aria-expanded={isOpen}
            aria-controls={panelId}
            onClick={onToggle}
          >
            {isOpen ? 'Hide' : 'Read'}
            <span className="vh">
              {' '}
              the government scope note and the test behind class {row.fsc}
            </span>
          </button>
        </td>
      </tr>

      {isOpen ? (
        <tr className={styles.detailRow} id={panelId}>
          <td colSpan={8}>
            <div className={styles.detail}>
              <div className={styles.detailHeadRow}>
                <span className={styles.detailHead}>
                  The government&rsquo;s own scope note for class {row.fsc}, word for word
                </span>
                {/*
                 * The class explainer, carrying THIS class's scope prose as its live source
                 * line. The registry entry tells the operator to read the includes and
                 * excludes lines before committing to a class; this is where the panel can
                 * actually hand them over, per class, without a figure being typed into
                 * static help text where it would go stale in silence.
                 */}
                <ExplainButton helpId="groups.class" size="sm" sourceDetail={row.scopeProse} />
              </div>

              <dl className={styles.scope}>
                {row.scope.map((line) => (
                  <div key={line.field} className={styles.scopeItem}>
                    <dt className={styles.scopeField}>{line.field}</dt>
                    <dd
                      className={`${styles.scopeValue} ${line.stated ? styles.scopeAbsent : ''}`}
                    >
                      {line.value}
                    </dd>
                  </div>
                ))}
              </dl>

              {/* A <div> for the same reason as boardSub above: an ExplainButton's popover is
                  a sibling <div>, which force-closes an enclosing <p> and desyncs the server
                  and client trees. This one sits inside an expanded row, so it only rendered
                  #418 once a row was opened - which is why it survived the first fix. */}
              <div className={styles.testLine}>
                {row.test}
                {row.rate.kind === 'untested' ? (
                  <ExplainButton helpId="groups.insufficient" size="sm" />
                ) : (
                  <ExplainButton helpId="groups.evidence" size="sm" />
                )}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}
