import { describe, expect, it } from 'vitest'
import {
  composeArtifactFile,
  composePacketFile,
  type DocumentFileInput,
  type FeedProvenance,
} from '@/lib/compliance/deliverables/document-file'
import {
  EMPTY_FACTS,
  buildDocumentsView,
  type CapturedFacts,
  type DocumentsView,
} from '@/lib/compliance/deliverables/view-model'
import {
  applyPrefill,
  buildPrefill,
  reconcileCarried,
  unconfirmedCarryBlockers,
  type PrefillEvidence,
} from '@/lib/compliance/deliverables/prefill'

/**
 * THE FILE SUITE.
 *
 * ONE RULE UNDER EVERY TEST: a downloaded artifact that has shed its caveats is worse than no
 * download, because it gets forwarded. So the central test does not spot-check a sentence; it
 * ENUMERATES every abstention the view model produced and asserts each one is in the bytes.
 */

const AS_OF = '2026-08-18T12:00:00.000Z'

const FEED: FeedProvenance = {
  known: true,
  feed_day: '2026-08-14',
  archive_key: 'dibbs/2026-08-14/bq260814.zip',
  archive_sha256: 'a'.repeat(64),
}

const EVIDENCE: PrefillEvidence = {
  kind: 'corner',
  requested: '1650-01-059-8221',
  feed_day: '2026-08-14',
  deal: null,
  corner: {
    nsn: '1650-01-059-8221',
    nomenclature: 'MANIFOLD, HYDRAULIC',
    quantity: 42,
    unit_of_issue: 'EA',
    solicitation: 'SPE4A726T1234',
    approved_sources: ['99207'],
    sole_source: true,
  },
  latest_award: { unit_price: 3841.27, award_date_iso: '2025-11-04', company: 'MOOG INC', cage: '99207' },
  part_numbers: ['A-7743-1'],
}

function inputFor(facts: CapturedFacts, feed: FeedProvenance = FEED): DocumentFileInput {
  const prefill = buildPrefill(EVIDENCE)
  const carried = reconcileCarried(prefill, facts)
  const view = buildDocumentsView(facts, AS_OF, unconfirmedCarryBlockers(carried, false))
  return {
    generated_at: AS_OF,
    build_commit: 'deadbeef',
    feed,
    view,
    carried,
    reproduction: { kind: 'not_a_reproduction' },
    operator: 'D Hitchman',
  }
}

/** A lot that genuinely produces abstentions of every kind this build can raise. */
const PARTIAL: CapturedFacts = {
  ...EMPTY_FACTS,
  nsn: '1650-01-059-8221',
  solicitation_number: 'SPE4A726T1234',
}

/** A lot complete enough that all four artifacts assemble. */
const COMPLETE: CapturedFacts = {
  ...applyPrefill(EMPTY_FACTS, buildPrefill(EVIDENCE)),
  validity_days: '90',
  supplier: 'OLY AERO',
  material_condition: 'new_unused',
  acquisition_channel: 'oem_direct',
  counter_price: '4100.00',
  countered_price: '3841.27',
}

/** Everything the on-screen version showed as an abstention, as plain strings. */
function abstentionsOf(view: DocumentsView): string[] {
  const out: string[] = []
  for (const b of view.classification?.blocked_facts ?? []) out.push(b.statement, b.next_action)
  for (const f of view.preflight?.findings ?? []) out.push(f.statement, f.failing_field)
  for (const r of view.quarantined_rules) out.push(r.identifier)
  for (const d of view.deliverables) for (const m of d.missing) out.push(m.label)
  for (const a of view.artifacts) if (!a.view.ok) out.push(...a.view.refusals)
  return out
}

describe('the packet file carries its provenance', () => {
  it('names the feed day, the source archive and its digest', () => {
    const f = composePacketFile(inputFor(PARTIAL))
    expect(f.content).toContain('2026-08-14')
    expect(f.content).toContain('dibbs/2026-08-14/bq260814.zip')
    expect(f.content).toContain('a'.repeat(64))
    expect(f.content).toContain('deadbeef')
    expect(f.content).toContain('D Hitchman')
    expect(f.content).toContain(AS_OF)
  })

  it('STATES THE ABSENCE when there is no feed day, rather than leaving the line blank', () => {
    /*
     * An environment with no data directory has no prefill either, because both come from the same
     * resolution on the page. Building the case that way is the point: the FIRST version of this test
     * kept the prefill's own feed day while claiming the feed was unknown, and the failure it produced
     * was the test lying, not the file. A fixture that carries a contradiction the product cannot
     * produce proves nothing about the product.
     */
    const view = buildDocumentsView(PARTIAL, AS_OF)
    const f = composePacketFile({
      generated_at: AS_OF,
      build_commit: null,
      feed: { known: false, why: 'The government data directory is not mounted here.' },
      view,
      carried: [],
      reproduction: { kind: 'not_a_reproduction' },
      operator: null,
    })
    expect(f.content).toContain('NOT READ IN THIS ENVIRONMENT')
    expect(f.content).toContain('The government data directory is not mounted here.')
    expect(f.content).toContain('No figure in this file was carried from the government feed')
    // The unknown never renders as a plausible day, and an unstamped build never invents a commit.
    expect(f.content).not.toContain('2026-08-14')
    expect(f.content).toContain('not stamped in this environment')
    expect(f.content).toContain('not recorded for this session')
  })

  it('says on its face that it is not a submission', () => {
    const f = composePacketFile(inputFor(COMPLETE))
    expect(f.content).toContain('IT IS NOT A SUBMISSION')
    expect(f.content).toContain('Nothing in this product transmits')
  })

  it('carries a fingerprint, and labels it a change detector rather than a signature', () => {
    const f = composePacketFile(inputFor(COMPLETE))
    expect(f.content).toMatch(/Document fingerprint {6}[0-9a-f]{16}/)
    expect(f.content).toContain('not a signature')
  })
})

describe('THE CENTRAL RULE: nothing the screen showed is dropped from the file', () => {
  it('every abstention on a partial lot appears in the packet file, enumerated not sampled', () => {
    const input = inputFor(PARTIAL)
    const f = composePacketFile(input)
    const missed = abstentionsOf(input.view).filter((a) => !f.content.includes(a))
    expect(missed, `these abstentions never reached the file: ${missed.join(' | ')}`).toEqual([])
    expect(abstentionsOf(input.view).length).toBeGreaterThan(4)
  })

  it('every abstention also appears in a SINGLE-artifact download, which is the one most forwarded alone', () => {
    const input = inputFor(COMPLETE)
    const f = composeArtifactFile('quote_packet', input)
    const missed = abstentionsOf(input.view).filter((a) => !f.content.includes(a))
    expect(missed, `these abstentions never reached the single file: ${missed.join(' | ')}`).toEqual([])
  })

  it('every deliverable and its computed state is in the file, including the ones not ready', () => {
    const input = inputFor(PARTIAL)
    const f = composePacketFile(input)
    for (const d of input.view.deliverables) {
      expect(f.content).toContain(d.label.toUpperCase())
      expect(f.content).toContain(d.state_label)
      expect(f.content).toContain(d.statement)
    }
  })

  it('every artifact body and every figure source reaches the file byte for byte', () => {
    const input = inputFor(COMPLETE)
    const f = composePacketFile(input)
    for (const a of input.view.artifacts) {
      if (!a.view.ok) continue
      expect(f.content).toContain(a.view.body.trimEnd())
      for (const p of a.view.provenance) expect(f.content).toContain(p.source)
    }
    expect(input.view.artifacts.length).toBeGreaterThan(0)
  })

  it('a refused artifact is reported as refused rather than silently omitted', () => {
    const input = inputFor(COMPLETE)
    const refused: DocumentsView = {
      ...input.view,
      artifacts: [
        {
          kind: 'purchase_order',
          label: 'Purchase order',
          view: {
            ok: false,
            refusals: ['Template reference {{f5}} (the extended total) has no payload.'],
            explanation: 'Resolve the named failure and it renders.',
          },
        },
      ],
    }
    const f = composePacketFile({ ...input, view: refused })
    expect(f.content).toContain('THIS ARTIFACT REFUSED TO RENDER')
    expect(f.content).toContain('Template reference {{f5}} (the extended total) has no payload.')
  })

  it('a section with nothing in it says so rather than disappearing', () => {
    const noCarry = { ...inputFor(COMPLETE), carried: [] }
    const f = composePacketFile(noCarry)
    expect(f.content).toContain('WHAT WAS CARRIED IN RATHER THAN TYPED')
    expect(f.content).toContain('Nothing was carried in.')
  })
})

describe('the carried figures travel with the file', () => {
  it('names every carried value, its provenance and whether the operator changed it', () => {
    const f = composePacketFile(inputFor(COMPLETE))
    expect(f.content).toContain('Unit price  [measured, unchanged]')
    expect(f.content).toContain('LAST PRICE THE GOVERNMENT PAID')
    expect(f.content).toContain('HAS NOT BEEN CONFIRMED BY A PERSON')
  })

  it('an edited figure is not described in the file as carried', () => {
    const edited = { ...COMPLETE, unit_price: '4444.00' }
    const f = composePacketFile(inputFor(edited))
    expect(f.content).toContain('Unit price  [measured, edited]')
    expect(f.content).not.toContain('HAS NOT BEEN CONFIRMED BY A PERSON')
  })
})

describe('the filenames', () => {
  it('are safe, dated and name the lot', () => {
    expect(composePacketFile(inputFor(COMPLETE)).filename).toBe(
      'onlysource-packet-1650-01-059-8221-20260818.md',
    )
    expect(composeArtifactFile('quote_packet', inputFor(COMPLETE)).filename).toBe(
      'onlysource-quote-packet-1650-01-059-8221-20260818.md',
    )
  })

  it('never produce an empty or path-bearing name when the lot is unidentified', () => {
    const f = composePacketFile(inputFor(EMPTY_FACTS))
    expect(f.filename).toBe('onlysource-packet-unidentified-20260818.md')
    expect(f.filename).not.toContain('/')
    expect(f.filename).not.toContain('..')
  })
})
