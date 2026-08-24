'use client'

/*
 * THE GOLDMINE'S TABLES, AND THE BOX THAT FINDS A ROW IN THEM.
 *
 * ==========================================================================================
 * WHY THIS FILE EXISTS AT ALL
 * ==========================================================================================
 * `/goldmine` rendered 187 rows across four hand-rolled `<table>` elements with no search box,
 * no sort control and no input of any kind. The searchable-grid gate in `test/suppliers` could
 * not see it: that gate finds grids by grepping `app/` for the shared grid component's opening
 * tag, and a page that hand-rolls its tables is invisible to it. The gap was found by pressing
 * every control on the page and finding there were none.
 *
 * ★ THE CAP IS WHY THE SEARCH HAD TO FILTER THE DATA AND NOT THE DOM.
 * Each block renders `SHOWN` rows out of a much longer list, so a naive box that filtered only
 * the rows already on screen would answer "nothing found" for a real government buy sitting at
 * position 61. That is a FALSE ABSENCE, which is this estate's dominant defect class, and it
 * would have been invisible: the operator sees an empty result and concludes the buy is not
 * there. So the query runs over the FULL list and the cap is applied AFTERWARDS.
 *
 * THE MATCHING RULE IS NOT REIMPLEMENTED HERE. It comes from `components/ui/row-search.ts`, the
 * same module the shared grid uses, so "acme ohio" means the same thing on this page as it does
 * on /suppliers: every term must match, in any field, in any order, and no term may straddle two
 * fields. A second `.includes()` beside it is exactly how two grids come to disagree.
 *
 * WHAT IS IN THE HAYSTACK: identifiers the operator can see on the row. Stock number, part
 * nomenclature, solicitation number, and the holder names only in the block that actually shows
 * a Holders column. Nothing is matched on something the row does not display, because a hit the
 * reader cannot explain is worse than a miss. Size class and recency are not in it: they are
 * facts the page already groups by, and folding them in turns a lookup into a worse copy of the
 * headings above it.
 *
 * WHY THE `/` HOTKEY IS NOT COPIED FROM THE SHARED GRID: this page renders TWO of these boxes,
 * one per class, so a single global key would have to pick one and would be wrong half the time.
 * Escape-to-clear and the clear button are local to a box and are kept.
 */

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { StatusChip } from '@/components/ui/StatusChip'
import { Scrollable } from '@/components/ui/Scrollable'
import { PursueButton } from '@/components/sales/PursueButton'
import { normalizeDealRef } from '@/lib/sales/pipeline'
import { haystackOf, matchesTerms, termsOf } from '@/components/ui/row-search'
import type { SizeOfBuy } from '@/lib/intelligence/opportunities/size-of-buy'
import styles from './goldmine.module.css'
import rt from '@/components/ui/responsive-table.module.css'

export type Enriched = {
  nsn: string
  digits: string
  description: string
  solicitation: string
  quantity: number | null
  lastSoldPrice: number | null
  closeDate: string | null
  /** The modeled size of this buy, or the stated reason there is not one. Never a zero. */
  size: SizeOfBuy
  recent: boolean
  holders: Array<{ name: string; unitsAvailable: number | null; basePrice: number | null }>
  /**
   * The React key for this row, computed ONCE over the whole dataset so it is unique across
   * every table on the page. See the block above `all` in page.tsx for why NSN plus
   * solicitation is not enough on this corpus.
   */
  key: string
}

const usd = (n: number | null): string =>
  n == null ? '\u2014' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const usd0 = (n: number): string => `$${Math.round(n).toLocaleString()}`

const SHOWN = 60


export function Section({
  title,
  blurb,
  sized,
  unsized,
  linkable,
  pursued,
  showHolders = false,
}: {
  title: string
  blurb: string
  /** Rows we could put a dollar figure on, already ranked largest first. THE FULL LIST, not a
   *  slice: the search runs over this and the cap is applied after it. */
  sized: Enriched[]
  /** Rows we could not, already ranked by the quantity the government published. Full list. */
  unsized: Enriched[]
  /**
   * Stock-number digits that have a corner dossier, and deal refs already in the pipeline.
   * ARRAYS, not Sets, and deliberately: these cross the server-to-client boundary, and an array
   * is serialisable on every runtime this app targets without depending on the framework's
   * handling of a Set. They are rebuilt into Sets once, here, so the row lookup stays O(1).
   */
  linkable: string[]
  pursued: string[]
  showHolders?: boolean
}) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)

  const linkableSet = useMemo(() => new Set(linkable), [linkable])
  const pursuedSet = useMemo(() => new Set(pursued), [pursued])

  const terms = useMemo(() => termsOf(query.trim()), [query])
  const matched = useMemo(() => {
    if (terms.length === 0) return { sized, unsized }
    const fieldsOf = (r: Enriched) =>
      showHolders
        ? [r.nsn, r.digits, r.description, r.solicitation, ...r.holders.map((h) => h.name)]
        : [r.nsn, r.digits, r.description, r.solicitation]
    const keep = (rows: Enriched[]) => rows.filter((r) => matchesTerms(haystackOf(fieldsOf(r)), terms))
    return { sized: keep(sized), unsized: keep(unsized) }
  }, [sized, unsized, terms, showHolders])

  const total = sized.length + unsized.length
  if (total === 0) {
    return (
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>{title}</h2>
        <p className={styles.empty}>Nothing in this class on today&rsquo;s file.</p>
      </section>
    )
  }

  const searching = terms.length > 0
  const matchedTotal = matched.sized.length + matched.unsized.length
  const shownSized = matched.sized.slice(0, SHOWN)
  const shownUnsized = matched.unsized.slice(0, SHOWN)

  const searchBox = (
    <div className={styles.searchWrap}>
      <label className={styles.srOnly} htmlFor={`gm-search-${showHolders ? 'sourcing' : 'makeside'}`}>
        Search {title}
      </label>
      <span className={styles.searchIcon} aria-hidden="true">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" strokeLinecap="round" />
        </svg>
      </span>
      <input
        id={`gm-search-${showHolders ? 'sourcing' : 'makeside'}`}
        ref={searchRef}
        type="search"
        className={styles.search}
        /* The box says what it searches. One that does not gets read as "search everything" and
           its first miss reads as missing data. */
        placeholder={
          showHolders
            ? 'Search stock number, part, solicitation or holder'
            : 'Search stock number, part or solicitation'
        }
        value={query}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query !== '') {
            e.preventDefault()
            setQuery('')
          }
        }}
      />
      {query !== '' ? (
        <button
          type="button"
          className={styles.searchClear}
          onClick={() => {
            setQuery('')
            searchRef.current?.focus()
          }}
          aria-label="Clear the search"
        >
          &times;
        </button>
      ) : null}
    </div>
  )

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>{title}</h2>
      <p className={styles.cardSub}>{blurb}</p>
      {searchBox}

      {/*
        * THE COUNT AN OPERATOR IS OWED WHILE SEARCHING. Both numbers, always: how many rows
        * answered, and out of how many. A bare "3 buys" while a filter is on is the shape of
        * every number this estate has had to go back and correct.
        */}
      <p className={styles.searchStatus} role="status" aria-live="polite">
        {searching
          ? matchedTotal === 0
            ? `No buy in this class matches that. Searching all ${total.toLocaleString()} in this class, not just the ones listed.`
            : `${matchedTotal.toLocaleString()} of ${total.toLocaleString()} ${matchedTotal === 1 ? 'buy' : 'buys'} in this class match.`
          : `${total.toLocaleString()} ${total === 1 ? 'buy' : 'buys'} in this class. The box searches every one of them, including the ones below the cut.`}
      </p>

      {matchedTotal === 0 ? null : (
        <>
      {matched.sized.length > 0 ? (
        <>
          <OpportunityTable rows={shownSized} linkable={linkableSet} pursued={pursuedSet} showHolders={showHolders} />
          {/* "top 60 of 418" is itself a partial count while 61 more buys sit in the block
              below, so the two numbers are stated together rather than left to be reconciled.
              While a search is on, the denominator is the MATCHING count, never the whole
              class, or the sentence would describe a list the reader is not looking at. */}
          <p className={styles.tableFoot}>
            Showing the top {shownSized.length.toLocaleString()} of {matched.sized.length.toLocaleString()}
            {searching ? ' matching' : ''} by size of buy. &ldquo;Size of buy&rdquo; is the last unit
            price times the quantity asked for, a rough figure, not a quote.
            {matched.unsized.length > 0
              ? ` A further ${matched.unsized.length.toLocaleString()} ${matched.unsized.length === 1 ? 'buy' : 'buys'}${searching ? ' matching' : ''} in this class could not be sized at all; they are listed below.`
              : ''}
          </p>
        </>
      ) : (
        <p className={styles.empty}>
          {searching
            ? 'Nothing matching carries both a last sold price and a quantity, so none of the matches can be sized. Any that matched are listed below.'
            : 'No buy in this class carries both a last sold price and a quantity, so none of them can be sized. They are all listed below.'}
        </p>
      )}

      {/*
       * THE UNKNOWN CLASS, SHOWN RATHER THAN SORTED INTO THE DARK.
       *
       * These rows are the reason the zero was a defect: each one is a real solicitation with a
       * real government quantity, and the missing last sold price is a fact about the file, not a
       * fact about the buy. They rank among themselves by that published quantity, which is the
       * one magnitude the government did state. Nothing here is estimated to fill the gap.
       */}
      {matched.unsized.length > 0 ? (
        <>
          <h3 className={styles.eyebrow}>
            Size unknown: {matched.unsized.length.toLocaleString()}{' '}
            {matched.unsized.length === 1 ? 'buy' : 'buys'}
            {searching ? ' matching' : ''}
          </h3>
          {/* The sentence covers all three ways a size can be missing, because the class does.
              On the current file every one of them is the same case, a real quantity with no
              recorded price, but copy that names only today's case becomes a lie on the day the
              feed changes and nobody re-reads it. */}
          <p className={styles.cardSub}>
            For these the government file is missing one of the two legs a size needs, the last
            sold price or the quantity, so there is nothing to multiply. That is a gap in the
            record, not a small buy, so they are listed here in full rather than ranked as though
            they were worth nothing. Ordered by the quantity the government asked for, largest
            first, with any row that states no quantity at the end.
          </p>
          <OpportunityTable rows={shownUnsized} linkable={linkableSet} pursued={pursuedSet} showHolders={showHolders} />
          <p className={styles.tableFoot}>
            Showing {shownUnsized.length.toLocaleString()} of {matched.unsized.length.toLocaleString()}
            {searching ? ' matching' : ''} by quantity asked for. Pursuing one of these starts a deal
            with no value rather than an invented one.
          </p>
        </>
      ) : null}
        </>
      )}
    </section>
  )
}

/**
 * One table of solicitations. Shared by both blocks in a section so the columns, the dash for an
 * absent value and the pursuit wire are written once and cannot drift apart between them.
 */
function OpportunityTable({
  rows,
  linkable,
  pursued,
  showHolders,
}: {
  rows: Enriched[]
  linkable: Set<string>
  pursued: Set<string>
  showHolders: boolean
}) {
  return (
    <>
    <Scrollable className={`${styles.tableWrap} ${rt.cards} ${rt.capped}`}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Stock number</th>
            <th>Part</th>
            <th className={styles.numCol}>Qty</th>
            <th className={styles.numCol}>Last price</th>
            <th className={styles.numCol}>Size of buy</th>
            <th>Close date</th>
            {showHolders ? <th>Holders</th> : null}
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="mono" data-label="Stock number">
                {linkable.has(r.digits) ? (
                  <Link href={`/corner/${r.digits}` as never} className={styles.nsnLink}>
                    {r.nsn}
                  </Link>
                ) : (
                  <span className={styles.nsnPlain}>{r.nsn}</span>
                )}
              </td>
              <td className={styles.partCell} title={r.description} data-label="Part">
                {r.description}
              </td>
              <td className={`mono ${styles.numCol}`} data-label="Qty">{r.quantity?.toLocaleString() ?? '—'}</td>
              <td className={`mono ${styles.numCol}`} data-label="Last price">{usd(r.lastSoldPrice)}</td>
              <td className={`mono ${styles.numCol} ${styles.sizeCol}`} data-label="Size of buy">
                {r.size.known ? usd0(r.size.usd) : '—'}
              </td>
              <td className={styles.closeCell} data-label="Close date">
                {r.closeDate ? (
                  <span className={styles.closeRow}>
                    <span className="mono">{r.closeDate}</span>
                    {r.recent ? <StatusChip tone="verified">Recent</StatusChip> : null}
                  </span>
                ) : (
                  '—'
                )}
              </td>
              {showHolders ? (
                <td className={styles.holderCell} data-label="Holders">
                  {r.holders.slice(0, 2).map((h) => h.name).join(', ')}
                  {r.holders.length > 2 ? ` +${r.holders.length - 2}` : ''}
                </td>
              ) : null}
              <td data-label="Action">
                {/* The pursuit wire, on rows whose corner dossier exists (the same rows whose
                    stock number links in). The deal carries the modeled buy value only when the
                    government line supplied both legs; otherwise it carries none, and the
                    pipeline says "no value" rather than inventing one. */}
                {linkable.has(r.digits) ? (
                  <PursueButton
                    nsn={r.nsn}
                    niin={r.digits.length === 13 ? r.digits.slice(4) : null}
                    item={r.description === 'not described on this line' ? '' : r.description}
                    valueUsd={r.size.known ? r.size.usd : null}
                    initiallyInPipeline={pursued.has(normalizeDealRef(r.nsn))}
                  />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scrollable>
      {/*
       * The cap is CSS and it only bites below the card breakpoint, so this sentence has to be
       * here at every width and invisible at most of them. A cap the reader cannot see is the
       * silent version of a cap, and this page already prints its own counts — hiding rows
       * underneath a sentence that says "showing 60" would make the page state a number it is
       * not showing.
       *
       * ★ THIS SENTENCE USED TO END "Nothing is removed: your browser's own find still reaches
       * every row." IT WAS FALSE, AND MEASURED FALSE AT 390 ON 2026-08-24. The cap is
       * `.capped tbody tr:nth-child(n + 11) { display: none }`, and 50 of 60 rows were hidden by
       * it. A hidden row is in the MARKUP but not in the rendered text layer: `document.body
       * .innerText`, which is layout-aware, did not contain the hidden row's stock number while a
       * positive control on a VISIBLE row's stock number found it in the same string. Find-in-page
       * reads that rendered layer, so it does not reach a `display: none` row, and neither does a
       * screen reader.
       *
       * The honest repair was not softer wording, it was giving the sentence something TRUE to
       * point at: the search box above this table filters the FULL list rather than the rendered
       * rows, so every row really is reachable now. Measured: a search for a common nomenclature term
       * surfaced 25 buys that were not rendered at rest.
       */}
      {rows.length > 10 ? (
        <p className={rt.cappedNote}>
          Showing the first 10 of {rows.length.toLocaleString()} here to keep this readable on a
          narrow screen. Use the search box above to reach any of them, or turn your phone sideways
          or open this on a wider screen for all {rows.length.toLocaleString()}.
        </p>
      ) : null}
    </>
  )
}
