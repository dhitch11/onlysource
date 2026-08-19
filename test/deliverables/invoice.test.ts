/**
 * THE INVOICE: the last document in the close chain and the only one that asks to be PAID.
 *
 * `app/(app)/layout.tsx` promises "Quotes, purchase orders and the paper trail that closes a
 * deal." Until now there were four DeliverableKinds and none of them was an invoice, so the
 * trail stopped before the money came back and that sentence was a claim the product could not
 * back.
 *
 * The tests that matter here are the refusals. An invoice states what was AGREED, and this
 * product does not know that: the feed knows what the government solicited and the award export
 * knows what it paid the previous incumbent. Neither is what we are owed.
 */
import { describe, expect, it } from 'vitest'

import {
  DELIVERABLE_LABEL,
  REQUIRED_REFS,
  REQUIRES_HUMAN_APPROVAL,
  templateFor,
  type DeliverableKind,
} from '@/lib/compliance/deliverables/artifacts'
import { EMPTY_FACTS, normaliseFacts } from '@/lib/compliance/deliverables/view-model'
import { FIELD_USED_BY, unconfirmedCarryBlockers } from '@/lib/compliance/deliverables/prefill'

describe('the invoice exists as a first-class deliverable', () => {
  it('is a kind, is labelled, and has a template', () => {
    expect(DELIVERABLE_LABEL.invoice).toBe('Invoice')
    const t = templateFor('invoice', 'unknown')
    expect(t).not.toBeNull()
    expect(t!.id).toBe('invoice')
  })

  /** It demands money on the strength of a delivery nothing here observed. */
  it('always waits for a person, like the purchase order and unlike the quote packet', () => {
    expect(REQUIRES_HUMAN_APPROVAL.invoice).toBe(true)
  })

  it('requires the award number, which is the field a real invoice is rejected for', () => {
    const labels = REQUIRED_REFS.invoice.map((r) => r.label).join(' | ')
    expect(labels).toContain('contract or delivery order number')
    expect(REQUIRED_REFS.invoice).toHaveLength(7)
    // Every ref in the template must be a ref the artifact declares, or a payload renders blank
    // with nothing telling the operator which field is missing.
    const declared = new Set(REQUIRED_REFS.invoice.map((r) => r.ref))
    for (const seg of templateFor('invoice', 'unknown')!.segments) {
      if (seg.kind === 'payload') expect(declared.has(seg.ref)).toBe(true)
    }
  })

  /*
   * ★ THE CONTROL THAT MATTERS. The invoice shares `unit_price` and `qty` with the quote packet
   * rather than taking private copies, so the carried-price confirmation gate reaches it. A
   * private copy would have escaped the one control standing between a government award price
   * and a document that asks to be paid.
   */
  it('is held at draft by an unconfirmed carried price, exactly as the quote packet is', () => {
    expect(FIELD_USED_BY.unit_price).toContain('invoice')
    const carried = [
      {
        field: 'unit_price' as const,
        what: 'Unit price',
        provenance: 'measured' as const,
        origin: 'the last price the government paid',
        carried_value: '1188.33',
        current_value: '1188.33',
        status: 'unchanged' as const,
        needs_confirmation: true,
        statement: 'carried, unconfirmed',
      },
    ]
    const blockers = unconfirmedCarryBlockers(carried, false)
    expect(blockers.invoice.length).toBeGreaterThan(0)
    // And a person acting clears it, for the invoice as for everything else.
    expect(unconfirmedCarryBlockers(carried, true).invoice).toHaveLength(0)
  })

  it('carries no figure this product invented: the three new facts start empty', () => {
    expect(EMPTY_FACTS.invoice_number).toBe('')
    expect(EMPTY_FACTS.award_number).toBe('')
    expect(EMPTY_FACTS.payment_terms).toBe('')
    const n = normaliseFacts({ ...EMPTY_FACTS, invoice_number: '  INV-1  ', award_number: ' SPE-9 ' })
    expect(n.invoice_number).toBe('INV-1')
    expect(n.award_number).toBe('SPE-9')
  })

  it('says in its own words that nothing was carried from the feed', () => {
    const text = templateFor('invoice', 'unknown')!
      .segments.filter((s) => s.kind === 'fixed')
      .map((s) => (s as { text: string }).text)
      .join('')
    expect(text).toContain('what the government paid someone else is not what you are owed')
  })

  it('every kind still has a label and a required-ref list, so nothing was half-added', () => {
    const kinds: DeliverableKind[] = ['quote_packet', 'purchase_order', 'traceability_packet', 'counter_offer_memo', 'invoice']
    for (const k of kinds) {
      expect(DELIVERABLE_LABEL[k]).toBeTruthy()
      expect(REQUIRED_REFS[k].length).toBeGreaterThan(0)
      expect(typeof REQUIRES_HUMAN_APPROVAL[k]).toBe('boolean')
    }
  })
})
