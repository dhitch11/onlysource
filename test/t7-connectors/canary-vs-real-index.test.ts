import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DIBBS_INDEX_SHAPE } from '@/lib/connectors/dibbs/classify'
import { archivePath } from '@/lib/data-root'

/**
 * THE REGRESSION THAT WOULD HAVE CAUGHT BOTH WRONG CANARIES.
 *
 * Two versions of this pattern shipped wrong and every hand-written test stayed green, because
 * a hand-written row is written by the same person, with the same wrong assumption, as the
 * pattern. @T2 found the first by running it against the archived index. This is that method,
 * made permanent.
 *
 * The archive lives OUTSIDE the repo (it is 56 MB of captured government bytes). When it is
 * absent the test FAILS rather than skipping: a silent skip on the one instrument that has
 * caught two real defects would be worse than no instrument, and "cannot verify" is a result
 * that deserves to be loud.
 */
const INDEX = archivePath('dibbs-rfq-daily', '2026-08-11', '20260812T225616Z', 'in260811.txt')
const BANNER = join(process.cwd(), 'test/fixtures/dibbs/consent-banner-in.html')

describe('the canary, measured against the real archived feed day', () => {
  it('the archive is present, or this instrument cannot report anything', () => {
    expect(existsSync(INDEX), `real index missing at ${INDEX}`).toBe(true)
  })

  it('matches the overwhelming majority of real solicitation numbers', () => {
    const file = readFileSync(INDEX, 'latin1')
    // Harvested STRUCTURE-AGNOSTICALLY (SPE + 10 alphanumerics), deliberately NOT with the
    // pattern under test. Harvesting with the pattern you are testing yields 100% by
    // construction and proves nothing.
    const tokens = [...new Set(file.match(/SPE[0-9A-Z]{10}/g) ?? [])]
    expect(tokens.length).toBeGreaterThan(2000)
    const hits = tokens.filter((t) => DIBBS_INDEX_SHAPE.canary.test(t)).length
    // v1 scored 0 here, v2 scored 859. The floor is set well above both.
    expect(hits / tokens.length).toBeGreaterThan(0.95)
  })

  it('fires on the whole real file', () => {
    expect(DIBBS_INDEX_SHAPE.canary.test(readFileSync(INDEX, 'latin1'))).toBe(true)
  })

  it('does NOT fire on the real captured consent banner (the negative control)', () => {
    expect(DIBBS_INDEX_SHAPE.canary.test(readFileSync(BANNER, 'latin1'))).toBe(false)
  })
})
