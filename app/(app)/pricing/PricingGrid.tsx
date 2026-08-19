'use client'

/*
 * THE PRICING BOARD GRID. Owner: @PRICE-SURFACE.
 *
 * Every served requirement with the number we would quote on it, ordered so the strongest
 * bases are worked first.
 *
 * =========================================================================================
 * A BAND AND A POINT ARE DIFFERENT SHAPES, NOT THE SAME SHAPE WITH A DIFFERENT STRING
 * =========================================================================================
 * A point is one figure. A band is a RANGE, and its width IS its uncertainty, so it renders
 * as two endpoints with a rule drawn between them and the word "to" carrying the join. At a
 * glance, across a column of rows, a band reads as a span and a point reads as a number, and
 * neither can be mistaken for the other from across a desk.
 *
 * The types make the mistake unavailable rather than merely discouraged: `WireFigure` shares
 * no numeric field name across its two arms, so a cell that reads a band as though it were a
 * point does not compile. There is no midpoint anywhere in this file and no rounding of a
 * band into a number.
 *
 * =========================================================================================
 * CONFIDENCE IS THE RUNG. THERE IS NO SCORE COLUMN AND THERE WILL NOT BE ONE
 * =========================================================================================
 * A 0 to 100 confidence number nobody can audit reads as a measurement and is a feeling. The
 * Basis column carries the rung in the operator's own language, verbatim from the engine's
 * `RUNG_LABELS`, and the sort on that column is the ladder's own order. Sorting by
 * "confidence" and sorting by basis are therefore the same operation, which is the point.
 *
 * =========================================================================================
 * NO EVALUATED FIGURE CROSSES THIS WIRE (BD-18)
 * =========================================================================================
 * The $200 and $600 are DLA's evaluation factors: the buyer adds them to our total when it
 * ranks us. They are not part of the quote and not a cost we pay. The dossier renders them in
 * their own block under their own heading, where there is room to say what they are. A dense
 * grid has no such room, and a column of the buyer's arithmetic one cell away from a column of
 * ours is exactly how a $600 gets typed into DIBBS. So the wire row has no evaluated field at
 * all and this file cannot render one.
 */

import Link from 'next/link'
import type { Route } from 'next'
import { DataGrid, type Cell, type GridColumn } from '@/components/ui/DataGrid'
import { StatusChip } from '@/components/ui/StatusChip'
import type { PricingWireRow } from './wire'
import styles from './pricing.module.css'

const usd = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const usd0 = (n: number): string => `$${Math.round(n).toLocaleString()}`

/** The one figure renderer. Every price on this page goes through it, band or point. */
function Figure({ row }: { row: PricingWireRow }) {
  const f = row.figure
  if (f === null) return null
  if (f.kind === 'POINT') {
    return (
      <span className={styles.fig} data-kind="point">
        <span className={styles.figPoint}>{usd(f.unitPriceUsd)}</span>
        <span className={styles.figUnit}>a unit</span>
      </span>
    )
  }
  return (
    <span className={styles.fig} data-kind="band">
      <span className={styles.figBand}>
        <span className={styles.figEnd}>{usd(f.lowUnitPriceUsd)}</span>
        {/* The rule is the band. It is drawn, not described, so the shape reads before the text. */}
        <span className={styles.figRule} aria-hidden="true" />
        <span className={styles.figJoin}>to</span>
        <span className={styles.figEnd}>{usd(f.highUnitPriceUsd)}</span>
      </span>
      <span className={styles.figUnit}>
        a unit
        {row.rung === 'R5_FSC_PEER_BAND' && row.observationCount !== null
          ? `, from ${row.observationCount} priced peers in this supply class`
          : ''}
      </span>
    </span>
  )
}

const columns: GridColumn<PricingWireRow>[] = [
  {
    id: 'nsn',
    header: 'Stock number',
    mono: true,
    pinned: true,
    width: '18ch',
    sortValue: (r) => r.digits,
    cell: (r): Cell => ({
      state: 'known',
      provenance: 'measured',
      value: (
        <Link href={`/corner/${r.digits}` as Route} className={styles.nsnLink} prefetch={false}>
          {r.nsn}
        </Link>
      ),
    }),
  },
  {
    id: 'item',
    header: 'Item',
    width: '26ch',
    wrap: true,
    sortValue: (r) => r.nomenclature,
    cell: (r): Cell =>
      r.nomenclature.trim() === ''
        ? { state: 'unknown', reason: 'the published line carried no nomenclature' }
        : { state: 'known', provenance: 'measured', value: r.nomenclature },
  },
  {
    /*
     * THE RECOMMENDATION. The widest column on the page, because it is the answer the page
     * exists to give, and the arithmetic sits directly under it so the figure is never read
     * without the derivation that produced it.
     */
    id: 'figure',
    header: 'Recommended quote, per unit',
    width: '34ch',
    /*
     * SORTED ON THE LOW ENDPOINT OF A BAND, never on a midpoint. A midpoint does not exist in
     * this payload and computing one here to sort by would be inventing the number the band
     * exists to avoid publishing.
     */
    sortValue: (r) =>
      r.figure === null
        ? -1
        : r.figure.kind === 'POINT'
          ? r.figure.unitPriceUsd
          : r.figure.lowUnitPriceUsd,
    cell: (r): Cell => {
      if (r.figure === null) {
        // An abstention is an ANSWER and it names the input to go and get. Never a zero.
        return { state: 'unknown', reason: r.missingInput ?? 'no rung on the ladder reached' }
      }
      return {
        state: 'known',
        value: (
          <span className={styles.figCell}>
            <Figure row={r} />
            {r.arithmetic ? <span className={`mono ${styles.arith}`}>{r.arithmetic}</span> : null}
          </span>
        ),
      }
    },
  },
  {
    id: 'basis',
    header: 'Basis, and how sure',
    width: '30ch',
    wrap: true,
    // The ladder's own order IS the confidence order. Sorting here sorts by confidence.
    sortValue: (r) => r.strengthRank,
    cell: (r): Cell => {
      if (r.rung === null) {
        return { state: 'unknown', reason: 'no rung on the basis ladder reached this row' }
      }
      const tone =
        r.rung === 'R1_MANUFACTURER_ANCHOR' || r.rung === 'R2_LAST_AWARD_MULTIPLE'
          ? 'verified'
          : r.rung === 'R5_FSC_PEER_BAND'
            ? 'idle'
            : 'active'
      return {
        state: 'known',
        value: (
          <span className={styles.basisCell}>
            <StatusChip tone={tone}>{r.confidence ?? 'basis'}</StatusChip>
            {/* Verbatim from the engine. No surface rewrites the operator's own language. */}
            <span className={styles.basisLabel}>{r.rungLabel}</span>
          </span>
        ),
      }
    },
  },
  {
    id: 'width',
    header: 'How wide',
    align: 'end',
    mono: true,
    width: '11ch',
    sortValue: (r) => (r.figure?.kind === 'BAND' ? r.figure.widthRatio : r.figure ? 0 : -1),
    cell: (r): Cell => {
      if (r.figure === null) return { state: 'unknown', reason: 'no figure on this row' }
      if (r.figure.kind === 'POINT') {
        // A point genuinely has no width. That is a measured fact about it, not a gap.
        return { state: 'empty' }
      }
      return {
        state: 'known',
        value: `${(1 + r.figure.widthRatio).toFixed(2)}x`,
      }
    },
  },
  {
    id: 'evidence',
    header: 'Standing on',
    width: '17ch',
    sortValue: (r) => r.observationCount ?? -1,
    cell: (r): Cell => {
      if (r.observationCount === null) {
        return { state: 'unknown', reason: 'nothing on this row resolved to an observation' }
      }
      return {
        state: 'known',
        provenance: 'measured',
        value: (
          <span className={styles.evidenceCell}>
            <span>
              {r.observationCount} {r.observationCount === 1 ? 'observation' : 'observations'}
            </span>
            {r.basisDateIso ? (
              <span className={`mono ${styles.faint}`}>newest {r.basisDateIso}</span>
            ) : (
              <span className={styles.faint}>none of them dated</span>
            )}
          </span>
        ),
      }
    },
  },
  {
    id: 'qty',
    header: 'Qty',
    mono: true,
    align: 'end',
    width: '9ch',
    sortValue: (r) => r.quantity ?? -1,
    cell: (r): Cell =>
      r.quantity === null
        ? { state: 'unknown', reason: 'did not parse from the index row' }
        : { state: 'known', provenance: 'measured', value: r.quantity.toLocaleString() },
  },
  {
    /*
     * WHAT WE SEND. The heading says so in words, because "total" on its own is the field an
     * operator would fold the evaluation factors into.
     */
    id: 'total',
    header: 'What we send',
    helpId: undefined,
    mono: true,
    align: 'end',
    width: '17ch',
    sortValue: (r) =>
      r.quotedTotal === null ? -1 : r.quotedTotal.kind === 'TOTAL' ? r.quotedTotal.usd : r.quotedTotal.lowUsd,
    cell: (r): Cell => {
      if (r.quotedTotal === null) {
        return {
          state: 'unknown',
          reason:
            r.figure === null
              ? 'no recommended figure to extend'
              : 'the requirement quantity did not parse, so there is no total to extend to',
        }
      }
      return {
        state: 'known',
        value:
          r.quotedTotal.kind === 'TOTAL'
            ? usd0(r.quotedTotal.usd)
            : `${usd0(r.quotedTotal.lowUsd)} to ${usd0(r.quotedTotal.highUsd)}`,
      }
    },
  },
  {
    id: 'flags',
    header: 'Before you send it',
    width: '19ch',
    sortValue: (r) => (r.crossesDladBand ? 0 : 1),
    cell: (r): Cell => {
      if (!r.crossesDladBand && r.caveatCount === 0) {
        return r.rung === null
          ? { state: 'unknown', reason: 'nothing was computed, so nothing was flagged' }
          : { state: 'empty' }
      }
      return {
        state: 'known',
        value: (
          <span className={styles.flagCell}>
            {r.crossesDladBand ? (
              /*
               * NOT the clock's amber and NOT red: this is lawful and uncapped, it simply
               * stops the buy being automatic. Overstating it as urgency would teach the
               * operator to read past the colour that does mean the clock.
               */
              <StatusChip tone="accent" srLabel="crosses the DLAD 17.7505 price increase band">
                DLAD notice
              </StatusChip>
            ) : null}
            {r.caveatCount > 0 ? (
              <span className={styles.faint}>
                {r.caveatCount} {r.caveatCount === 1 ? 'caveat' : 'caveats'} on the dossier
              </span>
            ) : null}
          </span>
        ),
      }
    },
  },
]

export function PricingGrid({ rows }: { rows: PricingWireRow[] }) {
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      rowKey={(r) => `${r.digits}|${r.solicitation}`}
      label="Recommended quotes, strongest basis first"
      density="comfortable"
      empty={{
        cause: 'computing',
        message:
          'No served requirement reached this table. The ladder is computed from the award ' +
          'history and the supply-class peers on disk, and neither has been read here.',
      }}
    />
  )
}
