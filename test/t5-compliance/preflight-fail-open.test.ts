/**
 * THE UNCLASSIFIED-LOT FAIL-OPEN, CLOSED. Regression pins for the 2026-08-16 audit finding.
 *
 * Measured live before the fix: with the material condition uncaptured, classification said
 * "no compliance path can be asserted" while the pre-flight chipped CLEAR ("the solicitation
 * type does not exclude this material", a check that never ran) and the quote packet chipped
 * READY TO SUBMIT, its own body citing a traceability enclosure that could not be built. An
 * operator submitting on that chip ships a surplus quote with no surplus representation:
 * the exact rejection the pre-flight exists to prevent.
 *
 * The contract now:
 *   - an unclassified lot's surplus fork is UNASSESSABLE, stated, never skipped;
 *   - the clear statement enumerates only checks that actually ran;
 *   - the quote packet is blocked by unasserted classification and by an unbuildable
 *     enclosure it cites;
 *   - POSITIVE CONTROL: a fully classified, clean lot still reaches ready-to-submit, so the
 *     fix over-blocks nothing.
 */

import { describe, expect, it } from 'vitest'
import {
  EMPTY_FACTS,
  buildDocumentsView,
  type CapturedFacts,
} from '@/lib/compliance/deliverables/view-model'
import { runPreflight } from '@/lib/compliance/preflight'

const AS_OF = '2026-08-16'

const captured: CapturedFacts = {
  ...EMPTY_FACTS,
  nsn: '1650-01-059-8221',
  cage: '99207',
  part_number: '70550-28900-106',
  qty: '190',
  unit_price: '3565.00',
  validity_days: '120',
  supplier: 'OLY Aero',
  solicitation_number: 'SPE4A626Q0227',
  material_condition: 'new_unused',
  acquisition_channel: 'dealer_purchase',
}

describe('the unclassified lot can no longer clear the pre-flight', () => {
  it('THE MEASURED DEFECT: quote fields full, material condition uncaptured -> CANNOT ASSESS with the gap named, and no clear statement', () => {
    const unclassified: CapturedFacts = { ...captured, material_condition: '', acquisition_channel: '' }
    const v = buildDocumentsView(unclassified, AS_OF)
    expect(v.classification?.is_classified).toBe(false)
    expect(v.preflight?.verdict).toBe('cannot_assess')
    expect(v.preflight?.clear_statement).toBeNull()
    const f = v.preflight?.findings.find((x) => x.check === 'surplus solicitation type')
    expect(f?.severity).toBe('unassessable')
    expect(f?.statement).toContain('cannot be assessed')
  })

  it('THE MEASURED DEFECT: the quote packet is a DRAFT while no compliance path is asserted, with the blocker stated', () => {
    const unclassified: CapturedFacts = { ...captured, material_condition: '', acquisition_channel: '' }
    const v = buildDocumentsView(unclassified, AS_OF)
    const quote = v.deliverables.find((d) => d.kind === 'quote_packet')
    expect(quote?.state).not.toBe('ready_to_submit')
    expect(quote?.statement).toContain('must not be submitted')
    expect(quote?.statement).toContain('No compliance path is asserted')
  })

  it('an enclosure the quote cites but cannot build blocks the quote that cites it', () => {
    // Classified and pre-flight-clean, but the traceability packet is missing its CAGE and
    // part number: the quote renders while its own named enclosure cannot exist.
    const noTrace: CapturedFacts = { ...captured, cage: '', part_number: '' }
    const v = buildDocumentsView(noTrace, AS_OF)
    expect(v.preflight?.verdict).toBe('clear') // the pre-flight itself has nothing to block
    const quote = v.deliverables.find((d) => d.kind === 'quote_packet')
    expect(quote?.state).not.toBe('ready_to_submit')
    expect(quote?.statement).toContain('traceability packet')
  })

  it('POSITIVE CONTROL: the fully classified, clean lot still reaches ready-to-submit', () => {
    const v = buildDocumentsView(captured, AS_OF)
    expect(v.preflight?.verdict).toBe('clear')
    const quote = v.deliverables.find((d) => d.kind === 'quote_packet')
    expect(quote?.state).toBe('ready_to_submit')
  })
})

describe('the clear statement enumerates only checks that ran', () => {
  const base = {
    lot_id: 'l1',
    l04_self_classification: 'exact_product' as const,
    solicitation: {
      solicitation_number: 'SPE4A626Q0227',
      type_character: 'T' as const,
      solicitation_type_indicator: 'F' as const,
      is_automated: true,
      requires_qpl_or_qml: false as const,
      requires_qsld_or_qsl: false as const,
      cites_export_control: false as const,
      requires_higher_level_quality: false as const,
    },
    quote: {
      taking_exception_to_item_description: false as const,
      exception_to_packaging: false as const,
      exception_to_fob_terms: false as const,
      exception_to_inspection: false as const,
      exception_to_required_quantity: false as const,
      quantity_variance_greater_than_specified: false as const,
      higher_level_quality_answered_none: false as const,
      quotes_child_labor: false as const,
      remarks_present: false as const,
      validity_period_days: 120,
    },
    listing: {
      quoter_on_qsld_or_qsl: true as const,
      quoted_manufacturer_on_qpl_or_qml: true as const,
      quoter_export_certification_current: true as const,
      manufacturer_export_certification_current: true as const,
    },
  }

  it('a clear SURPLUS lot on a T-type buy claims the solicitation-type check it actually ran', () => {
    const r = runPreflight({
      ...base,
      compliance_path: 'c04_surplus_representation' as const,
      category: 'government_surplus' as const,
    })
    expect(r.verdict).toBe('clear')
    expect(r.clear_statement).toContain('does not exclude this material')
  })

  it('a clear NON-surplus lot says the surplus fork does not apply, instead of claiming a check it skipped', () => {
    const r = runPreflight({
      ...base,
      compliance_path: 'l04_part_numbered_traceability' as const,
      category: 'commercial_surplus' as const,
    })
    expect(r.verdict).toBe('clear')
    expect(r.clear_statement).toContain('does not apply')
    expect(r.clear_statement).not.toContain('does not exclude this material')
  })

  it('an UNKNOWN classification is cannot_assess with the surplus fork named, never clear', () => {
    const r = runPreflight({
      ...base,
      compliance_path: 'unknown' as const,
      category: 'UNKNOWN' as const,
    })
    expect(r.verdict).toBe('cannot_assess')
    expect(r.clear_statement).toBeNull()
    expect(r.findings.some((f) => f.check === 'surplus_solicitation_type' && f.severity === 'unassessable')).toBe(true)
  })
})
