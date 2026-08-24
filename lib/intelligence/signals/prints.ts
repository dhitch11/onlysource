/**
 * THE NSN-NOW `Prints` FLAG. A PRESENT FACT WITH AN UNKNOWN MEANING, CARRIED AS EXACTLY THAT.
 *
 * =====================================================================================
 * WHAT THIS IS
 * =====================================================================================
 * Every NSN-Now Batch Export ships an MCRL sheet (the approved-source list for the item)
 * and that sheet carries a column literally headed `Prints`. Measured over the workbooks
 * on disk (see COVERAGE below), it is populated on 30.35% of MCRL rows with a single flag
 * value, `X`.
 *
 * =====================================================================================
 * WHAT THIS IS NOT, AND WHY THE DISTINCTION IS THE ENTIRE POINT
 * =====================================================================================
 * WE DO NOT HOLD A DECODER FOR THIS COLUMN, AND WE HAVE NOT ESTABLISHED THAT ONE EXISTS.
 * So what we know is:
 *
 *     a flag is PRESENT on this row
 *
 * and what we DO NOT know is:
 *
 *     that the flag means an engineering drawing is obtainable
 *
 * Those are different claims and this module only ever makes the first one. It does not say
 * "drawing available", it does not say "blueprint available", and nothing it returns may be
 * rendered as either.
 *
 * ==========================================================================================
 * ⛔ THIS HEADER USED TO NAME A DECODER DOCUMENT. THE CLAIM WAS FALSE. Corrected 2026-08-24.
 * ==========================================================================================
 * It read: "The publisher documents its coding system in a file called `Codes on NSN-Now.docx`
 * which has never been sent to us", and it promised that obtaining that one document "turns a
 * 30%-covered unknown into a 30%-covered fact... the single cheapest upgrade available to this
 * product." Both sentences were wrong in a load-bearing way, and the module carried the same
 * claim in a SHIPPED string and on its returned index, not only in this comment.
 *
 * MEASURED from the file itself, two copies in the estate's own Downloads folder, md5
 * `df29f34b08fa7740c96a5c436ad51bb2`, identical. From `docProps/core.xml`:
 *
 *     dc:creator          David Goodreau
 *     cp:lastModifiedBy   David Goodreau
 *     dcterms:created     2025-12-31T21:59Z      modified 2026-01-06T03:14Z      revision 1
 *
 * And from `word/document.xml`: 477 words, `AMC` 14 times, `AMSC` 9 times, the string `Prints`
 * ZERO times, closing "you want, I can: Decode a specific AMC/AMSC combo from your export".
 *
 * It is the owner's own notes on AMC and AMSC, written six weeks before this platform existed.
 * It is not the publisher's, it does not describe this column, and it was never withheld from
 * us: it was in our own Downloads folder the whole time, twice. The belief traces to a filename.
 *
 * THERE IS NO EVIDENCE NSN-NOW PUBLISHES A CODE LIST FOR `Prints` AT ALL. So the honest state
 * is not "a document exists and we lack it", which is an actionable gap with a known cure. It
 * is "we do not know what this column means and we do not know that anyone has written it
 * down", which is a weaker claim and the true one.
 *
 * ★ THE MODULE'S DECISION DOES NOT CHANGE, AND IT GETS STRONGER. Presence-only, tri-state,
 * unwired, contributing to no score. That was right when it rested on a false premise and it is
 * more right now: a gap whose cure is one email is a gap worth carrying; a gap with no known
 * cure is a gap that must never be leaned on. Do not wire this module on the strength of a
 * document arriving, because nobody has established that there is one to arrive.
 *
 * ---------------------------------------------------------------------------------------
 * AND A BLANK IS NOT A ZERO. THIS IS THE RULE THAT KILLED THE PREVIOUS ATTEMPT.
 * ---------------------------------------------------------------------------------------
 * An earlier lane looked for engineering data in the FLIS `MEDALS` locator, measured it over
 * the whole file (16,576,322 rows / 7,218,168 distinct NIINs), found it populated on 4,332
 * rows = 0.0261%, and correctly refused to ship it: rendering "no engineering data" for
 * 99.94% of the catalogue, where the blank means "not recorded in this field", is a silent
 * zero inside a differentiator.
 *
 * The same rule applies here and it applies harder, because this column is roughly 1,150x
 * denser and therefore far more tempting to read as a negative. It is not a negative. An
 * empty `Prints` cell means the export did not record the flag on that row. It does not mean
 * no drawing exists.
 *
 * So the answer is a TRI-STATE and never a boolean:
 *
 *     flag_present          a row for this stock number carries a non-empty Prints cell
 *     present_without_flag  rows exist for this stock number and none carries the flag
 *     not_in_export         the MCRL sheets we hold do not carry this stock number at all
 *
 * `present_without_flag` and `not_in_export` are DIFFERENT FACTS from DIFFERENT PUBLISHERS
 * of silence: one is the export declining to mark a row it wrote, the other is the export
 * never having written a row. Collapsing them is precisely the defect that sank MEDALS, so
 * they are separate states here and the suite has a control that fails if they merge.
 *
 * =====================================================================================
 * NOT A SCORE INPUT, BY CONSTRUCTION
 * =====================================================================================
 * While the meaning of this flag is unestablished, and it may stay unestablished, this signal
 * contributes to NO score, rank or ranking weight.
 * `PrintsRecord` therefore carries no numeric weight field of any kind, and the suite has a
 * control that fails if one is added, because a number on this record is an invitation to
 * multiply it into a score before anyone has established what it means.
 *
 * =====================================================================================
 * COVERAGE, MEASURED, NOT ASSERTED
 * =====================================================================================
 * Every figure below was counted by this module's own reader over the workbooks on disk on
 * the day it was written. They are restated in `PrintsIndex.coverage` at runtime, so a
 * surface quotes the live count and never this comment.
 *
 *     workbooks discovered                    13   (content-deduped)
 *     workbooks carrying an MCRL sheet         5
 *     MCRL rows read                      14,634
 *     rows carrying the flag               4,441   = 30.35%
 *     rows whose stock number would not parse   0
 *     distinct stock numbers               3,734
 *       flagged                              851
 *       present without the flag           2,883
 *       carrying BOTH a flagged and a blank row  0
 *     distinct flag values observed          'X'   (the only one)
 *
 * Per workbook: full_0 2/7, full_1 757/4,890 = 15.5%, full_2 1,687/4,562 = 37.0%,
 * full_3 1,692/4,310 = 39.3%, suppliers/rural-route-2-parts 303/865 = 35.0%.
 *
 * THE SUPPLIERS WORKBOOK IS WHY THIS READS THE FILES ITSELF rather than borrowing the MCRL
 * rows the award index already parses. `lib/intelligence/awards/nsn-now.ts` reads only
 * `data/nsn-now`, so it never sees `data/suppliers/rural-route-2-parts.xlsx`, which carries
 * 316 stock numbers and 70 flagged stock numbers found nowhere else. Borrowing would have
 * dropped 8.2% of the flagged catalogue silently. It is also not cheaper: measured cold in
 * one process, this reader takes 4,947ms and the award index takes 5,346ms, so the reuse
 * argument was a performance claim that was not true when measured.
 *
 * What IS reused, because a second one would be a defect: the parser. `readWorkbookSheets`
 * and `distinctWorkbookPaths` from `lib/intelligence/seed/xlsx.ts` do all reading and all
 * duplicate-file detection. This repo has a recorded incident where a hand-written greedy
 * regex stole adjacent cell values and corrupted award prices across the product, and the
 * only durable defence against that class is that exactly one parser exists.
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  readWorkbookSheets,
  distinctWorkbookPaths,
  type SeedProvenance,
} from '@/lib/intelligence/seed/xlsx'
import { parseNsn, type Niin } from '@/lib/intelligence/niin'
import { resolveDataRoot } from '@/lib/data-root'

/* ------------------------------------------------------------------------------------ */
/* THE VOCABULARY OF THE EXPORT, NAMED ONCE                                               */
/* ------------------------------------------------------------------------------------ */

/** The sheet that carries the approved-source rows. Resolved by NAME, never by position. */
export const MCRL_SHEET_NAME = 'MCRL'

/** The column header exactly as the publisher spells it. */
export const PRINTS_COLUMN_HEADER = 'Prints'

/** The column that carries the stock number on the MCRL sheet. */
export const NSN_COLUMN_HEADER = 'NSN Number'

/**
 * THE THREE STATES. A tuple rather than a bare union so a test can enumerate them and fail
 * when one becomes unreachable, which is what a collapse to a boolean looks like from
 * outside.
 */
export const PRINTS_FLAG_STATES = ['flag_present', 'present_without_flag', 'not_in_export'] as const
export type PrintsFlagState = (typeof PRINTS_FLAG_STATES)[number]

/**
 * The publisher document that would decode this column, when one is known to exist.
 *
 * ⛔ NULL, AND NULL IS THE MEASUREMENT. This held `'Codes on NSN-Now.docx'` and shipped that
 * name on the index and inside the operator-facing qualifier below. That file is the owner's
 * own AMC/AMSC notes and never mentions this column (see the header for the docProps and word
 * counts). No publisher code list for `Prints` has been established to exist.
 *
 * It is `null` rather than an empty string on purpose: an empty string renders as a document
 * with no name, and a caller that concatenates it produces a sentence naming nothing. `null` is
 * the one value a renderer cannot accidentally print, which is the same reason the flag itself
 * is a tri-state rather than a boolean.
 */
export const PRINTS_DECODER_DOCUMENT: string | null = null

/**
 * The decoder status, carried on the index so a surface cannot render the flag without
 * having had the chance to read that it is undecoded.
 *
 * `'absent'` is still correct and is unchanged: we hold no decoder. What changed is why. It no
 * longer means "a known document exists and has not reached us"; it means we hold no code list
 * and have not established that the publisher issues one. If a real decoder is ever obtained,
 * this becomes a versioned reference to it and the statements below change with it, in one place.
 */
export const PRINTS_DECODER_STATUS = 'absent' as const

/**
 * The qualifier that must travel with every rendering of this signal.
 *
 * ⛔ IT USED TO NAME A FILE, AND THIS IS A STRING AN OPERATOR READS, NOT A COMMENT. It said the
 * meaning was "not yet confirmed against the code list the publisher maintains, which is
 * documented in Codes on NSN-Now.docx and which we do not hold." That asserted three things we
 * could not support: that the publisher maintains a code list, that it is written down, and
 * that the writing down is that file. The sentence now claims only what was measured.
 */
export const PRINTS_MEANING_UNCONFIRMED =
  'The meaning of this flag is not confirmed. We hold no code list for this column, and we ' +
  'have not established that the publisher issues one.'

/**
 * The exact sentence a person reads for each state.
 *
 * These live here, beside the states they describe, for one reason: a renderer that has to
 * invent its own wording is a renderer that will eventually write "drawing available". The
 * honest sentence ships with the datum.
 */
export const PRINTS_STATE_STATEMENTS: Record<PrintsFlagState, string> = {
  flag_present:
    'NSN-Now marks this stock number with a Prints flag. ' +
    PRINTS_MEANING_UNCONFIRMED +
    ' This is not a statement that an engineering drawing is obtainable.',
  present_without_flag:
    'This stock number appears in the NSN-Now approved-source export with no Prints flag ' +
    'recorded on any of its rows. An empty cell is not a statement that no drawing exists. ' +
    PRINTS_MEANING_UNCONFIRMED,
  not_in_export:
    'The NSN-Now approved-source export we hold does not carry this stock number, so its ' +
    'Prints flag cannot be read either way. ' +
    PRINTS_MEANING_UNCONFIRMED,
}

/** What a caller gets when the thing it handed us is not a stock number at all. */
export const PRINTS_UNPARSEABLE_STATEMENT =
  'This is not a readable stock number, so no Prints flag was looked up for it.'

/* ------------------------------------------------------------------------------------ */
/* TYPES                                                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * One stock number's answer.
 *
 * DELIBERATELY CARRIES NO SCORE, WEIGHT, RANK OR POINTS FIELD. See the header. A control in
 * `test/signals/prints.test.ts` fails if one appears.
 */
export type PrintsRecord = {
  /** The repo's canonical key, 9 digits, via `parseNsn`. */
  niin: Niin
  state: PrintsFlagState
  /** Distinct approved-source rows carrying this stock number. 0 when `not_in_export`. */
  rowsInExport: number
  /** Of those, how many carried a non-empty Prints cell. */
  rowsWithFlag: number
  /** The literal cell values seen, deduped and sorted. Only `X` has ever been observed. */
  flagValues: string[]
  /** Which workbooks carried a row for this stock number, so the claim is traceable. */
  sourcePaths: string[]
  /** The sentence to render. Never asserts what the flag means. */
  statement: string
}

/** The result of a lookup. Refuses on a key it cannot read rather than answering anyway. */
export type PrintsLookup =
  | { ok: true; record: PrintsRecord }
  | { ok: false; reason: 'unparseable_stock_number'; raw: string; statement: string }

/** One workbook's contribution, reported so absence is named rather than inferred. */
export type PrintsSourceReport = {
  path: string
  sha256: string
  fileModifiedAt: string
  /** False when the workbook carried no sheet named MCRL. Named, never silently skipped. */
  hasMcrlSheet: boolean
  mcrlRowsRead: number
  rowsWithFlag: number
  /** Rows whose stock-number cell did not parse. Counted, never dropped in silence. */
  rowsUnkeyable: number
}

export type PrintsCoverage = {
  workbooksScanned: number
  workbooksWithMcrlSheet: number
  /** Named, so "we read 13 files and 8 had no MCRL sheet" is a statement and not a gap. */
  workbooksWithoutMcrlSheet: string[]
  duplicateWorkbooksDropped: Array<{ kept: string; dropped: string }>
  mcrlRowsRead: number
  mcrlRowsAfterDedup: number
  duplicateRowsDropped: number
  rowsUnkeyable: number
  rowsWithFlag: number
  stockNumbers: number
  stockNumbersFlagged: number
  stockNumbersWithoutFlag: number
  /**
   * Stock numbers carrying BOTH a flagged and an unflagged row. Measured 0 over the corpus
   * on disk, which is what makes the per-stock-number rollup unambiguous today. It is
   * counted rather than assumed because a future export need not behave the same way, and a
   * rollup that silently starts averaging over a disagreement is how a signal goes wrong
   * without anything turning red.
   */
  stockNumbersWithMixedRows: number
  flagValuesObserved: string[]
  /** null, never 0, when there is nothing to divide by. A zero here would read as measured. */
  flaggedRowFraction: number | null
  flaggedStockNumberFraction: number | null
}

export type PrintsIndex = {
  ok: true
  /** 'absent' until the publisher's code list is in hand. Read this before rendering. */
  decoderStatus: typeof PRINTS_DECODER_STATUS
  /** Null until a publisher document is known to exist. Never a placeholder name. */
  decoderDocument: string | null
  meaningQualifier: string
  byNiin: Map<Niin, PrintsRecord>
  sources: PrintsSourceReport[]
  provenance: SeedProvenance[]
  coverage: PrintsCoverage
}

export type PrintsUnavailable = {
  ok: false
  /** A sentence a person reads. Never an empty index pretending to be an answer. */
  reason: string
  dataRoot: string
  dataRootBasis: string
}

/** What `printsAnswerability` reports about a caller's own list of stock numbers. */
export type PrintsAnswerability = {
  considered: number
  /** In the export, in either direction. The honest denominator for "can we say anything". */
  answerable: number
  notInExport: number
  flagged: number
  presentWithoutFlag: number
  /** Inputs that were not readable stock numbers. Never folded into `notInExport`. */
  unparseable: number
  /** null, never 0, when nothing was considered. */
  answerableFraction: number | null
  statement: string
}

/** The parsed input the pure builder consumes. Keeps the builder free of any file access. */
export type PrintsSourceInput = {
  path: string
  provenance: SeedProvenance
  /** null when the workbook carried no MCRL sheet, which is a fact and not an empty list. */
  rows: Array<Record<string, string | null>> | null
}

/* ------------------------------------------------------------------------------------ */
/* THE BUILDER. PURE, SO THE SUITE CAN SETTLE IT WITH INPUTS WHOSE ANSWER IS KNOWN.       */
/* ------------------------------------------------------------------------------------ */

const cell = (v: string | null | undefined): string => (v ?? '').trim()

/** A fraction, or null when the denominator is zero. Never 0, which would read as measured. */
function fraction(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 10_000) / 10_000
}

/**
 * Build the index from already-parsed MCRL rows.
 *
 * ROW DEDUP KEY INCLUDES THE FLAG VALUE, deliberately. The exports overlap, so the same
 * approved-source row appears in more than one workbook and counting it twice would inflate
 * `rowsInExport`. But deduping on identity ALONE (stock number + cage + part number) would
 * collapse two rows that disagree about the flag and pick whichever was read first, which is
 * a silent loss of exactly the fact this module exists to carry. Including the flag value in
 * the key means an identical row is counted once and a DISAGREEING row survives to be seen,
 * where it shows up as a mixed stock number in the coverage block.
 */
export function buildPrintsIndex(sources: PrintsSourceInput[]): PrintsIndex {
  const byNiin = new Map<Niin, PrintsRecord>()
  const reports: PrintsSourceReport[] = []
  const provenance: SeedProvenance[] = []
  const seenRow = new Set<string>()
  const flagValuesObserved = new Set<string>()

  let mcrlRowsRead = 0
  let mcrlRowsAfterDedup = 0
  let rowsUnkeyable = 0
  let rowsWithFlag = 0

  for (const source of sources) {
    provenance.push(source.provenance)

    if (source.rows === null) {
      reports.push({
        path: source.path,
        sha256: source.provenance.sha256,
        fileModifiedAt: source.provenance.fileModifiedAt,
        hasMcrlSheet: false,
        mcrlRowsRead: 0,
        rowsWithFlag: 0,
        rowsUnkeyable: 0,
      })
      continue
    }

    let sheetRows = 0
    let sheetFlagged = 0
    let sheetUnkeyable = 0

    for (const row of source.rows) {
      sheetRows += 1
      mcrlRowsRead += 1

      // THE FLAG IS COUNTED BEFORE THE KEY IS PARSED, deliberately. `rowsWithFlag` is a census
      // of the COLUMN over the rows actually read, so its denominator is `mcrlRowsRead` and the
      // two are directly comparable. Counting it after the parse guard would have produced a
      // numerator over keyable rows sitting on top of a denominator over all rows, which is a
      // ratio of two different populations and reads as a measurement.
      const flag = cell(row[PRINTS_COLUMN_HEADER])
      if (flag !== '') {
        sheetFlagged += 1
        rowsWithFlag += 1
        flagValuesObserved.add(flag)
      }

      const parsed = parseNsn(row[NSN_COLUMN_HEADER])
      if (!parsed) {
        sheetUnkeyable += 1
        rowsUnkeyable += 1
        continue
      }

      const identity = `${parsed.niin}|${cell(row['Cage'])}|${cell(row['Part Number'])}|${flag}`
      if (seenRow.has(identity)) continue
      seenRow.add(identity)
      mcrlRowsAfterDedup += 1

      const existing = byNiin.get(parsed.niin)
      if (existing) {
        existing.rowsInExport += 1
        if (flag !== '') {
          existing.rowsWithFlag += 1
          if (!existing.flagValues.includes(flag)) existing.flagValues.push(flag)
        }
        if (!existing.sourcePaths.includes(source.path)) existing.sourcePaths.push(source.path)
        continue
      }

      byNiin.set(parsed.niin, {
        niin: parsed.niin,
        // Provisional. Every record's state is settled in the finalisation pass below, once
        // all rows are in, so a stock number is never judged on a partial view of its rows.
        state: 'present_without_flag',
        rowsInExport: 1,
        rowsWithFlag: flag !== '' ? 1 : 0,
        flagValues: flag !== '' ? [flag] : [],
        sourcePaths: [source.path],
        statement: '',
      })
    }

    reports.push({
      path: source.path,
      sha256: source.provenance.sha256,
      fileModifiedAt: source.provenance.fileModifiedAt,
      hasMcrlSheet: true,
      mcrlRowsRead: sheetRows,
      rowsWithFlag: sheetFlagged,
      rowsUnkeyable: sheetUnkeyable,
    })
  }

  let stockNumbersFlagged = 0
  let stockNumbersWithoutFlag = 0
  let stockNumbersWithMixedRows = 0

  for (const record of byNiin.values()) {
    record.flagValues.sort()
    record.sourcePaths.sort()
    // A stock number counts as flagged when ANY of its rows carries the flag, because the
    // claim being made is about the EXPORT ("NSN-Now marks this stock number"), not about
    // the part. Where rows disagree that is recorded as mixed and the counts stay visible on
    // the record, so a reader can see the rollup was not unanimous.
    if (record.rowsWithFlag > 0) {
      record.state = 'flag_present'
      stockNumbersFlagged += 1
      if (record.rowsWithFlag < record.rowsInExport) stockNumbersWithMixedRows += 1
    } else {
      record.state = 'present_without_flag'
      stockNumbersWithoutFlag += 1
    }
    record.statement = PRINTS_STATE_STATEMENTS[record.state]
  }

  const withMcrl = reports.filter((r) => r.hasMcrlSheet)

  return {
    ok: true,
    decoderStatus: PRINTS_DECODER_STATUS,
    decoderDocument: PRINTS_DECODER_DOCUMENT,
    meaningQualifier: PRINTS_MEANING_UNCONFIRMED,
    byNiin,
    sources: reports,
    provenance,
    coverage: {
      workbooksScanned: reports.length,
      workbooksWithMcrlSheet: withMcrl.length,
      workbooksWithoutMcrlSheet: reports.filter((r) => !r.hasMcrlSheet).map((r) => r.path),
      duplicateWorkbooksDropped: [],
      mcrlRowsRead,
      mcrlRowsAfterDedup,
      duplicateRowsDropped: mcrlRowsRead - rowsUnkeyable - mcrlRowsAfterDedup,
      rowsUnkeyable,
      rowsWithFlag,
      stockNumbers: byNiin.size,
      stockNumbersFlagged,
      stockNumbersWithoutFlag,
      stockNumbersWithMixedRows,
      flagValuesObserved: [...flagValuesObserved].sort(),
      flaggedRowFraction: fraction(rowsWithFlag, mcrlRowsRead),
      flaggedStockNumberFraction: fraction(stockNumbersFlagged, byNiin.size),
    },
  }
}

/* ------------------------------------------------------------------------------------ */
/* LOOKUP                                                                                 */
/* ------------------------------------------------------------------------------------ */

/**
 * Look one stock number up.
 *
 * Takes the OK variant of the index only, so a caller holding a possibly-unavailable index
 * cannot reach this without handling the unavailable case first. That is deliberate: if the
 * export could not be read, every honest answer is "we do not know", and `not_in_export`
 * would be a claim about the catalogue that no file supported.
 */
export function printsFor(index: PrintsIndex, stockNumber: string | null | undefined): PrintsLookup {
  const parsed = parseNsn(stockNumber)
  if (!parsed) {
    return {
      ok: false,
      reason: 'unparseable_stock_number',
      raw: stockNumber == null ? '' : String(stockNumber),
      statement: PRINTS_UNPARSEABLE_STATEMENT,
    }
  }
  const hit = index.byNiin.get(parsed.niin)
  if (hit) return { ok: true, record: hit }
  return {
    ok: true,
    record: {
      niin: parsed.niin,
      state: 'not_in_export',
      rowsInExport: 0,
      rowsWithFlag: 0,
      flagValues: [],
      sourcePaths: [],
      statement: PRINTS_STATE_STATEMENTS.not_in_export,
    },
  }
}

/**
 * How much of a caller's own list this index can answer at all.
 *
 * Exists because an abstention that cannot say why gets ignored within a week. A surface
 * showing "no Prints flag" on most of its rows has to be able to state, in the same breath,
 * how many of those rows the export even covers. The caller passes its own stock numbers
 * (the live corner map's rows, a portfolio, a search result) rather than this module
 * importing a map it has no business knowing about.
 */
export function printsAnswerability(
  index: PrintsIndex,
  stockNumbers: Iterable<string | null | undefined>,
): PrintsAnswerability {
  let considered = 0
  let flagged = 0
  let presentWithoutFlag = 0
  let notInExport = 0
  let unparseable = 0

  for (const value of stockNumbers) {
    considered += 1
    const lookup = printsFor(index, value)
    if (!lookup.ok) {
      unparseable += 1
      continue
    }
    if (lookup.record.state === 'flag_present') flagged += 1
    else if (lookup.record.state === 'present_without_flag') presentWithoutFlag += 1
    else notInExport += 1
  }

  const answerable = flagged + presentWithoutFlag
  const answerableFraction = fraction(answerable, considered)
  const pct = answerableFraction == null ? null : Math.round(answerableFraction * 1000) / 10

  const statement =
    considered === 0
      ? 'No stock numbers were checked against the NSN-Now Prints flag.'
      : `The NSN-Now approved-source export covers ${answerable} of ${considered} stock numbers ` +
        `checked (${pct}%). Of those, ${flagged} carry a Prints flag and ${presentWithoutFlag} ` +
        `carry none. ${notInExport} are not in the export, so no Prints reading exists for them ` +
        `in either direction` +
        (unparseable > 0 ? `, and ${unparseable} were not readable stock numbers.` : '.') +
        ` ${PRINTS_MEANING_UNCONFIRMED}`

  return {
    considered,
    answerable,
    notInExport,
    flagged,
    presentWithoutFlag,
    unparseable,
    answerableFraction,
    statement,
  }
}

/* ------------------------------------------------------------------------------------ */
/* THE LOADER                                                                             */
/* ------------------------------------------------------------------------------------ */

/**
 * Every .xlsx one level under the data root, deduped by CONTENT.
 *
 * DISCOVERED, NOT LISTED. A hardcoded set of filenames is a defect with a delay on it: the
 * operator drops `full_4.xlsx` next to the others and a named list keeps reporting yesterday's
 * coverage while looking perfectly healthy. So the loop finds its own members.
 *
 * One level deep on purpose. `data/nsn-now` also holds `ex_0/`, `exm_0/` and `_extracted/`,
 * which are the ORIGINAL BatchExport files that were later renamed to `full_*`/`more_*`, and
 * they are byte-identical duplicates (verified by hash). Recursing would read the same rows a
 * second time. `distinctWorkbookPaths` runs anyway, as the belt to that braces, because the
 * deployed directory really did once hold one export twice under two names and inflated a
 * provenance disclosure by a whole workbook.
 */
function discoverWorkbooks(root: string): { files: string[]; dropped: Array<{ kept: string; dropped: string }> } {
  const found: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(root, entry.name)
    for (const name of readdirSync(dir)) {
      if (name.startsWith('~') || name.startsWith('.')) continue
      if (!name.toLowerCase().endsWith('.xlsx')) continue
      found.push(path.join(dir, name))
    }
  }
  found.sort()

  /*
   * ★ THIS CALL WAS DESCRIBED ABOVE AND NEVER MADE. The comment said "deduped by CONTENT" and
   * that `distinctWorkbookPaths` "runs anyway, as the belt to that braces", while the function
   * returned `dropped: []` unconditionally and read every copy. A byte-identical workbook was
   * therefore read twice and every row it carried counted twice: the fixture with three MCRL
   * rows reported five, and `duplicateWorkbooksDropped` — the field whose whole job is to
   * DISCLOSE the pairing — came back empty, so nothing on any surface could reveal it.
   *
   * The one-level-deep scan is the primary defence against the `ex_0/` originals. This is the
   * defence against a duplicate sitting at the SAME level under two names, which the deployed
   * directory really did hold and which inflated a provenance disclosure by a whole workbook.
   */
  const { files, droppedDuplicates } = distinctWorkbookPaths(found)
  return { files, dropped: droppedDuplicates }
}

/**
 * Memoized per RESOLVED DATA ROOT, and only ever on success.
 *
 * An unavailable result is deliberately NOT cached. `resolveDataRoot` is itself uncached
 * because a mounted volume can appear after boot, and a cached absence would outlive the
 * mount and keep answering "no export" at a path that now holds one. A cached failure is a
 * stale refusal, which is the one direction of wrongness this module is allowed, but there is
 * no reason to accept it when re-checking costs a `readdirSync`.
 */
const cache = new Map<string, PrintsIndex>()

/**
 * Read every MCRL sheet on disk and index the Prints flag.
 *
 * The exports are static files; re-reading ~19MB of xlsx per request would buy nothing.
 * `resetPrintsIndexCache` is the seam for tests and for a fresh export landing. `env` is a
 * parameter rather than a global read so a test can point at a fixture directory without
 * mutating `process.env` underneath every other test sharing the worker.
 */
export function readPrintsIndex(env: NodeJS.ProcessEnv = process.env): PrintsIndex | PrintsUnavailable {
  const resolution = resolveDataRoot(env)
  const hit = cache.get(resolution.root)
  if (hit) return hit

  if (!resolution.present) {
    return {
      ok: false,
      reason:
        `The data directory is not present at ${resolution.root}, so the NSN-Now ` +
        'approved-source export could not be read and no Prints flag can be reported for any ' +
        'stock number.',
      dataRoot: resolution.root,
      dataRootBasis: resolution.basis,
    }
  }

  const { files, dropped } = discoverWorkbooks(resolution.root)
  if (files.length === 0) {
    return {
      ok: false,
      reason:
        `The data directory at ${resolution.root} holds no .xlsx export, so no Prints flag ` +
        'can be reported for any stock number.',
      dataRoot: resolution.root,
      dataRootBasis: resolution.basis,
    }
  }

  const sources: PrintsSourceInput[] = []
  for (const file of files) {
    const workbook = readWorkbookSheets(file)
    const sheet = workbook.sheets.get(MCRL_SHEET_NAME)
    sources.push({
      path: path.relative(resolution.root, file),
      provenance: workbook.provenance,
      rows: sheet ? sheet.rows : null,
    })
  }

  const index = buildPrintsIndex(sources)
  index.coverage.duplicateWorkbooksDropped = dropped.map((d) => ({
    kept: path.relative(resolution.root, d.kept),
    dropped: path.relative(resolution.root, d.dropped),
  }))

  if (index.coverage.workbooksWithMcrlSheet === 0) {
    // Every workbook read and not one carried the sheet. That is not an empty index, it is a
    // failed read, and it must not be served as "no stock number is flagged".
    return {
      ok: false,
      reason:
        `Read ${files.length} workbooks under ${resolution.root} and none carried a sheet named ` +
        `${MCRL_SHEET_NAME}, so no Prints flag can be reported for any stock number.`,
      dataRoot: resolution.root,
      dataRootBasis: resolution.basis,
    }
  }

  cache.set(resolution.root, index)
  return index
}

/** Test seam: drop the memoized index so a fresh export on disk is picked up. */
export function resetPrintsIndexCache(): void {
  cache.clear()
}

/** Present so a caller can check the directory without paying for a parse. */
export function printsSourceDirectoryExists(): boolean {
  const resolution = resolveDataRoot()
  return existsSync(resolution.root)
}
