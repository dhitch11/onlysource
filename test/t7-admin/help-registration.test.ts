import { describe, expect, it } from 'vitest'
import { getHelp, validateHelp } from '@/components/help/registry'
import { T7_ENTRIES } from '@/lib/admin/help'

/**
 * THE GATE THAT WOULD HAVE CAUGHT MY OWN DEFECT.
 *
 * I wrote `lib/admin/help.ts`, committed it, and it was pushed to the remote before I noticed
 * it was never registered. It typechecked. It was imported by nothing. Every entry existed and
 * was reachable by no one: built and wired but never fed, which is this estate's dominant
 * failure mode and which a type checker cannot see.
 *
 * So the assertion below is deliberately made through `getHelp()`, the REGISTRY lookup, not
 * against the `T7_ENTRIES` array. Asserting against the array would pass whether or not the
 * registration line exists, which is precisely the useless instrument that let the defect
 * through. Reaching for the entry the way a component reaches for it is the only version of
 * this test worth having.
 */

describe('T7 help entries are actually registered, not merely written', () => {
  it('resolves every T7 entry through the registry lookup', () => {
    expect(T7_ENTRIES.length).toBeGreaterThan(0)
    for (const entry of T7_ENTRIES) {
      // getHelp() is what <ExplainButton helpId="..."> calls. If the register() line is
      // removed, this goes red; asserting on T7_ENTRIES directly would not.
      const found = getHelp(entry.id)
      expect(found, `helpId "${entry.id}" does not resolve through the registry`).toBeDefined()
      expect(found?.owner).toBe('T7 ADMIN + API')
    }
  })

  it('passes T8 validation, including the em dash ban and the 140-character cap', () => {
    for (const entry of T7_ENTRIES) {
      const problems = validateHelp(entry)
      expect(problems, `${entry.id}: ${problems.join('; ')}`).toEqual([])
    }
  })

  it('covers the controls on this lane surface that a non-technical expert must not guess at', () => {
    // Named ids rather than a count, so adding an unrelated entry cannot satisfy this.
    for (const id of ['admin.role', 'admin.plane', 'admin.connection_state', 'admin.seeded_identity']) {
      expect(getHelp(id), `missing help for ${id}`).toBeDefined()
    }
  })
})
