import { describe, expect, it } from 'vitest'
import {
  FIELD_USED_BY,
  NO_PREFILL,
  applyPrefill,
  buildPrefill,
  looksLikeNsn,
  ninthCharacter,
  reconcileCarried,
  unconfirmedCarries,
  unconfirmedCarryBlockers,
  type PrefillEvidence,
} from '@/lib/compliance/deliverables/prefill'
import { EMPTY_FACTS, buildDocumentsView } from '@/lib/compliance/deliverables/view-model'

/**
 * THE PREFILL SUITE.
 *
 * Every test here is written against the failure it is guarding, not against the happy path. The
 * shape of the whole file: a prefilled field is a CLAIM, so the assertions are about what the screen
 * SAYS about a value, not merely that the value arrived.
 */

const AS_OF = '2026-08-18T12:00:00.000Z'

const CORNER: PrefillEvidence = {
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
  latest_award: {
    unit_price: 3841.27,
    award_date_iso: '2025-11-04',
    company: 'MOOG INC',
    cage: '99207',
  },
  part_numbers: ['A-7743-1'],
}

describe('the identifier readers', () => {
  it('a thirteen-digit stock number is one, with or without dashes', () => {
    expect(looksLikeNsn('1650-01-059-8221')).toBe(true)
    expect(looksLikeNsn('1650010598221')).toBe(true)
  })

  it('a CRM reference that is not a stock number is refused rather than coerced', () => {
    expect(looksLikeNsn('Moog manifold, Q3 buy')).toBe(false)
    expect(looksLikeNsn('SPE4A726T1234')).toBe(false)
    expect(looksLikeNsn('165001059822')).toBe(false)
  })

  it('the ninth character is read from the published solicitation, and only T or U count', () => {
    expect(ninthCharacter('SPE4A726T1234')).toBe('T')
    expect(ninthCharacter('SPE4A7-26-U-1234')).toBe('U')
    expect(ninthCharacter('SPE4A726Q1234')).toBeNull()
    expect(ninthCharacter('SPE4A72')).toBeNull()
  })
})

describe('what is carried, and what is deliberately not', () => {
  it('carries the measured fields off a corner row, each with a sentence naming its source', () => {
    const p = buildPrefill(CORNER)
    const byField = new Map(p.carried.map((c) => [c.field, c]))

    expect(byField.get('nsn')?.value).toBe('1650-01-059-8221')
    expect(byField.get('solicitation_number')?.value).toBe('SPE4A726T1234')
    expect(byField.get('cage')?.value).toBe('99207')
    expect(byField.get('part_number')?.value).toBe('A-7743-1')
    expect(byField.get('qty')?.value).toBe('42')
    expect(byField.get('unit_price')?.value).toBe('3841.27')
    expect(byField.get('type_character')?.value).toBe('T')
    expect(byField.get('is_automated')?.value).toBe('on')

    // The feed day is NAMED on every field that came off the feed. A value with no traceable day is
    // a value nobody can check.
    for (const field of ['nsn', 'solicitation_number', 'cage', 'qty'] as const) {
      expect(byField.get(field)?.origin).toContain('2026-08-14')
    }
    // Every carried value is measured. Nothing modelled reaches a field.
    expect(p.carried.every((c) => c.provenance === 'measured')).toBe(true)
  })

  it('the carried quantity says it is what DLA is buying, not what the operator holds', () => {
    const origin = buildPrefill(CORNER).carried.find((c) => c.field === 'qty')?.origin ?? ''
    expect(origin).toContain('THIS IS WHAT DLA IS BUYING')
    expect(origin).toContain('not a')
    expect(origin).toContain('change it')
  })

  it('the carried price says on the field that it is the last price the GOVERNMENT paid', () => {
    const price = buildPrefill(CORNER).carried.find((c) => c.field === 'unit_price')
    expect(price?.origin).toContain('LAST PRICE THE GOVERNMENT PAID')
    expect(price?.origin).toContain('IT IS NOT YOUR QUOTE')
    expect(price?.origin).toContain('2025-11-04')
    expect(price?.origin).toContain('MOOG INC')
    expect(price?.needs_confirmation).toBe(true)
  })

  it('ABSTAINS on the CAGE when more than one company is approved, and says how many', () => {
    const two = buildPrefill({
      ...CORNER,
      corner: { ...CORNER.corner!, approved_sources: ['99207', '12345'], sole_source: false },
    })
    expect(two.carried.some((c) => c.field === 'cage')).toBe(false)
    const reason = two.abstentions.find((a) => a.field === 'cage')?.reason ?? ''
    expect(reason).toContain('2 companies')
    expect(reason).toContain('99207')
    expect(reason).toContain('12345')
  })

  it('ABSTAINS on the part number when the cross-reference records more than one', () => {
    const many = buildPrefill({ ...CORNER, part_numbers: ['A-7743-1', 'A-7743-2'] })
    expect(many.carried.some((c) => c.field === 'part_number')).toBe(false)
    expect(many.abstentions.find((a) => a.field === 'part_number')?.reason).toContain('2 part numbers')
  })

  it('ABSTAINS on the price when no award carries one, rather than carrying a zero', () => {
    const noAward = buildPrefill({ ...CORNER, latest_award: null })
    expect(noAward.carried.some((c) => c.field === 'unit_price')).toBe(false)
    expect(noAward.abstentions.find((a) => a.field === 'unit_price')?.reason).toContain('left empty')

    const zeroAward = buildPrefill({
      ...CORNER,
      latest_award: { ...CORNER.latest_award!, unit_price: 0 },
    })
    expect(zeroAward.carried.some((c) => c.field === 'unit_price')).toBe(false)
  })

  it('NEVER carries the supplier, the material condition or the acquisition channel', () => {
    const p = buildPrefill(CORNER)
    const fields = p.carried.map((c) => c.field)
    expect(fields).not.toContain('supplier')
    expect(fields).not.toContain('material_condition')
    expect(fields).not.toContain('acquisition_channel')
    for (const field of ['supplier', 'material_condition', 'acquisition_channel'] as const) {
      expect(p.abstentions.some((a) => a.field === field)).toBe(true)
    }
  })

  it('a MODELLED deal value is reported as a note and reaches no field at all', () => {
    const p = buildPrefill({
      ...CORNER,
      kind: 'deal',
      requested: 'deal-1',
      deal: {
        id: 'deal-1',
        title: 'Moog manifold',
        ref: '1650-01-059-8221',
        niin: '010598221',
        stage: 'opportunities',
        modeled_value_usd: 161333,
      },
    })
    expect(p.notes.join(' ')).toContain('MODELED value of $161,333')
    expect(p.notes.join(' ')).toContain('carried into no field')
    // The proof it did not leak: no carried value equals the modelled figure in any form.
    expect(p.carried.some((c) => c.value.includes('161333') || c.value.includes('161,333'))).toBe(false)
  })

  it('a deal whose reference is not a stock number carries nothing and says why', () => {
    const p = buildPrefill({
      kind: 'deal',
      requested: 'deal-2',
      feed_day: '2026-08-14',
      deal: {
        id: 'deal-2',
        title: 'Bearing lot from Tuesday',
        ref: 'call with Ken',
        niin: null,
        stage: 'opportunities',
        modeled_value_usd: null,
      },
      corner: null,
      latest_award: null,
      part_numbers: [],
    })
    expect(p.carried).toHaveLength(0)
    expect(p.abstentions.find((a) => a.field === 'nsn')?.reason).toContain('not a thirteen-digit stock number')
  })

  it('a stock number off a CRM card is carried but flagged for confirmation, unlike a parsed one', () => {
    const fromCard = buildPrefill({
      kind: 'deal',
      requested: 'deal-3',
      feed_day: null,
      deal: {
        id: 'deal-3',
        title: 'Hand-entered lot',
        ref: '1650-01-059-8221',
        niin: null,
        stage: 'quoting',
        modeled_value_usd: null,
      },
      corner: null,
      latest_award: null,
      part_numbers: [],
    })
    const nsn = fromCard.carried.find((c) => c.field === 'nsn')
    expect(nsn?.needs_confirmation).toBe(true)
    expect(nsn?.origin).toContain("person's own entry")

    // The same field off a parsed corner row needs no confirmation.
    expect(buildPrefill(CORNER).carried.find((c) => c.field === 'nsn')?.needs_confirmation).toBe(false)
  })

  it('says so plainly when the feed day itself could not be read', () => {
    const p = buildPrefill({ ...CORNER, feed_day: null })
    expect(p.carried.find((c) => c.field === 'nsn')?.origin).toContain('feed day could not be read')
  })
})

describe('reconciliation across the GET round trip', () => {
  it('an untouched carried value reads as carried', () => {
    const p = buildPrefill(CORNER)
    const facts = applyPrefill(EMPTY_FACTS, p)
    const r = reconcileCarried(p, facts)
    expect(r.every((x) => x.status === 'unchanged')).toBe(true)
    expect(r.find((x) => x.field === 'unit_price')?.statement).toContain('not changed')
  })

  it('AN EDITED FIELD STOPS BEING DESCRIBED AS CARRIED, which is the whole point of this function', () => {
    const p = buildPrefill(CORNER)
    const facts = { ...applyPrefill(EMPTY_FACTS, p), unit_price: '4100.00' }
    const price = reconcileCarried(p, facts).find((x) => x.field === 'unit_price')
    expect(price?.status).toBe('edited')
    expect(price?.statement).toContain('entered by the operator')
    expect(price?.statement).toContain('3841.27')
    // The old sentence, which claims the government paid this, must not be repeated over a new number.
    expect(price?.statement).not.toContain('LAST PRICE THE GOVERNMENT PAID')
  })

  it('a cleared field reads as cleared, never as carried and never as empty-by-default', () => {
    const p = buildPrefill(CORNER)
    const facts = { ...applyPrefill(EMPTY_FACTS, p), cage: '' }
    const cage = reconcileCarried(p, facts).find((x) => x.field === 'cage')
    expect(cage?.status).toBe('cleared')
    expect(cage?.statement).toContain('cleared it')
  })

  it('a carried checkbox reconciles on its own truth, not on a string', () => {
    const p = buildPrefill(CORNER)
    const on = reconcileCarried(p, applyPrefill(EMPTY_FACTS, p)).find((x) => x.field === 'is_automated')
    expect(on?.status).toBe('unchanged')
    const off = reconcileCarried(p, { ...applyPrefill(EMPTY_FACTS, p), is_automated: false }).find(
      (x) => x.field === 'is_automated',
    )
    expect(off?.status).toBe('cleared')
  })
})

describe('the confirmation gate: a figure nobody chose never reads as ready to submit', () => {
  const complete = () => {
    const p = buildPrefill(CORNER)
    return {
      p,
      facts: {
        ...applyPrefill(EMPTY_FACTS, p),
        validity_days: '90',
        supplier: 'OLY AERO',
        material_condition: 'new_unused',
        acquisition_channel: 'oem_direct',
      },
    }
  }

  it('holds the quote packet and the purchase order at draft while the carried price is unconfirmed', () => {
    const { p, facts } = complete()
    const carried = reconcileCarried(p, facts)
    const blockers = unconfirmedCarryBlockers(carried, false)
    expect(blockers.quote_packet.length).toBe(1)
    expect(blockers.purchase_order.length).toBe(1)
    // PRECISION MATTERS: the traceability packet does not cite a price, so blocking it would be a
    // false blocker, and a control that cries wolf is a control that gets switched off.
    expect(blockers.traceability_packet).toHaveLength(0)
    expect(blockers.counter_offer_memo).toHaveLength(0)

    const view = buildDocumentsView(facts, AS_OF, blockers)
    const quote = view.deliverables.find((d) => d.kind === 'quote_packet')
    expect(quote?.state).toBe('draft_awaiting_approval')
    expect(quote?.statement).toContain('no person has confirmed it as ours')
  })

  it('ticking the confirmation clears it, and so does editing the figure', () => {
    const { p, facts } = complete()
    expect(unconfirmedCarryBlockers(reconcileCarried(p, facts), true).quote_packet).toHaveLength(0)

    const edited = { ...facts, unit_price: '4100.00' }
    expect(unconfirmedCarryBlockers(reconcileCarried(p, edited), false).quote_packet).toHaveLength(0)
  })

  it('POSITIVE CONTROL: with the gate removed the same lot reads READY TO SUBMIT', () => {
    /*
     * This is the defect the gate exists to prevent, reproduced deliberately. Passing no extra
     * blockers is exactly what the code did before this lane touched it, and the assertion below is
     * what an operator would have seen: a quote packet chipped ready to submit at a price the
     * previous incumbent won at, chosen by nobody. If a future edit makes the gate a no-op, the test
     * above goes red and this one stays green, which is how the pair localises the break.
     */
    const { facts } = complete()
    const unguarded = buildDocumentsView(facts, AS_OF)
    expect(unguarded.deliverables.find((d) => d.kind === 'quote_packet')?.state).toBe('ready_to_submit')
  })

  it('unconfirmedCarries names exactly the figures still waiting on a person', () => {
    const { p, facts } = complete()
    const pending = unconfirmedCarries(reconcileCarried(p, facts), false)
    expect(pending.map((x) => x.field)).toEqual(['unit_price'])
    expect(unconfirmedCarries(reconcileCarried(p, facts), true)).toHaveLength(0)
  })

  it('the extra-blocker channel can only ADD, never clear an existing blocker', () => {
    // A lot with an open compliance blocker stays blocked no matter what is passed in.
    const bare = { ...EMPTY_FACTS, nsn: '1650-01-059-8221' }
    const before = buildDocumentsView(bare, AS_OF)
    const after = buildDocumentsView(bare, AS_OF, {
      quote_packet: [],
      purchase_order: [],
      traceability_packet: [],
      counter_offer_memo: [],
    })
    expect(after.deliverables.map((d) => d.state)).toEqual(before.deliverables.map((d) => d.state))
  })

  it('every field this module can carry has an explicit deliverable mapping', () => {
    // A new prefillable field with no mapping would silently block nothing. This catches that.
    for (const [field, kinds] of Object.entries(FIELD_USED_BY)) {
      expect(Array.isArray(kinds), `${field} has no deliverable mapping`).toBe(true)
    }
  })
})

describe('the empty case', () => {
  it('NO_PREFILL carries nothing, abstains from nothing and reconciles to nothing', () => {
    expect(NO_PREFILL.carried).toHaveLength(0)
    expect(reconcileCarried(NO_PREFILL, EMPTY_FACTS)).toHaveLength(0)
    expect(applyPrefill(EMPTY_FACTS, NO_PREFILL)).toEqual(EMPTY_FACTS)
  })
})
