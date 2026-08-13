import { describe, expect, it } from 'vitest'
import {
  DIBBS_INDEX_SHAPE,
  checkCountBand,
  classifyFeedResponse,
  type FeedResponseFacts,
} from '@/lib/connectors/dibbs/classify'

/**
 * The consent-banner trap, tested against the shapes @T2 measured.
 *
 * The load-bearing property: **a banner served with HTTP 200 must never classify as data**, and
 * a real feed must still classify as data (the positive control). A classifier that rejected
 * everything would pass every trap test in this file and destroy the ingest.
 */

const row = (n: number): string => {
  // A 140-character fixed-width row carrying a solicitation number, as the real index does.
  const head = `SPE7M2-26-T-${String(1000 + n).slice(0, 4)}`
  return head.padEnd(140, ' ')
}

const realFeed = (rows: number): string =>
  Array.from({ length: rows }, (_, i) => row(i)).join('\n')

const facts = (over: Partial<FeedResponseFacts>): FeedResponseFacts => ({
  status: 200,
  contentType: 'text/plain',
  finalUrl: 'https://dibbs.bsm.dla.mil/Downloads/RFQ/Archive/in260811.txt',
  sample: realFeed(300),
  ...over,
})

describe('the positive control: a real feed classifies as data', () => {
  it('accepts a normal fixed-width feed', () => {
    const v = classifyFeedResponse(facts({}), DIBBS_INDEX_SHAPE)
    expect(v.kind).toBe('data')
    if (v.kind === 'data') expect(v.rows).toBe(300)
  })

  it('tolerates a single ragged final row, because a SAMPLE is a prefix', () => {
    const v = classifyFeedResponse(
      facts({ sample: `${realFeed(50)}\nSPE7M2-26-T-9999 truncated` }),
      DIBBS_INDEX_SHAPE,
    )
    expect(v.kind).toBe('data')
  })
})

describe('the consent banner served with HTTP 200', () => {
  it('REFUSES text/html, whatever the status says', () => {
    const v = classifyFeedResponse(
      facts({ contentType: 'text/html; charset=utf-8', sample: '<html><body>consent</body></html>' }),
      DIBBS_INDEX_SHAPE,
    )
    expect(v.kind).toBe('consent_banner')
  })

  it('REFUSES a banner even when the content type is wrong or missing', () => {
    // A header alone is not trusted: the body is checked for markup too.
    const v = classifyFeedResponse(
      facts({ contentType: null, sample: '<!DOCTYPE html>\n<html>DoD consent</html>' }),
      DIBBS_INDEX_SHAPE,
    )
    expect(v.kind).toBe('consent_banner')
  })

  it('detects the 302 to the consent page from the FINAL URL, not the body', () => {
    // Both hosts 302 every path to /dodwarning.aspx when consent lapses. Without the final URL
    // an expired session is indistinguishable from a page that merely mentions the word.
    const v = classifyFeedResponse(
      facts({ finalUrl: 'https://dibbs.bsm.dla.mil/dodwarning.aspx?goto=%2fDownloads%2fRFQ' }),
      DIBBS_INDEX_SHAPE,
    )
    expect(v.kind).toBe('consent_redirect')
  })
})

describe('LENGTH IS NEVER THE SIGNAL, which is the whole point', () => {
  it('classifies two banners of DIFFERENT sizes identically', () => {
    // Research recorded 9,152 bytes; T2 measured 9,032 live. A length check would pass one.
    const a = '<html>' + 'x'.repeat(9032) + '</html>'
    const b = '<html>' + 'x'.repeat(9152) + '</html>'
    for (const sample of [a, b]) {
      expect(
        classifyFeedResponse(facts({ contentType: 'text/html', sample }), DIBBS_INDEX_SHAPE).kind,
      ).toBe('consent_banner')
    }
  })

  it('classifies real feeds of very different sizes identically', () => {
    // The mirror of the above: size varies enormously across real days and must not matter.
    for (const n of [201, 1960, 9000]) {
      expect(classifyFeedResponse(facts({ sample: realFeed(n) }), DIBBS_INDEX_SHAPE).kind).toBe(
        'data',
      )
    }
  })
})

describe('shape and canary, in that order', () => {
  it('REFUSES rows of the wrong width even when a solicitation number is present', () => {
    // A truncated or re-formatted file. The canary alone would have passed this.
    const ragged = ['SPE7M2-26-T-1000'.padEnd(120, ' '), 'SPE7M2-26-T-1001'.padEnd(120, ' ')].join(
      '\n',
    )
    const v = classifyFeedResponse(facts({ sample: ragged }), DIBBS_INDEX_SHAPE)
    expect(v.kind).toBe('assertion_failed')
  })

  it('REFUSES correctly-shaped rows that carry no solicitation number', () => {
    const wrongData = Array.from({ length: 10 }, () => 'X'.repeat(140)).join('\n')
    const v = classifyFeedResponse(facts({ sample: wrongData }), DIBBS_INDEX_SHAPE)
    expect(v.kind).toBe('assertion_failed')
  })

  it('REFUSES an empty body rather than reporting zero rows', () => {
    // Zero rows and "we got nothing" are different facts, and a zero would read as a quiet day.
    const v = classifyFeedResponse(facts({ sample: '' }), DIBBS_INDEX_SHAPE)
    expect(v.kind).toBe('assertion_failed')
  })

  it('REFUSES a non-200 rather than guessing', () => {
    expect(classifyFeedResponse(facts({ status: 503 }), DIBBS_INDEX_SHAPE).kind).toBe(
      'assertion_failed',
    )
  })
})

describe('the count band catches a day that is not a normal day', () => {
  it('accepts a normal working day (POSITIVE CONTROL)', () => {
    expect(checkCountBand(1960, DIBBS_INDEX_SHAPE).kind).toBe('data')
  })

  it('REFUSES a suspiciously small or large day', () => {
    expect(checkCountBand(12, DIBBS_INDEX_SHAPE).kind).toBe('assertion_failed')
    expect(checkCountBand(500000, DIBBS_INDEX_SHAPE).kind).toBe('assertion_failed')
  })
})
