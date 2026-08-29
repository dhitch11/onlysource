import { describe, expect, it } from 'vitest'
import { hasCorpus, CORPUS_NOTE } from '../support/corpus'
import { haystackOf, matchesTerms, termsOf } from '@/components/ui/row-search'
import { SEARCH_FIELDS } from '@/app/(app)/suppliers/SuppliersGrid'
import type { LeanSupplier } from '@/app/(app)/suppliers/wire-lean'

/** The page's own field choice, run through the shared matcher, exactly as the grid does it. */
const haystack = (r: LeanSupplier) => haystackOf(SEARCH_FIELDS(r))
const matches = (r: LeanSupplier, terms: readonly string[]) => matchesTerms(haystack(r), terms)

/*
 * SEARCH ON THE SUPPLIER BOOK.
 *
 * 3,471 rows, three coarse tabs, and until this landed no way to find a company you already knew
 * the name of. The page's own loader copy promised one - "it is a moment, and then it is instant
 * to sort and search" - while no search control existed anywhere on the page.
 */
const row = (over: Partial<LeanSupplier>): LeanSupplier =>
  ({
    cage: '0J6L4',
    company: 'SMYTH COUNTY MACHINE AND WELDING, INC.',
    city: 'Marion',
    state: 'VA',
    prospectTier: 'A - hot',
    prospectScore: 91,
    holdsInventory: 'Manufacturer',
    awardsInWindow: 4,
    lastAwardedAt: null,
    currentlyInBusiness: null,
    industry: null,
    employees: null,
    samStatus: null,
    samExpiration: null,
    cageStatus: null,
    uei: null,
    contactCount: 5,
    hasPhone: true,
    ...over,
  }) as LeanSupplier

/*
 * PURE: every row here is a hand-built fixture, so this runs on a fresh checkout with no corpus.
 * These are the tests that catch a matcher regression, so CI must keep them.
 */
describe('what an operator can search the supplier book by', () => {
  it('finds a company by part of its name, case-insensitively', () => {
    expect(matches(row({}), termsOf('smyth'))).toBe(true)
    expect(matches(row({}), termsOf('WELDING'))).toBe(true)
  })

  it('finds a company by its CAGE code, which is what an award gives you', () => {
    expect(matches(row({}), termsOf('0j6l4'))).toBe(true)
  })

  it('finds a company by city or state', () => {
    expect(matches(row({}), termsOf('marion'))).toBe(true)
    expect(matches(row({}), termsOf('va'))).toBe(true)
  })

  it('narrows on every term rather than widening, in any order', () => {
    expect(matches(row({}), termsOf('smyth marion'))).toBe(true)
    expect(matches(row({}), termsOf('marion smyth'))).toBe(true)
    // the second term is real, and belongs to a different firm
    expect(matches(row({}), termsOf('smyth ohio'))).toBe(false)
  })

  it('never lets one term straddle two fields', () => {
    /*
     * The separator between fields is what stops this. "acme cleve" in the company column next to
     * "land" in the city column must not answer a search for "cleveland": that is a match nobody
     * could explain and it appears in a list the operator is deciding who to call from.
     */
    expect(matches(row({ company: 'ACME CLEVE', city: 'Land' }), termsOf('cleveland'))).toBe(false)
    // and the fields really are all in there, so the negative above is not passing by accident
    const hay = haystack(row({ company: 'ACME CLEVE', city: 'Land' }))
    expect(hay).toContain('acme cleve')
    expect(hay).toContain('land')
  })

  it('matches everything on an empty or whitespace query, so clearing restores the list', () => {
    expect(termsOf('   ')).toEqual([])
    expect(matches(row({}), termsOf(''))).toBe(true)
    expect(matches(row({}), termsOf('   '))).toBe(true)
  })

  it('handles a row whose optional fields are all absent without throwing', () => {
    const bare = row({ company: null, city: null, state: null })
    expect(matches(bare, termsOf('0j6l4'))).toBe(true)
    expect(matches(bare, termsOf('smyth'))).toBe(false)
  })

  it('does NOT search the fields that are filters rather than identifiers', () => {
    /*
     * `prospectTier: "A - hot"` and `holdsInventory: "Manufacturer"`. Folding them in would make a
     * search for "hot" return most of the book and "manufacturer" return every stocking firm,
     * which turns a lookup into a second and worse copy of the tab bar directly above it.
     */
    const anon = row({ company: 'ZZ CORP', city: null, state: null })
    expect(matches(anon, termsOf('hot'))).toBe(false)
    expect(matches(anon, termsOf('manufacturer'))).toBe(false)
  })
})

/*
 * ★ THE CONCIERGE HELD ITS OWN COPY OF THE NUMBER, AND IT WAS THE WRONG ONE.
 *
 * `lib/thomas/knowledge.ts` states the supplier counts as prose literals so the model can answer
 * without a tool call. Fixing the verified-contact predicate corrected the page and left Thomas
 * saying 10,121, which is worse than either being wrong alone: two surfaces of one product
 * disagreeing about the same fact, each sounding certain.
 *
 * So the literals are asserted against the COMPUTED counts. This does not stop the prose being
 * edited; it stops it drifting from the data silently.
 */
describe.skipIf(!hasCorpus)('Thomas states the same supplier counts the page computes' + CORPUS_NOTE, () => {
  it('carries no stale count in its knowledge base', async () => {
    const { buildDistressedSuppliers } = await import('@/lib/intelligence/suppliers/distressed')
    const { PLATFORM_KNOWLEDGE } = await import('@/lib/thomas/knowledge')
    const book = buildDistressedSuppliers()
    if (!book.ok) {
      throw new Error('the distressed supplier file did not load, so nothing here was tested')
    }
    const n = (x: number) => x.toLocaleString('en-US')
    expect(PLATFORM_KNOWLEDGE).toContain(`${n(book.counts.verifiedContacts)} verified contacts`)
    expect(PLATFORM_KNOWLEDGE).toContain(`${n(book.counts.suppliers)} firms`)
    // the number that was wrong, named so a revert is caught by name and not only by arithmetic
    expect(PLATFORM_KNOWLEDGE).not.toContain('10,121')
  })
})
