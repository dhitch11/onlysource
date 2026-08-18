import { describe, expect, it } from 'vitest'
import { parsePrefillRequest } from '@/app/(app)/documents/prefill-source'

/**
 * THE LINK CONTRACT. `/documents?from=deal:<id>` and `/documents?from=corner:<stock number>`.
 *
 * It is parsed rather than pattern-matched for one reason: an unrecognised prefix must resolve to
 * NOTHING, never fall through to being treated as a stock number. A surface that guessed what an
 * unknown link meant would prefill a federal document from a string it did not understand.
 */
describe('parsePrefillRequest', () => {
  it('reads the two shapes the product links with', () => {
    expect(parsePrefillRequest('deal:abc-123')).toEqual({ kind: 'deal', id: 'abc-123' })
    expect(parsePrefillRequest('corner:1650-01-059-8221')).toEqual({
      kind: 'corner',
      nsn: '1650-01-059-8221',
    })
    expect(parsePrefillRequest('CORNER:1650010598221')).toEqual({ kind: 'corner', nsn: '1650010598221' })
  })

  it('an unknown, empty or malformed prefix resolves to nothing, never to a guess', () => {
    for (const input of ['', '   ', 'nsn:1650010598221', '1650010598221', ':abc', 'deal:', 'deal']) {
      expect(parsePrefillRequest(input), `"${input}" should not resolve`).toEqual({ kind: 'none' })
    }
  })

  it('keeps a value containing a colon intact after the first separator', () => {
    expect(parsePrefillRequest('deal:a:b')).toEqual({ kind: 'deal', id: 'a:b' })
  })
})
