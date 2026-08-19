import type { Metadata } from 'next'
import Link from 'next/link'
import { requireGateSession } from '@/lib/session/require-gate'
import { resolveDataRoot } from '@/lib/data-root'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import {
  partitionBySizeKnown,
  sizeOfBuy,
  totalKnownSize,
  type SizeOfBuy,
} from '@/lib/intelligence/opportunities/size-of-buy'
import { systemClock } from '@/lib/time/clock'
import { StatusChip } from '@/components/ui/StatusChip'
import { Scrollable } from '@/components/ui/Scrollable'
import { PursueButton } from '@/components/sales/PursueButton'
import { readDeals } from '@/lib/sales/deals-store'
import { normalizeDealRef } from '@/lib/sales/pipeline'
import { ExplainButton } from '@/components/ui/ExplainButton'
import styles from './goldmine.module.css'
import rt from '@/components/ui/responsive-table.module.css'

export const metadata: Metadata = { title: 'No-Quote Goldmine · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

const usd = (n: number | null): string =>
  n == null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const usd0 = (n: number): string => `$${Math.round(n).toLocaleString()}`

const SHOWN = 60

type Enriched = {
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
}

const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000

/**
 * THE NO-QUOTE GOLDMINE.
 *
 * The government put these parts out to buy and not one company sent back a price. When nobody
 * quotes, the buyer has to come back and ask again, which means these are the lanes where a supplier
 * walks in with no competition. The split is the whole point: where nobody holds material anywhere,
 * the only way to win is to make it, and that make-side set is the one a person cannot work by hand.
 *
 * Every row is a real solicitation from the government file. Nothing is estimated except the labelled
 * "size" figure, which is simply the last unit price times the quantity asked for.
 *
 * ==========================================================================================
 * WHY THIS PAGE NOW HAS A SECOND TABLE PER SECTION.
 * ==========================================================================================
 * The size figure used to fall back to `0` whenever a leg was missing, and this page ranks by it
 * and cuts at 60 rows. Measured on the current file (data/seed/NO QUOTES.xlsx, 2026-08-18): 68 of
 * 839 solicitations carry a real government quantity and no recorded last sold price, 61 of them
 * on the make-side, where the 60th row by size is $211,500. Every one of those 68 sorted to the
 * bottom at a fabricated zero and was never rendered. No number on the screen was invented; the
 * ORDER was, and the order decides which real opportunities an operator ever sees.
 *
 * So unknown is now its own class (lib/intelligence/opportunities/size-of-buy.ts), it ranks by the
 * quantity the government DID publish, and it gets its own labelled block with its own count. A
 * class that merely sorts last is still invisible behind the cut.
 */
export default async function GoldminePage() {
  await requireGateSession('/goldmine')

  if (!resolveDataRoot().present) {
    return (
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Opportunities</p>
          <h1 className={styles.h1}>No-Quote Goldmine</h1>
        </header>
        <div className={styles.unavailable}>
          <h2 className={styles.unavailableTitle}>Today&rsquo;s government data hasn&rsquo;t loaded yet</h2>
          <p>This list is built straight from the DLA solicitation files. It appears the moment the feed is here.</p>
        </div>
      </main>
    )
  }

  const { noQuote, cornerMap } = buildAllDatasets()
  const nowMs = systemClock.now()
  // Only link a stock number into the dossier when a dossier actually exists for it. Many no-quote
  // solicitations are not in the approved-source corner map, and a dossier for those 404s. Those
  // render as plain text so no row ever links to a dead page.
  const cornerDigits = new Set(cornerMap.rows.map((r) => r.nsn.replace(/[^0-9]/g, '')))

  const enrich = (r: (typeof noQuote.rows)[number]): Enriched => {
    const closeMs = r.closeDate ? Date.parse(r.closeDate) : NaN
    return {
      nsn: r.nsn,
      digits: r.nsn.replace(/[^0-9]/g, ''),
      description: r.description.trim() || 'not described on this line',
      solicitation: r.solicitation,
      quantity: r.quantity,
      lastSoldPrice: r.lastSoldPrice,
      closeDate: r.closeDate,
      size: sizeOfBuy(r.lastSoldPrice, r.quantity),
      recent: Number.isFinite(closeMs) && closeMs <= nowMs && closeMs >= nowMs - NINETY_DAYS,
      holders: r.holders,
    }
  }

  const all = noQuote.rows.map(enrich)
  const makeSideRows = all.filter((r) => r.holders.length === 0)
  const sourcingRows = all.filter((r) => r.holders.length > 0)
  const makeSide = partitionBySizeKnown(makeSideRows)
  const sourcing = partitionBySizeKnown(sourcingRows)
  // The total and the count it could not include, travelling together, so the tile below cannot
  // print the money without the disclosure that belongs beside it.
  const makeSideValue = totalKnownSize(makeSideRows)

  // The refs already in the pipeline, so a pursued row renders flipped on first paint.
  const pursued = new Set(readDeals().map((d) => normalizeDealRef(d.ref)).filter(Boolean))

  // The live provenance line each tile's explainer carries: the actual files this page's
  // numbers were joined from, read from the dataset's own provenance object at render time.
  const nqProv = noQuote.provenance
  const nqSource = `Counted from ${nqProv.solicitations.path.split('/').pop()} joined to ${nqProv.availability.path.split('/').pop()}`

  const metrics: Array<{ display: string; label: string; hint: string; hot: boolean; helpId?: string; sourceDetail?: string }> = [
    { display: noQuote.summary.solicitations.toLocaleString(), label: 'solicitations, zero quotes', hint: 'nobody sent the government a price', hot: false, helpId: 'capability.no_quote', sourceDetail: nqSource },
    { display: noQuote.summary.makeSideOnly.toLocaleString(), label: 'no supplier matched', hint: 'the make-side: likely built, not sourced', hot: true },
    { display: noQuote.summary.withHolder.toLocaleString(), label: 'someone holds material', hint: 'a sourcing job, an hour of work', hot: false },
    {
      display: makeSideValue.counted > 0 ? usd0(makeSideValue.usd) : '—',
      label: 'make-side size of buy',
      // The hint states what the total LEFT OUT, counted, never assumed. "Every make-side buy
      // added up" was the old wording and it was not true of a total that skips unpriced rows.
      hint:
        makeSideValue.unsized === 0
          ? 'last price times quantity, every make-side buy added up'
          : `last price times quantity, across ${makeSideValue.counted.toLocaleString()} of ${makeSideRows.length.toLocaleString()} make-side buys. ${makeSideValue.unsized.toLocaleString()} cannot be sized and are listed separately below`,
      hot: true,
      helpId: 'capability.modeled_size_of_buy',
      sourceDetail: nqSource,
    },
  ]

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Opportunities</p>
        <h1 className={styles.h1}>No-Quote Goldmine</h1>
        <p className={styles.sub}>
          Parts the government tried to buy and got <b>zero</b> quotes back on. No competition showed
          up, so the buyer has to come back and ask again. These closed buys are the proof that the
          lane is wide open, and the same order returns. Get in front of the next one. A stock number
          that is also on the corner map links into its dossier.
        </p>
      </header>

      <section className={styles.metricStrip} aria-label="Goldmine totals">
        {metrics.map((m) => (
          <div key={m.label} className={`${styles.metric} ${m.hot ? styles.metricHot : ''}`}>
            {m.helpId ? (
              <div className={styles.metricHelp}>
                <ExplainButton helpId={m.helpId} size="sm" sourceDetail={m.sourceDetail} />
              </div>
            ) : null}
            <span className={styles.metricN}>{m.display}</span>
            <span className={styles.metricLabel}>{m.label}</span>
            <span className={styles.metricHint}>{m.hint}</span>
          </div>
        ))}
      </section>

      {/* -------------------------------------------------- make-side: the millions class */}
      <Section
        title="Make-side: no supplier matched in this run"
        blurb="The supplier match found no one holding material for these, so the likely way to fill the order is to make the part. Read it as the strongest lead we can derive, not as a census: it means no match in the availability workbook this page joins, over the suppliers that run covered, and a holder outside it would not appear here."
        sized={makeSide.sized}
        unsized={makeSide.unsized}
        linkable={cornerDigits}
        pursued={pursued}
      />

      {/* ---------------------------------------------------------- sourcing: someone holds */}
      <Section
        title="Sourcing: someone already holds material"
        blurb="A supplier shows stock against these, so the job is finding and moving material, not making it. Faster to win, smaller edge."
        sized={sourcing.sized}
        unsized={sourcing.unsized}
        linkable={cornerDigits}
        pursued={pursued}
        showHolders
      />
    </main>
  )
}

function Section({
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
  /** Rows we could put a dollar figure on, already ranked largest first. */
  sized: Enriched[]
  /** Rows we could not, already ranked by the quantity the government published. */
  unsized: Enriched[]
  linkable: Set<string>
  /** Normalized deal refs already in the pipeline. */
  pursued: Set<string>
  showHolders?: boolean
}) {
  const total = sized.length + unsized.length
  if (total === 0) {
    return (
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>{title}</h2>
        <p className={styles.empty}>Nothing in this class on today&rsquo;s file.</p>
      </section>
    )
  }
  const shownSized = sized.slice(0, SHOWN)
  const shownUnsized = unsized.slice(0, SHOWN)
  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>{title}</h2>
      <p className={styles.cardSub}>{blurb}</p>

      {sized.length > 0 ? (
        <>
          <OpportunityTable rows={shownSized} linkable={linkable} pursued={pursued} showHolders={showHolders} />
          {/* "top 60 of 418" is itself a partial count while 61 more buys sit in the block
              below, so the two numbers are stated together rather than left to be reconciled. */}
          <p className={styles.tableFoot}>
            Showing the top {shownSized.length.toLocaleString()} of {sized.length.toLocaleString()} by
            size of buy. &ldquo;Size of buy&rdquo; is the last unit price times the quantity asked
            for, a rough figure, not a quote.
            {unsized.length > 0
              ? ` A further ${unsized.length.toLocaleString()} ${unsized.length === 1 ? 'buy' : 'buys'} in this class could not be sized at all; they are listed below.`
              : ''}
          </p>
        </>
      ) : (
        <p className={styles.empty}>
          No buy in this class carries both a last sold price and a quantity, so none of them can be
          sized. They are all listed below.
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
      {unsized.length > 0 ? (
        <>
          <h3 className={styles.eyebrow}>
            Size unknown: {unsized.length.toLocaleString()}{' '}
            {unsized.length === 1 ? 'buy' : 'buys'}
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
          <OpportunityTable rows={shownUnsized} linkable={linkable} pursued={pursued} showHolders={showHolders} />
          <p className={styles.tableFoot}>
            Showing {shownUnsized.length.toLocaleString()} of {unsized.length.toLocaleString()} by
            quantity asked for. Pursuing one of these starts a deal with no value rather than an
            invented one.
          </p>
        </>
      ) : null}
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
            <tr key={`${r.digits}:${r.solicitation}`}>
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
       */}
      {rows.length > 10 ? (
        <p className={rt.cappedNote}>
          Showing the first 10 of {rows.length.toLocaleString()} here to keep this readable on a
          narrow screen. Turn your phone sideways or open this on a wider screen for all{' '}
          {rows.length.toLocaleString()}. Nothing is removed: your browser&rsquo;s own find still
          reaches every row.
        </p>
      ) : null}
    </>
  )
}
