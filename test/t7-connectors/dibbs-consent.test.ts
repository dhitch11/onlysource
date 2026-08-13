import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConsentError, extractConsentForm } from '@/lib/connectors/dibbs/consent'

/**
 * The consent-form extractor, tested against THE REAL CAPTURED BANNERS.
 *
 * `test/fixtures/dibbs/*.html` are T2's live captures of feed day 2026-08-11, rescued out of
 * volatile /tmp. They are the actual bytes DLA served, not a hand-written approximation, which
 * matters because every detail that breaks this handshake is a detail somebody would have
 * simplified away when inventing a fixture: the relative action, the agree button, the entity
 * encoding in the goto parameter.
 *
 * THE HEADLINE MEASUREMENT, WHICH CORRECTS THE RESEARCH: the note in the handoff says the
 * viewstate is "split across 24 hidden fields". The real pages carry THREE. Asserted below so
 * the correction is enforced rather than remembered.
 */

const FIXTURES = join(process.cwd(), 'test/fixtures/dibbs')
const IN_BANNER = readFileSync(join(FIXTURES, 'consent-banner-in.html'), 'latin1')
const BQ_BANNER = readFileSync(join(FIXTURES, 'consent-banner-bq.html'), 'latin1')
const IN_URL = 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/in260811.txt'
const BQ_URL = 'https://dibbs2.bsm.dla.mil/Downloads/RFQ/Archive/bq260811.zip'

describe('the real banner: what it actually contains', () => {
  it('carries THREE hidden fields, not the twenty-four the research recorded', () => {
    const form = extractConsentForm(IN_BANNER, IN_URL)
    const hidden = Object.keys(form.fields).filter((k) => k.startsWith('__'))
    expect(hidden.sort()).toEqual(['__EVENTVALIDATION', '__VIEWSTATE', '__VIEWSTATEGENERATOR'])
  })

  it('includes the agree button, without which the postback is silently ignored', () => {
    // ASP.NET fires the server-side click handler off the button being present in the body.
    // Omit it and you get the banner back with HTTP 200 and no error, forever.
    const form = extractConsentForm(IN_BANNER, IN_URL)
    expect(form.fields.butAgree).toBe('OK')
  })

  it('resolves the RELATIVE action against the banner URL', () => {
    // The raw action is ../../../dodwarning.aspx?goto=... Posting that verbatim goes nowhere.
    const form = extractConsentForm(IN_BANNER, IN_URL)
    expect(form.action).toBe(
      'https://dibbs2.bsm.dla.mil/dodwarning.aspx?goto=%2fdownloads%2frfq%2farchive%2fin260811.txt',
    )
  })

  it('carries a non-empty viewstate, so an empty post cannot look like success', () => {
    const form = extractConsentForm(IN_BANNER, IN_URL)
    expect(form.fields.__VIEWSTATE?.length ?? 0).toBeGreaterThan(20)
  })
})

describe('WHY LENGTH IS NOT A SIGNAL, proven from the two real captures', () => {
  it('two banners are byte-identical in LENGTH and different in CONTENT', () => {
    // Both files are exactly 9,152 bytes. Their actions differ because the banner embeds the
    // target path. A length check, or a hash of a "known banner size", passes one and fails
    // the other while both are banners.
    expect(IN_BANNER.length).toBe(BQ_BANNER.length)
    expect(IN_BANNER).not.toBe(BQ_BANNER)
  })

  it('extracts a DIFFERENT action from each, which is the reason they differ', () => {
    expect(extractConsentForm(IN_BANNER, IN_URL).action).toContain('in260811.txt')
    expect(extractConsentForm(BQ_BANNER, BQ_URL).action).toContain('bq260811.zip')
  })
})

describe('the extractor refuses rather than posting a partial form', () => {
  it('REFUSES a page with no POST form', () => {
    // Posting an incomplete viewstate returns the banner with HTTP 200, which is
    // indistinguishable from success to anything checking a status code.
    expect(() => extractConsentForm('<html><body>nothing here</body></html>', IN_URL)).toThrow(
      ConsentError,
    )
  })

  it('REFUSES a form with an action but no fields', () => {
    expect(() =>
      extractConsentForm('<form method="post" action="/x"></form>', IN_URL),
    ).toThrow(ConsentError)
  })

  it('REFUSES a form with no action', () => {
    expect(() =>
      extractConsentForm('<form method="post"><input type="hidden" name="a" value="b"></form>', IN_URL),
    ).toThrow(ConsentError)
  })

  it('reads every hidden field generically, so a fourth one is picked up automatically', () => {
    // Hardcoding the three known names would break silently the day DLA adds a fourth.
    const html =
      '<form method="post" action="/go">' +
      '<input type="hidden" name="__VIEWSTATE" value="a">' +
      '<input type="hidden" name="__NEWFIELD" value="b">' +
      '<input type="submit" name="butAgree" value="OK"></form>'
    const form = extractConsentForm(html, IN_URL)
    expect(form.fields.__NEWFIELD).toBe('b')
  })
})
