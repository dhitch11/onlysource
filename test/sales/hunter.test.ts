import { describe, expect, it, vi } from 'vitest'
import {
  evaluateOutboundGate,
  renderWithheldSummary,
  startOutreach,
  submitQuote,
  type Contact,
  type GateConfig,
  type GateLookups,
  type HunterCounters,
  type HunterState,
  WITHHELD_LABEL,
  type WithheldReason,
} from '@/lib/sales/hunter'

const NOW = 1_760_000_000_000
const ACTIVE: HunterState = { mode: 'active', changedBy: 'DH', changedAt: NOW, reason: null }
const PAUSED: HunterState = { mode: 'paused', changedBy: 'DH', changedAt: NOW, reason: 'drill' }
const CONFIG: GateConfig = { perSupplierCap: 3 }

function contact(over: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    orgId: 'onlysource',
    email: 'sales@example-supplier.test',
    phoneE164: '+15555550142',
    isGovernmentLine: false,
    doNotContact: { flagged: false, reason: null, author: null },
    timezone: 'America/Chicago',
    ...over,
  }
}

function lookups(over: Partial<GateLookups> = {}): GateLookups {
  return {
    consent: () => ({
      ok: true,
      record: {
        contactId: 'c1', basis: 'existing_purchase_order', sourceArtifactId: 'po-9',
        capturedAt: NOW - 1000, revokedAt: null,
      },
    }),
    suppression: () => ({ ok: true, suppressed: false }),
    lineType: () => ({ ok: true, type: 'landline' }),
    contactsInWindow: () => 0,
    withinCallingHours: () => true,
    ...over,
  }
}

describe('the outbound gate refuses on UNCERTAINTY, not only on a known-bad answer', () => {
  const cases: Array<[string, Partial<GateLookups>, Partial<Contact>, WithheldReason]> = [
    ['consent store unreadable', { consent: () => ({ ok: false }) }, {}, 'consent_store_unreadable'],
    ['suppression store unreadable', { suppression: () => ({ ok: false }) }, {}, 'suppression_store_unreadable'],
    ['line type lookup failed', { lineType: () => ({ ok: false }) }, {}, 'line_type_lookup_failed'],
    // Found by T5's audit: a lookup that SUCCEEDS and says 'unknown' is the same fact as one
    // that failed, and it used to dial.
    ['line type unknown', { lineType: () => ({ ok: true, type: 'unknown' }) }, {}, 'line_type_unknown'],
    ['no consent record', { consent: () => ({ ok: true, record: null }) }, {}, 'no_consent_basis'],
    ['suppressed', { suppression: () => ({ ok: true, suppressed: true }) }, {}, 'suppressed'],
    ['outside calling hours', { withinCallingHours: () => false }, {}, 'quiet_hours'],
    ['per-supplier cap reached', { contactsInWindow: () => 3 }, {}, 'per_supplier_cap_reached'],
    ['unknown timezone', {}, { timezone: null }, 'unknown_timezone'],
    ['government line', {}, { isGovernmentLine: true }, 'government_line'],
    ['do not contact', {}, { doNotContact: { flagged: true, reason: 'asked', author: 'DG' } }, 'do_not_contact'],
    ['no phone configured', {}, { phoneE164: null }, 'no_configured_contact'],
  ]

  for (const [name, lk, ct, expected] of cases) {
    it(`refuses a voice touch: ${name}`, () => {
      const d = evaluateOutboundGate(contact(ct), 'voice', ACTIVE, lookups(lk), CONFIG, NOW)
      expect(d.allowed).toBe(false)
      if (!d.allowed) expect(d.reason).toBe(expected)
    })
  }

  it('refuses everything while Hunter Mode is paused', () => {
    const d = evaluateOutboundGate(contact(), 'voice', PAUSED, lookups(), CONFIG, NOW)
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toBe('hunter_paused')
  })

  it('refuses a wireless number whose only basis is a bulk import', () => {
    const d = evaluateOutboundGate(
      contact(), 'voice', ACTIVE,
      lookups({
        lineType: () => ({ ok: true, type: 'wireless' }),
        consent: () => ({
          ok: true,
          record: {
            contactId: 'c1', basis: 'imported_from_operator_records', sourceArtifactId: 'imp-1',
            capturedAt: NOW, revokedAt: null,
          },
        }),
      }),
      CONFIG, NOW,
    )
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toBe('wireless_with_imported_basis_only')
  })

  it('holds VoIP to the same standard as wireless, decided rather than fallen through', () => {
    // A VoIP number can terminate on a mobile handset and the lookup cannot tell us it does
    // not. Deciding it deliberately is the point; leaving it to fall through was the defect.
    const d = evaluateOutboundGate(
      contact(), 'voice', ACTIVE,
      lookups({
        lineType: () => ({ ok: true, type: 'voip' }),
        consent: () => ({
          ok: true,
          record: {
            contactId: 'c1', basis: 'imported_from_operator_records', sourceArtifactId: 'imp-1',
            capturedAt: NOW, revokedAt: null,
          },
        }),
      }),
      CONFIG, NOW,
    )
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toBe('wireless_with_imported_basis_only')
  })

  it('the withheld LABEL states what actually triggered it, not something false', () => {
    // The old name and copy said "no recorded basis" while the trigger required a basis to
    // EXIST. On a TCPA path, "no basis" and "weakest basis" are legally different, and an
    // operator opening that contact would have seen a basis and been told there was none.
    expect(WITHHELD_LABEL.wireless_with_imported_basis_only).toContain('bulk import')
    expect(WITHHELD_LABEL.wireless_with_imported_basis_only).not.toContain('no recorded')
  })

  it('POSITIVE CONTROL: a fully cleared contact IS allowed on both channels', () => {
    const voice = evaluateOutboundGate(contact(), 'voice', ACTIVE, lookups(), CONFIG, NOW)
    expect(voice.allowed).toBe(true)
    const email = evaluateOutboundGate(contact(), 'email', ACTIVE, lookups(), CONFIG, NOW)
    expect(email.allowed).toBe(true)
    // Without this, every refusal test above would pass against a gate that always refuses.
  })

  it('does not require a phone number to send email', () => {
    const d = evaluateOutboundGate(contact({ phoneE164: null }), 'email', ACTIVE, lookups(), CONFIG, NOW)
    expect(d.allowed).toBe(true)
  })
})

describe('Start outreach never invents a recipient', () => {
  it('offers a configure action instead of a contact when none exists', async () => {
    const recordWithheld = vi.fn()
    const createPursuit = vi.fn()
    const r = await startOutreach(
      { dealId: 'd1', contactId: 'c1', templateId: 't1', niin: '011805372', attemptWindowDate: '2026-08-13', orgId: 'onlysource' },
      {
        gate: () => ({ allowed: false, reason: 'no_configured_contact' }),
        createPursuit,
        recordWithheld,
      },
    )
    expect(r.started).toBe(false)
    if (!r.started) expect(r.operatorAction).toBe('Configure a contact for this supplier.')
    expect(createPursuit).not.toHaveBeenCalled()
    // The withheld event is RECORDED, so the guardrail counter is real and not decorative.
    expect(recordWithheld).toHaveBeenCalledWith('no_configured_contact')
  })

  it('derives the idempotency key from business identity, not a minted id', async () => {
    const createPursuit = vi.fn().mockResolvedValue({ pursuitId: 'p9' })
    await startOutreach(
      { dealId: 'd1', contactId: 'c1', templateId: 't1', niin: '011805372', attemptWindowDate: '2026-08-13', orgId: 'onlysource' },
      { gate: () => ({ allowed: true, consentBasis: 'existing_purchase_order', lineType: 'landline' }), createPursuit, recordWithheld: vi.fn() },
    )
    expect(createPursuit.mock.calls[0]?.[0].idempotencyKey)
      .toBe('supplier_outreach:onlysource:c1:011805372:2026-08-13')
  })

  it('produces the SAME key on a retry in the same window, so a retry cannot double-send', async () => {
    const keys: string[] = []
    const createPursuit = vi.fn(async (i: { idempotencyKey: string }) => {
      keys.push(i.idempotencyKey)
      return { pursuitId: 'p9' }
    })
    const args = { dealId: 'd1', contactId: 'c1', templateId: 't1', niin: '011805372', attemptWindowDate: '2026-08-13', orgId: 'onlysource' }
    const deps = { gate: () => ({ allowed: true as const, consentBasis: 'existing_purchase_order' as const, lineType: 'landline' as const }), createPursuit, recordWithheld: vi.fn() }
    await startOutreach(args, deps)
    await startOutreach(args, deps)
    expect(keys[0]).toBe(keys[1])
  })
})

describe('Submit quote is a handoff, never a government write', () => {
  it('REFUSES Hunter Mode before it looks at readiness', () => {
    const r = submitQuote(
      { dealId: 'd1', owner: 'AI', packetReadiness: 'ready', blockers: [] },
      { kind: 'ai' },
    )
    expect(r.outcome).toBe('refused')
    if (r.outcome === 'refused') expect(r.reason).toBe('ai_cannot_file')
  })

  it('hands a person to the confirm screen, and returns no filing result of any kind', () => {
    const r = submitQuote(
      { dealId: 'd1', owner: 'DH', packetReadiness: 'ready', blockers: [] },
      { kind: 'human', operator: 'DH' },
    )
    expect(r.outcome).toBe('human_confirm_required')
    // There is no success shape for "filed" anywhere in this type, by construction.
    expect(Object.keys(r)).not.toContain('filed')
    expect(Object.keys(r)).not.toContain('submitted')
  })

  it('refuses when no packet exists yet', () => {
    const r = submitQuote(
      { dealId: 'd1', owner: 'DH', packetReadiness: 'none', blockers: [] },
      { kind: 'human', operator: 'DH' },
    )
    expect(r.outcome).toBe('refused')
    if (r.outcome === 'refused') expect(r.reason).toBe('no_packet')
  })

  it('carries the blockers through so the operator sees what is missing', () => {
    const r = submitQuote(
      { dealId: 'd1', owner: 'DH', packetReadiness: 'forming', blockers: ['traceability document missing'] },
      { kind: 'human', operator: 'DH' },
    )
    expect(r.outcome).toBe('human_confirm_required')
    if (r.outcome === 'human_confirm_required') {
      expect(r.readiness).toBe('incomplete')
      expect(r.blockers).toEqual(['traceability document missing'])
    }
  })
})

describe('the banner tells the truth on day one, when nothing has happened', () => {
  const EMPTY: HunterCounters = {
    sequencesRunning: 0, repliesToday: 0, connectedCallsToday: 0, bookingsToday: 0,
    withheldToday: [],
  }

  it('has no "sent" counter at all, because a send is not an arrival', () => {
    // The sms.sent false-success class is banned by SHAPE, not by discipline.
    expect(Object.keys(EMPTY)).not.toContain('sent')
    expect(Object.keys(EMPTY)).not.toContain('messagesSent')
    expect(Object.keys(EMPTY)).not.toContain('touchesSent')
  })

  it('renders no withheld line when nothing was withheld', () => {
    expect(renderWithheldSummary([])).toBeNull()
    expect(renderWithheldSummary([{ reason: 'quiet_hours', count: 0 }])).toBeNull()
  })

  it('shows restraint as proudly as connects, biggest reason first', () => {
    const line = renderWithheldSummary([
      { reason: 'suppressed', count: 1 },
      { reason: 'quiet_hours', count: 2 },
    ])
    expect(line).toBe('3 outreach withheld today: 2 quiet hours, 1 suppression list')
  })
})
