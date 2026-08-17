/**
 * READERS FOR THE ARCHIVED DAILY FEED. Scoped to what the Monopoly Map consumes.
 *
 * T2 owns the production ingestion. These read the bytes T2 already rescued into the landing
 * archive, so this lane can compute a real map today instead of waiting. When T2's loaders
 * land, these callers move to their tables and this file goes away.
 *
 * Two file shapes, both measured on the real archived files for feed day 2026-08-11:
 *
 *  - The approved-source file is quoted CSV, `"NSN","CAGE","PART_NUMBER",""`, 3,684 lines
 *    resolving to 2,149 distinct stock numbers and 1,685 distinct companies. This is the
 *    item-to-approved-source mapping, and inverting it is what makes the manufacturer view
 *    possible at all.
 *
 *  - The index is fixed width, every row exactly 140 characters. Fixed width means the field
 *    boundaries are the specification, so they are named constants here rather than magic
 *    slice offsets scattered through the code.
 */

import { readFileSync } from 'node:fs'
import type { Cage, Niin } from '../niin'
import { parseNsn } from '../niin'

/* ------------------------------------------------------------------------------------ */
/* THE APPROVED SOURCE FILE                                                               */
/* ------------------------------------------------------------------------------------ */

export type ApprovedSourceEntry = {
  niin: Niin
  nsn: string
  cage: Cage
  partNumber: string
}

export type ApprovedSourceIndex = {
  entries: ApprovedSourceEntry[]
  /** stock number to the set of companies approved to make it. */
  byNiin: Map<Niin, Set<Cage>>
  /** company to the stock numbers it is an approved source for. THE INVERSION. */
  byCage: Map<Cage, Set<Niin>>
  /** Lines the file carried that could not be parsed. Reported, never silently dropped. */
  unparsedLines: number
}

export function readApprovedSourceFile(path: string): ApprovedSourceIndex {
  return parseApprovedSourceText(readFileSync(path, 'utf8'))
}

/**
 * The text form, so the approved-source member can be parsed straight out of the archived
 * zip in memory (lib/intelligence/feed-day.ts) with NO derived file in the provenance
 * chain. Byte-for-byte the same parse as the path form: the path form delegates here.
 */
export function parseApprovedSourceText(text: string): ApprovedSourceIndex {
  const entries: ApprovedSourceEntry[] = []
  const byNiin = new Map<Niin, Set<Cage>>()
  const byCage = new Map<Cage, Set<Niin>>()
  let unparsedLines = 0

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    const fields = line.split(',').map((f) => f.replace(/^"|"$/g, '').trim())
    const nsn = fields[0]
    const cage = fields[1]
    if (!nsn || !cage) {
      unparsedLines += 1
      continue
    }
    const parsed = parseNsn(nsn)
    if (!parsed) {
      unparsedLines += 1
      continue
    }
    const entry: ApprovedSourceEntry = {
      niin: parsed.niin,
      nsn,
      cage,
      partNumber: fields[2] ?? '',
    }
    entries.push(entry)
    addTo(byNiin, parsed.niin, cage)
    addTo(byCage, cage, parsed.niin)
  }

  return { entries, byNiin, byCage, unparsedLines }
}

/* ------------------------------------------------------------------------------------ */
/* THE DAILY INDEX. Fixed width, so the offsets ARE the specification.                    */
/* ------------------------------------------------------------------------------------ */

/**
 * Field boundaries, measured against the real archived file. Named because a bare
 * `line.slice(96, 103)` in a parser is unreadable and unreviewable.
 *
 * Every row in the real file is exactly 140 characters, which is asserted on read rather
 * than assumed, because a width drift silently shifts every field after the change.
 */
export const INDEX_FIELDS = {
  solicitation: [0, 13],
  nsn: [13, 26],
  purchaseRequest: [62, 72],
  returnDate: [72, 80],
  pdfName: [80, 99],
  quantity: [99, 106],
  unitOfIssue: [106, 108],
  nomenclature: [108, 130],
} as const

export const INDEX_ROW_WIDTH = 140

export type IndexRow = {
  solicitation: string
  nsn: string
  niin: Niin | null
  quantity: number | null
  unitOfIssue: string
  nomenclature: string
  returnDate: string
  purchaseRequest: string
}

export type DailyIndex = {
  rows: IndexRow[]
  byNiin: Map<Niin, IndexRow[]>
  /** Rows whose width did not match the specification. A drift signal, not a rounding error. */
  offWidthRows: number
  unparsedNsn: number
}

export function readDailyIndex(path: string): DailyIndex {
  return parseDailyIndexText(readFileSync(path, 'utf8'))
}

/** The text form of the index parse. See parseApprovedSourceText for why it exists. */
export function parseDailyIndexText(text: string): DailyIndex {
  const rows: IndexRow[] = []
  const byNiin = new Map<Niin, IndexRow[]>()
  let offWidthRows = 0
  let unparsedNsn = 0

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '') continue
    // The width assertion is the drift canary. A file that changes shape must be loud.
    if (rawLine.length !== INDEX_ROW_WIDTH) offWidthRows += 1
    const cut = (f: readonly [number, number]) => rawLine.slice(f[0], f[1]).trim()

    const nsn = cut(INDEX_FIELDS.nsn)
    const parsed = parseNsn(nsn)
    if (!parsed) unparsedNsn += 1

    const qtyRaw = cut(INDEX_FIELDS.quantity)
    const quantity = /^\d+$/.test(qtyRaw) ? Number(qtyRaw) : null

    const row: IndexRow = {
      solicitation: cut(INDEX_FIELDS.solicitation),
      nsn,
      niin: parsed?.niin ?? null,
      quantity,
      unitOfIssue: cut(INDEX_FIELDS.unitOfIssue),
      nomenclature: cut(INDEX_FIELDS.nomenclature),
      returnDate: cut(INDEX_FIELDS.returnDate),
      purchaseRequest: cut(INDEX_FIELDS.purchaseRequest),
    }
    rows.push(row)
    if (row.niin) {
      const list = byNiin.get(row.niin)
      if (list) list.push(row)
      else byNiin.set(row.niin, [row])
    }
  }

  return { rows, byNiin, offWidthRows, unparsedNsn }
}

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const found = map.get(key)
  if (found) found.add(value)
  else map.set(key, new Set([value]))
}
