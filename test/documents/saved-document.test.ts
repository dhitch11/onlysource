import { describe, expect, it } from 'vitest'
import {
  SAVED_STAMP_KEYS,
  canonicalDocumentText,
  documentFingerprint,
  fingerprintOf,
  readSavedStamp,
  verifyReproduction,
} from '@/lib/compliance/deliverables/saved-document'
import { EMPTY_FACTS, buildDocumentsView } from '@/lib/compliance/deliverables/view-model'
import { savedKindOf } from '@/app/(app)/documents/PacketVault'

/**
 * THE SAVED-DOCUMENT SUITE.
 *
 * The defect under test: reopening a saved packet used to regenerate against today's world and
 * present the result as the saved document, with nothing on screen saying so. Every test here is
 * about the difference between "this is the saved document" and "this is a fresh generation".
 */

const AS_OF = '2026-08-18T12:00:00.000Z'
const LOT = { ...EMPTY_FACTS, nsn: '1650-01-059-8221', solicitation_number: 'SPE4A726T1234' }

/**
 * A lot complete enough that its quote packet actually reaches READY TO SUBMIT.
 *
 * THE FIRST VERSION OF THE VERDICT TEST BELOW USED `LOT` AND PASSED FOR THE WRONG REASON. That lot is
 * missing four required fields, so `deliverableState` returns on the missing-fields branch before it
 * ever looks at a blocker: adding one changed nothing, and the assertion that the fingerprint covers
 * verdicts could not have failed no matter what the fingerprint hashed. A fixture that cannot reach
 * the state under test proves nothing about the state under test.
 */
const READY = {
  ...EMPTY_FACTS,
  nsn: '1650-01-059-8221',
  cage: '99207',
  part_number: 'A-7743-1',
  qty: '42',
  unit_price: '3841.27',
  validity_days: '90',
  supplier: 'OLY AERO',
  solicitation_number: 'SPE4A726T1234',
  type_character: 'T',
  material_condition: 'new_unused',
  acquisition_channel: 'oem_direct',
}

const CURRENT = {
  fingerprint: documentFingerprint(buildDocumentsView(LOT, AS_OF)),
  feed_day: '2026-08-14',
  archive_sha256: 'a'.repeat(64),
}

function stamp(over: Partial<Record<string, string>> = {}) {
  const base: Record<string, string> = {
    [SAVED_STAMP_KEYS.asOf]: '2026-07-30T09:00:00.000Z',
    [SAVED_STAMP_KEYS.fingerprint]: CURRENT.fingerprint,
    [SAVED_STAMP_KEYS.feedDay]: '2026-08-14',
    [SAVED_STAMP_KEYS.archiveSha]: 'a'.repeat(64),
    ...over,
  }
  return readSavedStamp((k) => base[k] ?? '')
}

describe('the fingerprint', () => {
  it('is deterministic, and a sixteen-character hex digest', () => {
    expect(fingerprintOf('hello')).toBe(fingerprintOf('hello'))
    expect(fingerprintOf('hello')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('changes when one character of the document changes', () => {
    expect(fingerprintOf('hello')).not.toBe(fingerprintOf('hellp'))
  })

  it('covers the VERDICTS, not only the prose', () => {
    /*
     * The case that matters to a person holding a packet: identical artifact bodies, a different
     * compliance state. If the fingerprint only hashed the bodies, a packet that moved from ready to
     * submit to draft would reproduce as "faithful", which is exactly the silent regeneration this
     * whole mechanism exists to stop.
     */
    const clean = buildDocumentsView(READY, AS_OF)
    const blocked = buildDocumentsView(READY, AS_OF, { quote_packet: ['a blocker that was not there'] })
    // Proof the fixture reaches the state under test, before anything is asserted about hashing.
    expect(clean.deliverables.find((d) => d.kind === 'quote_packet')?.state).toBe('ready_to_submit')
    expect(blocked.deliverables.find((d) => d.kind === 'quote_packet')?.state).toBe(
      'draft_awaiting_approval',
    )
    expect(canonicalDocumentText(clean)).not.toBe(canonicalDocumentText(blocked))
    expect(documentFingerprint(clean)).not.toBe(documentFingerprint(blocked))
  })

  it('does NOT change with the render instant, or every reproduction would report as drifted', () => {
    expect(documentFingerprint(buildDocumentsView(LOT, AS_OF))).toBe(
      documentFingerprint(buildDocumentsView(LOT, '2027-01-01T00:00:00.000Z')),
    )
  })
})

describe('reading the stamp', () => {
  it('a query with no fingerprint is not a reproduction at all', () => {
    expect(readSavedStamp(() => '')).toBeNull()
    expect(verifyReproduction(null, CURRENT).kind).toBe('not_a_reproduction')
  })

  it('reads all four fields off the query', () => {
    const s = stamp()
    expect(s?.feed_day).toBe('2026-08-14')
    expect(s?.saved_as_of).toBe('2026-07-30T09:00:00.000Z')
    expect(s?.archive_sha256).toBe('a'.repeat(64))
  })
})

describe('verifying a reproduction', () => {
  it('an exact match reports the document reproduced, and says the inputs are as of the save', () => {
    const v = verifyReproduction(stamp(), CURRENT)
    expect(v.kind).toBe('faithful')
    if (v.kind !== 'faithful') return
    expect(v.detail).toContain('AS OF 2026-07-30T09:00:00.000Z')
    expect(v.detail).toContain('The world may have moved')
  })

  it('A DIFFERENT DOCUMENT IS NEVER CALLED THE SAVED ONE, and both fingerprints are named', () => {
    const v = verifyReproduction(stamp({ [SAVED_STAMP_KEYS.fingerprint]: '0000000000000000' }), CURRENT)
    expect(v.kind).toBe('drifted')
    if (v.kind !== 'drifted') return
    expect(v.headline).toContain('NOT the document that was saved')
    expect(v.differences.join(' ')).toContain('0000000000000000')
    expect(v.differences.join(' ')).toContain(CURRENT.fingerprint)
  })

  it('a moved feed day is reported by name even when the document still matches', () => {
    const v = verifyReproduction(stamp({ [SAVED_STAMP_KEYS.feedDay]: '2026-07-31' }), CURRENT)
    expect(v.kind).toBe('drifted')
    if (v.kind !== 'drifted') return
    expect(v.differences.join(' ')).toContain('2026-07-31')
    expect(v.differences.join(' ')).toContain('2026-08-14')
  })

  it('a changed source archive digest is reported', () => {
    const v = verifyReproduction(stamp({ [SAVED_STAMP_KEYS.archiveSha]: 'b'.repeat(64) }), CURRENT)
    expect(v.kind).toBe('drifted')
  })

  it('FAILS TOWARD REFUSING: an unverifiable stamp drifts, it does not pass', () => {
    // The feed cannot be read here, so the two cannot be compared. That is not a match.
    const v = verifyReproduction(stamp(), { ...CURRENT, feed_day: null })
    expect(v.kind).toBe('drifted')
    if (v.kind !== 'drifted') return
    expect(v.differences.join(' ')).toContain('cannot be read in this environment')

    // A record with no save instant cannot say how old its inputs are, so it does not claim to.
    const noInstant = verifyReproduction(stamp({ [SAVED_STAMP_KEYS.asOf]: '' }), CURRENT)
    expect(noInstant.kind).toBe('drifted')
    if (noInstant.kind !== 'drifted') return
    expect(noInstant.differences.join(' ')).toContain('no save instant')
  })

  it('POSITIVE CONTROL: with the fingerprint comparison removed, a changed document reads as faithful', () => {
    /*
     * The pre-fix behaviour, reproduced by hand. Reopening a saved packet compared nothing at all, so
     * whatever came out was presented as the saved document. This is what that looks like: pass a stamp
     * whose fingerprint matches, over a document that is not the one that was saved, and the verdict is
     * indistinguishable from the real thing. It is here so the difference between the two code paths is
     * a visible, executable fact rather than a claim in a comment.
     */
    const otherDocument = documentFingerprint(
      buildDocumentsView({ ...LOT, unit_price: '99.99' }, AS_OF),
    )
    expect(otherDocument).not.toBe(CURRENT.fingerprint)
    // Comparison ON: drifted. This is the shipped behaviour.
    expect(verifyReproduction(stamp(), { ...CURRENT, fingerprint: otherDocument }).kind).toBe('drifted')
    // Comparison OFF (the stamp forged to agree): faithful. This is what the defect looked like.
    expect(
      verifyReproduction(stamp({ [SAVED_STAMP_KEYS.fingerprint]: otherDocument }), {
        ...CURRENT,
        fingerprint: otherDocument,
      }).kind,
    ).toBe('faithful')
  })
})

describe('the vault row says which kind of save it is', () => {
  it('a fingerprinted packet says so; an inputs-only one says it cannot be verified', () => {
    expect(savedKindOf({ query: 'nsn=1650&_fp=abcdef1234567890', savedAt: Date.parse('2026-08-18T00:00:00Z') })).toBe(
      'saved 2026-08-18, document fingerprinted',
    )
    expect(savedKindOf({ query: 'nsn=1650', savedAt: Date.parse('2026-07-01T00:00:00Z') })).toBe(
      'saved 2026-07-01, inputs only, cannot be verified',
    )
  })

  it('a record with no save instant says so rather than printing an epoch date', () => {
    expect(savedKindOf({ query: 'nsn=1650', savedAt: 0 })).toContain('an unrecorded day')
  })
})
