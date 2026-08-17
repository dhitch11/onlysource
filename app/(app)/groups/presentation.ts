/**
 * WHAT THE SUPPLY GROUPS BOARD IS ALLOWED TO SAY ABOUT EACH CLASS.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THE RULES LIVE IN A PURE MODULE INSTEAD OF INSIDE THE JSX
 * ---------------------------------------------------------------------------------------
 * The statistics ARE the design on this surface. Compare thirty classes against an average
 * and one looks exceptional from chance alone, so the difference between a class that may be
 * presented as a finding and a class that may only be presented as a count is the single
 * most consequential decision the page makes. That decision is testable arithmetic, and it
 * is written here so it can be asserted directly rather than inferred from a screenshot.
 *
 * The three states and what each one is permitted to render:
 *
 *   significant          the rate is a FINDING. The lift is rendered, because the class
 *                        survived correction for the number of classes tested.
 *   indicative           the same real counts, the same real rate, and NO LIFT AT ALL.
 *                        Lift is the number a person acts on, and a caveat printed beside
 *                        it is the part nobody reads. So the multiple is withheld and the
 *                        cell says in words that the rate is not distinguishable from the
 *                        map average.
 *   insufficient_sample  counts only. No percentage, ever. Three candidates in four rows
 *                        reads as 75% and is nothing. This is the DOMINANT state on a
 *                        one-day window, so it carries the same row weight as the others
 *                        with its word visible, never footnote styling.
 *
 * ---------------------------------------------------------------------------------------
 * WHERE THE NUMBER FORMATTING LIVES, AND WHY IT IS NOT HERE
 * ---------------------------------------------------------------------------------------
 * `./format` holds it, imports nothing, and never touches a locale. Every string this module
 * produces crosses the server/client boundary, and `toLocaleString` renders a different
 * thousands separator on a server running one locale than in a reader's browser running
 * another. That is React #418, a hydration mismatch only production can see.
 *
 * NO MEASURED NUMBER IS TYPED INTO ANY SENTENCE HERE. Every figure in every string is
 * interpolated from the rollup at render time, including the row floor and the family alpha,
 * which are imported from the module that owns them rather than restated.
 */
import {
  FAMILY_ALPHA,
  SAMPLE_FLOOR,
  type FscGroupRow,
  type FscRollup,
  type GroupEvidence,
} from '@/lib/intelligence/groups/fsc'
import { alphaText, count, liftText, pct, pText } from './format'

/* --------------------------------------------------------------------- the rate cell */

export type RateCell =
  /** Survived the correction. The rate is a finding and the multiple may be shown. */
  | { kind: 'finding'; rate: string; lift: string; note: string }
  /** A real measured rate that is not distinguishable from the map average. NO LIFT FIELD
   *  EXISTS ON THIS SHAPE, so the multiple cannot be rendered by accident. */
  | { kind: 'measured'; rate: string; note: string }
  /** Below the row floor. No percentage is produced at all, and the word is visible. */
  | { kind: 'untested'; word: string; why: string }

/**
 * The one place that decides what a class's rate cell is permitted to say.
 *
 * The `measured` shape deliberately has no `lift` field. That is the enforcement: a future
 * edit that tries to print the multiple on an indicative row does not compile.
 */
export function rateCell(row: FscGroupRow): RateCell {
  if (row.evidence === 'significant' && row.candidateRate !== null && row.lift !== null) {
    return {
      kind: 'finding',
      rate: pct(row.candidateRate),
      lift: liftText(row.lift),
      note: 'the map average, after correcting for the number of classes tested',
    }
  }
  if (row.evidence === 'indicative' && row.candidateRate !== null) {
    return {
      kind: 'measured',
      rate: pct(row.candidateRate),
      note: 'not distinguishable from the map average',
    }
  }
  return {
    kind: 'untested',
    word: 'not enough rows',
    why: `${count(row.rows)} on this feed day, under the ${count(SAMPLE_FLOOR)} row floor, so no rate was computed`,
  }
}

/* ------------------------------------------------------------------------- the chips */

export type EvidenceChip = {
  /** Maps onto <StatusChip>. verified is olive, active is steel, idle is the quietest. No
   *  amber, no red, no accent: none of those mean what this column means. */
  tone: 'verified' | 'active' | 'idle'
  word: string
  /** Announced in addition to the visible word, so the grade is unambiguous by ear. */
  srLabel: string
}

/** The words are the registry's words. `groups.evidence` tells the operator to act on the
 *  classes marked "tested and holding" and to treat "indicative" as somewhere to look, so
 *  those are the labels the board must actually print. */
export function evidenceChip(evidence: GroupEvidence): EvidenceChip {
  if (evidence === 'significant') {
    return {
      tone: 'verified',
      word: 'Tested and holding',
      srLabel: 'the excess survives correction for the number of classes tested',
    }
  }
  if (evidence === 'indicative') {
    return {
      tone: 'active',
      word: 'Indicative',
      srLabel: 'a real measured rate that is not distinguishable from the map average',
    }
  }
  return {
    tone: 'idle',
    word: 'Not enough rows',
    srLabel: 'below the row floor, so no rate was computed and no test was run',
  }
}

/* ------------------------------------------------------------------- stated absences */

/** A class with no title in the government table renders the ABSENCE, never the bare code
 *  dressed up as a name. The code still renders in the code slot, where it belongs. */
export function className(row: FscGroupRow): { name: string; stated: boolean } {
  if (row.title === null || row.title.length === 0) {
    return { name: 'no title for this class in the government table', stated: true }
  }
  return { name: row.title, stated: false }
}

export function groupName(row: FscGroupRow): { name: string; stated: boolean } {
  if (row.fsgTitle === null || row.fsgTitle.length === 0) {
    return { name: 'no title for this group in the government table', stated: true }
  }
  return { name: row.fsgTitle, stated: false }
}

export type ScopeLine = { field: 'INCLUDES' | 'EXCLUDES'; value: string; stated: boolean }

/**
 * The government's own scope prose, VERBATIM, or the stated absence of it.
 *
 * Not summarised, not sentence-cased, not truncated. These two lines are the definition
 * that decides which requirements land in a class, and they are the government's words, not
 * ours. Where the H2 table carries none, the board says so rather than leaving a blank that
 * reads as "this class excludes nothing".
 */
export function scopeLines(row: FscGroupRow): ScopeLine[] {
  return [
    {
      field: 'INCLUDES',
      value:
        row.inclusions.length > 0
          ? row.inclusions
          : 'The government table carries no includes line for this class.',
      stated: row.inclusions.length === 0,
    },
    {
      field: 'EXCLUDES',
      value:
        row.exclusions.length > 0
          ? row.exclusions
          : 'The government table carries no excludes line for this class.',
      stated: row.exclusions.length === 0,
    },
  ]
}

/**
 * The arithmetic behind a row's grade, in one sentence, computed.
 *
 * A tested row gets its exact binomial p value and the corrected threshold it was judged
 * against. An untested row gets the reason no test was run. Neither is a caveat: it is the
 * evidence, and it is the thing that stops a person buying inventory against a coincidence.
 */
export function testSentence(row: FscGroupRow, rollup: FscRollup): string {
  if (row.pValue === null || row.candidateRate === null) {
    return `${count(row.rows)} rows in this class on this feed day, under the ${count(SAMPLE_FLOOR)} row floor. No rate was computed and no test was run. The counts beside it are plain counts of real rows.`
  }
  return `${count(row.candidates)} candidate corners in ${count(row.rows)} rows, tested against the map average of ${pct(rollup.baseline)} with an exact binomial: p = ${pText(row.pValue)}. With ${count(rollup.tested)} ${rollup.tested === 1 ? 'class' : 'classes'} clearing the row floor, the threshold is ${FAMILY_ALPHA} divided by ${count(rollup.tested)}, so the bar is ${alphaText(rollup.bonferroniAlpha)}.`
}

/* ---------------------------------------------------------------------- the verdict */

export type Verdict = {
  /** How many classes may be presented as findings. Zero is a real answer. */
  significant: number
  headline: string
  body: string
}

/**
 * THE FIRST-CLASS "NOTHING SEPARATES FROM THE BASELINE" STATE.
 *
 * `tested` is the Bonferroni divisor, so as the window grows and more classes clear the row
 * floor the threshold tightens and the significant set CAN GO TO ZERO with no code change
 * at all. That is not a failed load and it is not an empty table: it is the honest answer to
 * the question the page asks, and it has to read like one.
 */
export function verdict(rollup: FscRollup): Verdict {
  const significant = rollup.groups.filter((g) => g.evidence === 'significant').length
  const classes = rollup.totals.classes

  if (rollup.tested === 0) {
    return {
      significant: 0,
      headline: 'No class on this board holds enough rows to be tested.',
      body: `All ${count(classes)} classes on this feed day sit under the ${count(SAMPLE_FLOOR)} row floor, so no rate was computed for any of them and no test was run. Every count below is a plain count of real rows, and they are worth reading. A rate is not.`,
    }
  }

  if (significant === 0) {
    return {
      significant: 0,
      headline: 'Nothing here separates from the baseline at this sample size.',
      body: `${count(rollup.tested)} of the ${count(classes)} classes hold at least ${count(SAMPLE_FLOOR)} rows, which is the floor to be tested at all. Each was measured against the map average of ${pct(rollup.baseline)} with an exact binomial, at a threshold of ${FAMILY_ALPHA} divided by the ${count(rollup.tested)} tested, so the bar is ${alphaText(rollup.bonferroniAlpha)}. None cleared it. That is the answer for this feed day, not a missing result: the counts are real and the grouping is real, and no class in them is far enough from the map average to act on.`,
    }
  }

  return {
    significant,
    headline:
      significant === 1
        ? 'One class separates from the baseline.'
        : `${count(significant)} classes separate from the baseline.`,
    body: `${count(rollup.tested)} of the ${count(classes)} classes hold at least ${count(SAMPLE_FLOOR)} rows and were tested against the map average of ${pct(rollup.baseline)}, at a threshold of ${FAMILY_ALPHA} divided by ${count(rollup.tested)}, so the bar is ${alphaText(rollup.bonferroniAlpha)}. Only a class that clears that bar is presented as a finding below. Every other class shows its counts and nothing more.`,
  }
}

/**
 * The commercial read on a class that cleared the correction.
 *
 * RENDERED ONLY WHERE ITS SUBJECT EXISTS. No class on a one-day window has cleared the bar
 * so far, and a sentence about a finding that is not on the board would be a fabrication
 * wearing the register of analysis. It is computed from the row, so the day a class does
 * clear it, the read appears attached to that class and names it.
 *
 * The judgement itself is the intelligence lane's: a class that survives the correction is a
 * lane to specialise into, a class outside the supply group that dominates the board is a
 * structurally different position from the sole sourcing everything else on the board is,
 * and the sample is small either way, so it is a lead and not a strategy.
 */
export function commercialRead(
  row: FscGroupRow,
  dominant: { fsg: string; title: string | null } | null,
): string[] {
  const name = className(row)
  const subject = name.stated ? `Class ${row.fsc}` : `${row.fsc} ${name.name}`
  const lines = [
    `${subject} survives the correction on this feed day. A class that does is a lane to specialise into rather than a row to work once, because a dealer who owns two or three classes outbuys a generalist in all of them.`,
  ]
  if (dominant && dominant.fsg !== row.fsg) {
    const where = dominant.title ? `${dominant.fsg} ${dominant.title}` : `group ${dominant.fsg}`
    lines.push(
      `It also sits outside ${where}, which holds more of this board's rows than any other group, so it is a structurally different position from the sole sourcing that makes up the bulk of the map.`,
    )
  }
  lines.push(
    `The sample behind it is small. Treat it as a lead worth a week of sourcing calls, not as a strategy worth an inventory budget.`,
  )
  return lines
}

/**
 * The supply group holding more rows than any other on this board. Used only to say where a
 * significant class sits RELATIVE to the bulk of the map, never as a ranking of its own.
 */
export function dominantGroup(rollup: FscRollup): { fsg: string; title: string | null } | null {
  const byGroup = new Map<string, { rows: number; title: string | null }>()
  for (const g of rollup.groups) {
    const bucket = byGroup.get(g.fsg) ?? { rows: 0, title: g.fsgTitle }
    bucket.rows += g.rows
    byGroup.set(g.fsg, bucket)
  }
  let best: { fsg: string; title: string | null; rows: number } | null = null
  for (const [fsg, bucket] of byGroup) {
    if (!best || bucket.rows > best.rows) best = { fsg, title: bucket.title, rows: bucket.rows }
  }
  return best ? { fsg: best.fsg, title: best.title } : null
}

/* ------------------------------------------------------------------- the view model */

/**
 * ONE ROW OF THE BOARD, FULLY DECIDED, AS PLAIN DATA.
 *
 * The board is interactive, so it is a client component, and this module reads the class
 * catalogue off disk through the rollup's owning module. Passing decided strings across the
 * boundary rather than re-running the rules in the browser keeps `node:fs` out of the client
 * bundle AND keeps the rules in one place, which is the more important of the two: a second
 * implementation of "may this class show a lift" is a second answer waiting to disagree.
 */
export type GroupRowView = {
  key: string
  fsc: string
  fsg: string
  className: { name: string; stated: boolean }
  groupName: { name: string; stated: boolean }
  counts: { rows: string; soleSource: string; candidates: string }
  /** The raw candidate count, for the "only classes with a candidate" filter. A filter that
   *  read the formatted string would be a parser, and a parser is a defect with a delay. */
  candidates: number
  rate: RateCell
  chip: EvidenceChip
  scope: ScopeLine[]
  /** The government's scope prose, verbatim, for the class explainer's live source line. */
  scopeProse: string
  test: string
}

export function rowViews(rollup: FscRollup): GroupRowView[] {
  return rollup.groups.map((row) => {
    const scope = scopeLines(row)
    const verbatim = [row.inclusions, row.exclusions].filter((s) => s.length > 0).join(' ')
    return {
      key: row.fsc,
      fsc: row.fsc,
      fsg: row.fsg,
      className: className(row),
      groupName: groupName(row),
      counts: {
        rows: count(row.rows),
        soleSource: count(row.soleSource),
        candidates: count(row.candidates),
      },
      candidates: row.candidates,
      rate: rateCell(row),
      chip: evidenceChip(row.evidence),
      scope,
      scopeProse:
        verbatim.length > 0
          ? verbatim
          : 'The government class table carries no includes or excludes line for this class.',
      test: testSentence(row, rollup),
    }
  })
}

/** One option in the supply-group filter. Counts are real counts of what the filter would
 *  leave on screen, so the control never promises rows it cannot show. */
export type GroupOption = { fsg: string; label: string; classes: number; rows: number }

export function groupOptions(rows: readonly FscGroupRow[]): GroupOption[] {
  const byGroup = new Map<string, { title: string | null; classes: number; rows: number }>()
  for (const row of rows) {
    const bucket = byGroup.get(row.fsg) ?? { title: row.fsgTitle, classes: 0, rows: 0 }
    bucket.classes += 1
    bucket.rows += row.rows
    byGroup.set(row.fsg, bucket)
  }
  return [...byGroup.entries()]
    .map(([fsg, b]) => ({
      fsg,
      label: b.title && b.title.length > 0 ? `${fsg} ${b.title}` : `${fsg} (no title in the government table)`,
      classes: b.classes,
      rows: b.rows,
    }))
    .sort((a, b) => b.rows - a.rows || a.fsg.localeCompare(b.fsg))
}
