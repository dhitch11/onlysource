import { describe, expect, it } from 'vitest'
import { sentences } from '@/components/ui/Note'
import { buildAllDatasets } from '@/lib/intelligence/datasets'

/*
 * ==========================================================================================
 * THE SENTENCE SPLITTER, TESTED AGAINST THE REAL STRINGS IT WILL MEET.
 * ==========================================================================================
 * Measured prose per page, outside the grid: /competitor 1,004 words, /goldmine 623,
 * /monopoly 546 with three paragraphs over 80 words and one at 114, /board one at 154.
 *
 * A 154-word paragraph on a dashboard is not read. It is skipped, and the part that makes the
 * number above it trustworthy goes with it. `<TextNote>` leads with the first sentence and puts
 * the rest behind an obvious control — so the splitter has to be right on the ACTUAL strings,
 * not on invented ones.
 *
 * ★ THE FAILURE MODE IS DELIBERATE. If the split finds no boundary, the whole string becomes the
 * lead and no disclosure renders: the old behaviour. It can under-split, never lose text.
 */
describe('splitting a composed provenance statement', () => {
  it('splits the real coverage statement into readable sentences', () => {
    const { cornerMap } = buildAllDatasets()
    const statement = cornerMap.coverage.statement
    expect(statement.length, 'the corpus must actually carry a statement').toBeGreaterThan(80)

    const parts = sentences(statement)
    expect(parts.length, 'this is the 114-word paragraph; it has to break up').toBeGreaterThan(2)

    // ★ NOTHING MAY BE LOST. Rejoining must reproduce the original, ignoring the whitespace the
    // split consumed. This is the assertion that makes "we only hid it" true.
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(statement.replace(/\s+/g, ' '))

    // the lead has to be a sentence a person can read on its own, not a fragment
    expect(parts[0]!.length).toBeGreaterThan(20)
    expect(parts[0]!.length).toBeLessThan(220)
  })

  it('does not split inside a decimal, a hash or a version', () => {
    /*
     * These are the shapes that actually occur in this product's provenance prose: a window mean
     * of 1,999.4, a sha256 printed whole, and an ISO date. A splitter that cut any of them would
     * put half a hash in a lead and the other half behind a disclosure.
     */
    for (const s of [
      'A window mean of 1,999.4 lines per day is normal for this archive.',
      'The newest capture is bq260817.zip sha256 7f8a6a6ca862 and it is one of 21.',
      'Judged against 2026-08-19, 2 US federal business days after 2026-08-17.',
    ]) {
      expect(sentences(s), s).toEqual([s])
    }
  })

  it('splits on a real boundary', () => {
    expect(sentences('Counted across 21 days. The newest day was normal.')).toEqual([
      'Counted across 21 days.',
      'The newest day was normal.',
    ])
  })

  it('returns the whole string when there is no boundary, so nothing is ever dropped', () => {
    const one = 'One sentence with no boundary in it at all'
    expect(sentences(one)).toEqual([one])
  })

  it('never returns an empty fragment', () => {
    expect(sentences('A.  B.   C.')).not.toContain('')
    expect(sentences('   ')).toEqual([])
  })
})
