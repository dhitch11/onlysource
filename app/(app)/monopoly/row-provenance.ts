/**
 * THE TWO LINES THAT MAKE THE TRUTH STRIP'S INSTRUCTION TRUE.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------------------
 * When demand widened from one archived capture to the union of every archived day, the page
 * header stopped being able to cite the source of the rows underneath it: 5,366 counted rows
 * come from 13 distinct captures with 13 distinct hashes, and only 183 of them, 3.4%, come
 * from the newest one the header names. lib/intelligence/corner.ts answered that by putting
 * the citation ON THE ROW (`CornerRow.demand.source`), and the strip on /monopoly was rewritten
 * to say so: "Each row cites the archived government file its own feed day published, with that
 * day's recorded sha256; open a row to read it."
 *
 * The row expansion did not render any of it. MEASURED before this file existed:
 * `grep -c -e sha256 -e archiveStorageKey -e archiveSha256 -e feedDay -e '\.demand'
 * app/(app)/monopoly/MonopolyGrid.tsx` returned 0. So the page shipped the evidence in the
 * flight payload, charged for it in bytes, told the operator where to find it, and never drew
 * it. A false attribution had been replaced by a false instruction, which is the same defect
 * wearing different clothes: a basis claimed on screen that the surface does not carry.
 *
 * ---------------------------------------------------------------------------------------
 * WHY IT IS A PURE MODULE AND NOT A LITERAL INSIDE THE GRID
 * ---------------------------------------------------------------------------------------
 * The expansion in MonopolyGrid.tsx is an array literal inside a closure inside a "use client"
 * component, and this repository has no React render harness, so nothing written there can be
 * settled by anything stronger than a grep of the source. A grep cannot tell the row's own key
 * from the map-level key substituted back in, which is exactly the regression worth guarding.
 * As a pure function it is executed by test/feed-window/wiring.test.ts on a synthetic row whose
 * archive key differs from the map's, so putting the map-level key back turns the suite red.
 *
 * ---------------------------------------------------------------------------------------
 * THE HASH IS RENDERED WHOLE, NOT TRUNCATED
 * ---------------------------------------------------------------------------------------
 * The map-level strip shows twelve characters because it is a label. This is a citation, and a
 * citation exists to be checked: `shasum -a 256` on the named file either matches these 64
 * characters or it does not. Twelve characters cannot be checked against anything. It costs no
 * payload, because the field is already on the wire for every row.
 */

import type { CornerDemandProvenance } from '@/lib/intelligence/corner'

/** One `field`/`value` pair, exactly the shape `DataGrid`'s `expansion` renders. */
export type ProvenanceEntry = { field: string; value: string }

/**
 * The row's own citation, or a STATED reason it has none. Never a blank, never a map-level
 * value standing in for a row-level one.
 *
 * `basis` is the map's own discriminator (`CornerMap.coverage.basis`) and it is required
 * rather than inferred, because "this row has no day of its own" means two completely
 * different things in the two worlds and the row cannot tell them apart by itself:
 *
 *   single_day  the board was built from one capture, so the file cited at the top of the
 *               page IS this row's source and there is nothing per-row to add.
 *   window      the board was built over many captures and this row could not be resolved to
 *               one of them. That is a wiring fault, it is already named in the row's own
 *               gaps by `buildCornerMap`, and it must read as a refusal here, never as
 *               "the header covers it".
 */
export function rowProvenanceEntries(
  demand: CornerDemandProvenance | null | undefined,
  basis: 'window' | 'single_day',
): ProvenanceEntry[] {
  if (demand == null) {
    return basis === 'single_day'
      ? [
          {
            field: 'Feed day',
            value:
              'this board was built from the single archived capture named at the top of the page, which is this row\'s own source',
          },
        ]
      : [
          {
            field: 'Feed day',
            value:
              'not carried on this row. This board was built over several archived captures and this row could not be resolved to one of them, so no government file can be cited for it. The reason is listed under "What is not established" below.',
          },
        ]
  }

  const { source } = demand
  const hash =
    source.archiveSha256 == null
      ? 'sha256 not recorded in the manifest for this capture'
      : `sha256 ${source.archiveSha256}`

  return [
    {
      field: 'Feed day',
      value:
        demand.observedDays.length > 1
          ? `${source.feedDay} (the newest of ${demand.observedDays.length} archived days that published this stock number: ${demand.observedDays.join(', ')})`
          : `${source.feedDay} (the only archived day in this window that published this stock number)`,
    },
    {
      field: 'Archived file',
      value: `${source.archiveStorageKey}!${source.archiveMember} · ${hash} · retrieved ${source.retrievedAt}`,
    },
  ]
}
