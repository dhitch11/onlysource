import { describe, expect, it } from 'vitest'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { resolveDataRoot } from '@/lib/data-root'
import { hasCorpus, CORPUS_NOTE } from '../support/corpus'

/**
 * WHAT IDENTIFIES A NO-QUOTE ROW, ASKED OF THE CORPUS RATHER THAN ASSUMED.
 *
 * /goldmine keyed its rows on `${digits}:${solicitation}` until 2026-08-24, and React answered
 * "Encountered two children with the same key" seven times on a single page load. Measured over
 * the whole dataset: 33 keys shared by 66 rows. Every one of them is a `***REVISED***` amendment
 * sitting beside the original it supersedes, same NSN, same solicitation, same quantity, with the
 * close date moved.
 *
 * React's answer to a duplicate key is that children "may be duplicated and/or omitted". A row
 * omitted from the No-Quote Goldmine is a government buy that drew zero quotes and that nobody
 * sees go, which is the whole point of the page.
 *
 * THE NEGATIVE CONTROL IS THE POINT OF THIS FILE. Asserting "the new key is unique" passes
 * trivially against almost anything, including a key that is just a row counter. So the OLD key
 * is measured beside it and MUST still collide. If the corpus ever changes such that the old key
 * stops colliding, this test says so rather than quietly becoming a tautology.
 */
const dataPresent = resolveDataRoot().present && hasCorpus

describe.skipIf(!dataPresent)(`no-quote row identity ${CORPUS_NOTE}`, () => {
  /* LAZY: `describe.skipIf` still runs this body to collect, so an eager read here is an ENOENT
     at collection on a runner with no corpus and the skip never gets a chance. */
  const rows = dataPresent
    ? buildAllDatasets().noQuote.rows
    : ([] as ReturnType<typeof buildAllDatasets>['noQuote']['rows'])
  const digits = (r: (typeof rows)[number]) => r.nsn.replace(/[^0-9]/g, '')
  const dupes = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1)
    return [...m.values()].filter((n) => n > 1).length
  }

  const OLD = (r: (typeof rows)[number]) => `${digits(r)}:${r.solicitation}`
  const NEW = (r: (typeof rows)[number]) => `${digits(r)}:${r.solicitation}:${r.closeDate ?? ''}`

  it('NEGATIVE CONTROL: the old NSN-plus-solicitation key really does collide', () => {
    expect(dupes(OLD)).toBeGreaterThan(0)
  })

  it('the shipped key is unique across every row in the corpus', () => {
    expect(dupes(NEW)).toBe(0)
  })

  it('no two rows are identical in every field, so no row is truly indistinguishable', () => {
    expect(dupes((r) => JSON.stringify(r))).toBe(0)
  })

  /**
   * The close date is not a field bolted on until a warning stopped. It is the fact that
   * distinguishes an amendment from the line it amends, and this pins that reading: every row
   * the old key collided on is a revision paired with its original.
   */
  it('every collision under the old key is a REVISED amendment beside its original', () => {
    const groups = new Map<string, typeof rows>()
    for (const r of rows) {
      const k = OLD(r)
      groups.set(k, [...(groups.get(k) ?? []), r])
    }
    const colliding = [...groups.values()].filter((g) => g.length > 1)
    expect(colliding.length).toBeGreaterThan(0)
    for (const g of colliding) {
      expect(g.some((r) => r.description.includes('REVISED'))).toBe(true)
      expect(new Set(g.map((r) => r.closeDate)).size).toBe(g.length)
    }
  })
})
