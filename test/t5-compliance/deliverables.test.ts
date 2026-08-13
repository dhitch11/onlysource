import { describe, expect, it } from 'vitest'
import {
  HardRenderFailure,
  assemble,
  deterministicValue,
  extractUnpayloadedNumerals,
  numeralTokens,
  sourceBytes,
  type Template,
} from '@/lib/compliance/deliverables/assembler'
import {
  deliverableState,
  quotePacketTemplate,
  templateFor,
  traceabilityPacketTemplate,
} from '@/lib/compliance/deliverables/artifacts'
import {
  EMPTY_FACTS,
  buildDocumentsView,
  type CapturedFacts,
} from '@/lib/compliance/deliverables/view-model'
import { runPreflight } from '@/lib/compliance/preflight'
import { RULES, quotationOf } from '@/lib/compliance/citations'

const AS_OF = '2026-08-13T00:00:00Z'
const dv = (display: string, column = 'c') =>
  deterministicValue({ display, table: 'operator_entry', column, row_id: 'r1', as_of: AS_OF })

// =====================================================================================================
describe('assembler: law 2, the two CI fixtures', () => {
  it('FIXTURE 1: a dangling {{fN}} reference is a hard render failure, not a blank', () => {
    const tpl: Template = {
      id: 'fixture_dangling',
      title: 'Dangling',
      segments: [
        { kind: 'fixed', text: 'Total: ', numerals_declared: [] },
        { kind: 'payload', ref: 'f9', label: 'the extended total' },
      ],
    }
    expect(() => assemble(tpl, {}, {})).toThrow(HardRenderFailure)
    try {
      assemble(tpl, {}, {})
    } catch (e) {
      const f = (e as HardRenderFailure).failures
      expect(f[0]?.kind).toBe('dangling_reference')
      expect(f[0]?.statement).toContain('f9')
    }
  })

  it('FIXTURE 2: a numeral in a signed narrative with no backing payload fails', () => {
    const tpl: Template = {
      id: 'fixture_numeral',
      title: 'Numeral',
      segments: [{ kind: 'narrative', ref: 'n1', label: 'the basis' }],
    }
    const narratives = {
      n1: {
        text: 'We counter at 38237.79 based on the management price.',
        authored_by: 'dhitchman',
        signed_by: 'dhitchman',
        signed_at: AS_OF,
      },
    }
    expect(() => assemble(tpl, {}, narratives)).toThrow(HardRenderFailure)
    try {
      assemble(tpl, {}, narratives)
    } catch (e) {
      const f = (e as HardRenderFailure).failures
      expect(f.some((x) => x.kind === 'unpayloaded_numeral')).toBe(true)
    }
  })

  it('POSITIVE CONTROL: the same narrative passes once the figure is a real payload', () => {
    const tpl: Template = {
      id: 'fixture_numeral_ok',
      title: 'Numeral ok',
      segments: [
        { kind: 'payload', ref: 'f1', label: 'the counter' },
        { kind: 'narrative', ref: 'n1', label: 'the basis' },
      ],
    }
    const out = assemble(
      tpl,
      { f1: dv('38237.79', 'counter_price') },
      {
        n1: {
          text: ' We counter at 38237.79 based on the management price.',
          authored_by: 'dhitchman',
          signed_by: 'dhitchman',
          signed_at: AS_OF,
        },
      },
    )
    expect(out.body).toContain('38237.79')
    expect(out.figure_provenance[0]?.column).toBe('counter_price')
  })

  it('fails an unsigned narrative, because an unsigned section is not attributable', () => {
    const tpl: Template = {
      id: 'fixture_unsigned',
      title: 'Unsigned',
      segments: [{ kind: 'narrative', ref: 'n1', label: 'the basis' }],
    }
    try {
      assemble(tpl, {}, { n1: { text: 'No figures here.', authored_by: 'x', signed_by: '', signed_at: '' } })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as HardRenderFailure).failures.some((x) => x.kind === 'unsigned_narrative')).toBe(true)
    }
  })

  it('fails an undeclared numeral in fixed text, so a typo in a citation cannot ship', () => {
    const tpl: Template = {
      id: 'fixture_undeclared',
      title: 'Undeclared',
      segments: [{ kind: 'fixed', text: 'Per DLAD 11.391 and 11.999.', numerals_declared: ['11.391'] }],
    }
    try {
      assemble(tpl, {}, {})
      throw new Error('should have thrown')
    } catch (e) {
      const f = (e as HardRenderFailure).failures
      const first = f[0]
      expect(first?.kind).toBe('undeclared_numeral_in_fixed_text')
      // Narrow the union before reading a member-specific field.
      if (first && first.kind === 'undeclared_numeral_in_fixed_text') {
        expect(first.numeral).toBe('11.999')
      }
    }
  })

  it('refuses to mint SourceBytes without a real content hash', () => {
    expect(() =>
      sourceBytes({ storage_key: 'k', sha256: 'nope', byte_length: 1, document_id: 'd1' }),
    ).toThrow(/content-addressed/)
  })

  it('tokenises a stock number and a citation as single units', () => {
    expect(numeralTokens('NSN 1650-01-059-8221 per FAR 52.246-15')).toEqual([
      '1650-01-059-8221',
      '52.246-15',
    ])
  })

  it('the independent extractor agrees with the assembler', () => {
    const payloads = { f1: dv('8172.00') }
    expect(extractUnpayloadedNumerals('Total 8172.00 per 52.246-15', payloads, ['52.246-15'])).toEqual([])
    expect(extractUnpayloadedNumerals('Total 9999.00', payloads, [])).toEqual(['9999.00'])
  })

  it('a real template renders and every numeral in it is accounted for', () => {
    const tpl = traceabilityPacketTemplate('l04')
    const payloads = {
      f1: dv('1650-01-059-8221', 'nsn'),
      f2: dv('99207', 'cage'),
      f3: dv('70550-28900-106', 'part_number'),
      f4: dv('190', 'qty'),
    }
    const art = assemble(tpl, payloads, {})
    const declared = tpl.segments.flatMap((s) => (s.kind === 'fixed' ? s.numerals_declared : []))
    expect(extractUnpayloadedNumerals(art.body, payloads, declared)).toEqual([])
  })
})

// =====================================================================================================
describe('deliverable state: REGRESSION, ready requires an artifact that exists', () => {
  const fullQuotePayloads = {
    f1: dv('SPE4A626Q0227'),
    f2: dv('1650-01-059-8221'),
    f3: dv('3565.00'),
    f4: dv('1'),
    f5: dv('120'),
  }

  it('is NOT ready when every field is present but no artifact was assembled', () => {
    // This is the defect that shipped: field presence read as readiness.
    const st = deliverableState({
      kind: 'quote_packet',
      payloads: fullQuotePayloads,
      artifact: { assembled: false, reason: 'no_template_in_this_build', refusals: [] },
      open_blockers: [],
    })
    expect(st.state).not.toBe('ready_to_submit')
    expect(st.state).toBe('generate_from_blueprint')
    expect(st.statement).toContain('no artifact exists')
  })

  it('is ready when the fields are present AND the artifact assembled AND nothing blocks', () => {
    const st = deliverableState({
      kind: 'quote_packet',
      payloads: fullQuotePayloads,
      artifact: { assembled: true },
      open_blockers: [],
    })
    expect(st.state).toBe('ready_to_submit')
  })

  it('reports the missing field by name before anything else', () => {
    const st = deliverableState({
      kind: 'quote_packet',
      payloads: { f1: dv('X') },
      artifact: { assembled: true },
      open_blockers: [],
    })
    expect(st.state).toBe('generate_from_blueprint')
    expect(st.missing.map((m) => m.ref)).toContain('f3')
  })

  it('never reports ready while a compliance blocker is open', () => {
    const st = deliverableState({
      kind: 'quote_packet',
      payloads: fullQuotePayloads,
      artifact: { assembled: true },
      open_blockers: ['Surplus is ineligible for automated award on this AIDC solicitation.'],
    })
    expect(st.state).toBe('draft_awaiting_approval')
    expect(st.statement).toContain('must not be submitted')
  })

  it('holds a purchase order at draft until a named person approves, even when clean', () => {
    const st = deliverableState({
      kind: 'purchase_order',
      payloads: { f1: dv('OLY Aero'), f2: dv('1650'), f3: dv('1021.50'), f4: dv('8'), f5: dv('8172.00') },
      artifact: { assembled: true },
      open_blockers: [],
    })
    expect(st.state).toBe('draft_awaiting_approval')
    expect(st.next_action).toContain('commits money')
  })

  it('every one of the four kinds has a template, so none is silently unbuildable', () => {
    for (const k of ['quote_packet', 'purchase_order', 'counter_offer_memo'] as const) {
      expect(templateFor(k, 'l04')).not.toBeNull()
    }
    expect(templateFor('traceability_packet', 'l04')).not.toBeNull()
    // Honest null: there is no traceability packet until the path is known.
    expect(templateFor('traceability_packet', 'unknown')).toBeNull()
  })

  it('the quote packet template declares no stray numerals of its own', () => {
    const tpl = quotePacketTemplate()
    for (const seg of tpl.segments) {
      if (seg.kind === 'fixed') {
        expect(numeralTokens(seg.text)).toEqual([...seg.numerals_declared])
      }
    }
  })
})

// =====================================================================================================
describe('view model: the screen shows the true state or an honest empty one', () => {
  it('renders an honest empty state, with no rows, when nothing is captured', () => {
    const v = buildDocumentsView(EMPTY_FACTS, AS_OF)
    expect(v.captured).toBe(false)
    expect(v.deliverables).toEqual([])
    expect(v.artifacts).toEqual([])
    expect(v.empty_state?.body).toContain('no sample rows')
  })

  const broker: CapturedFacts = {
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

  it('classifies broker stock to L04 and assembles its traceability packet for real', () => {
    const v = buildDocumentsView(broker, AS_OF)
    expect(v.classification?.path_label).toContain('L04')
    const tp = v.artifacts.find((a) => a.kind === 'traceability_packet')
    expect(tp?.view.ok).toBe(true)
    if (tp?.view.ok) expect(tp.view.body).toContain('1650-01-059-8221')
  })

  it('refuses the counter-offer memo until a person has signed its basis', () => {
    const v = buildDocumentsView({ ...broker, countered_price: '40', counter_price: '38237.79' }, AS_OF)
    const memo = v.deliverables.find((d) => d.kind === 'counter_offer_memo')
    expect(memo?.state).not.toBe('ready_to_submit')
    const art = v.artifacts.find((a) => a.kind === 'counter_offer_memo')
    expect(art?.view.ok).toBe(false)
    if (art && !art.view.ok) {
      expect(art.view.refusals.join(' ')).toContain('signed')
    }
  })

  it('blocks every deliverable when a U-type solicitation disqualifies the surplus', () => {
    const surplus: CapturedFacts = {
      ...broker,
      acquisition_channel: 'dla_disposition_sale',
      form_1427_document_id: 'doc-1',
      sale_solicitation_document_id: 'doc-2',
      type_character: 'U',
    }
    const v = buildDocumentsView(surplus, AS_OF)
    expect(v.classification?.path_label).toContain('C04')
    expect(v.preflight?.verdict).toBe('blocked')
    // The blocker propagates: nothing is ready to submit while it stands.
    expect(v.deliverables.every((d) => d.state !== 'ready_to_submit')).toBe(true)
  })

  it('says CANNOT ASSESS, never clear, when the solicitation type was not delivered', () => {
    const surplusUnknownType: CapturedFacts = {
      ...broker,
      acquisition_channel: 'dla_disposition_sale',
      form_1427_document_id: 'doc-1',
      sale_solicitation_document_id: 'doc-2',
      type_character: '',
    }
    const v = buildDocumentsView(surplusUnknownType, AS_OF)
    expect(v.preflight?.verdict).toBe('cannot_assess')
    expect(v.preflight?.verdict).not.toBe('clear')
  })

  it('surfaces the quarantined C03 rule rather than hiding the gap', () => {
    const v = buildDocumentsView(broker, AS_OF)
    expect(v.quarantined_rules.some((r) => r.identifier.includes('C03'))).toBe(true)
  })

  it('never emits a quotation for a rule whose text is unverified', () => {
    // Drive a blocked pre-flight and confirm every rendered quote is non-null only where verified.
    const v = buildDocumentsView({ ...broker, quote_carries_remark: true, is_automated: true }, AS_OF)
    expect(v.preflight?.verdict).toBe('blocked')
    for (const f of v.preflight?.findings ?? []) {
      if (f.quote !== null) expect(f.quote.length).toBeGreaterThan(0)
    }
  })
})

// =====================================================================================================
describe('preflight: the habitual killers and the fail-closed cases', () => {
  const base = {
    lot_id: 'l1',
    compliance_path: 'l04_part_numbered_traceability' as const,
    category: 'commercial_surplus' as const,
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

  it('is clear on a clean candidate', () => {
    expect(runPreflight(base).verdict).toBe('clear')
  })

  it('blocks on a stray Remark, quoting the rule', () => {
    const r = runPreflight({ ...base, quote: { ...base.quote, remarks_present: true } })
    expect(r.verdict).toBe('blocked')
    expect(r.findings[0]?.rule.quote).toContain('Quoting Remarks')
    expect(r.findings[0]?.reroute).toContain('Remove the remark')
  })

  it('blocks on None against a Higher Level Quality requirement', () => {
    const r = runPreflight({
      ...base,
      quote: { ...base.quote, higher_level_quality_answered_none: true },
    })
    expect(r.verdict).toBe('blocked')
    expect(r.findings[0]?.failing_field).toContain('higher_level_quality')
  })

  it('blocks an alternate product on an automated solicitation', () => {
    const r = runPreflight({ ...base, l04_self_classification: 'alternate_product' })
    expect(r.verdict).toBe('blocked')
    expect(r.findings.some((f) => f.check === 'alternate_on_automated')).toBe(true)
  })

  it('blocks a QPL item whose quoted manufacturer is not listed', () => {
    const r = runPreflight({
      ...base,
      solicitation: { ...base.solicitation, requires_qpl_or_qml: true },
      listing: { ...base.listing, quoted_manufacturer_on_qpl_or_qml: false },
    })
    expect(r.verdict).toBe('blocked')
  })

  it('cannot assess, rather than clear, when a QPL listing was never checked', () => {
    const r = runPreflight({
      ...base,
      solicitation: { ...base.solicitation, requires_qpl_or_qml: true },
      listing: { ...base.listing, quoted_manufacturer_on_qpl_or_qml: 'unknown' },
    })
    expect(r.verdict).toBe('cannot_assess')
  })

  it('leaves surplus alone on a T-type buy and blocks it on a U-type', () => {
    const surplus = {
      ...base,
      compliance_path: 'c04_surplus_representation' as const,
      category: 'government_surplus' as const,
    }
    expect(runPreflight(surplus).verdict).toBe('clear')
    const u = runPreflight({
      ...surplus,
      solicitation: { ...surplus.solicitation, type_character: 'U' as const },
    })
    expect(u.verdict).toBe('blocked')
    expect(u.findings.some((f) => f.check === 'surplus_solicitation_type')).toBe(true)
  })

  it('blocks a sub-90-day validity period on an AIDC buy', () => {
    const r = runPreflight({
      ...base,
      solicitation: { ...base.solicitation, type_character: 'U' as const },
      quote: { ...base.quote, validity_period_days: 60 },
    })
    expect(r.verdict).toBe('blocked')
    expect(r.findings.some((f) => f.failing_field.includes('validity'))).toBe(true)
  })
})

// =====================================================================================================
// Corrections verified against the Rev-81 PDF by this lane on 2026-08-13, not inherited.
describe('Rev-81 corrections: the open factor set and the two identical sentences', () => {
  const base = {
    lot_id: 'l1',
    compliance_path: 'c04_surplus_representation' as const,
    category: 'government_surplus' as const,
    l04_self_classification: 'exact_product' as const,
    solicitation: {
      solicitation_number: 'SPE4A626T0001',
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

  it('an applicable Buy American factor with no resolved amount is a DATA GAP, not a zero', () => {
    const r = runPreflight({
      ...base,
      solicitation: { ...base.solicitation, subject_to_buy_american_or_bop: true },
    })
    expect(r.verdict).toBe('cannot_assess')
    const f = r.findings.find((x) => x.check === 'evaluation_factor_unresolved')
    expect(f?.statement).toContain('FLOOR')
    // No invented amount anywhere in the finding.
    expect(f?.statement).not.toMatch(/\$\d/)
  })

  it('does not fire once the factor amount has been established', () => {
    const r = runPreflight({
      ...base,
      solicitation: {
        ...base.solicitation,
        subject_to_buy_american_or_bop: true,
        buy_american_factor_amount_usd: 0,
      },
    })
    expect(r.findings.some((x) => x.check === 'evaluation_factor_unresolved')).toBe(false)
  })

  it('the SAME surplus sentence is registered twice, with opposite effect, keyed on instrument', () => {
    const partI = quotationOf(RULES.ms_surplus_not_an_exception_on_standard_buy)
    const partII = quotationOf(RULES.ms_surplus_ineligible_on_aidc)
    expect(partI.ok && partII.ok).toBe(true)
    if (partI.ok && partII.ok) {
      const sentence = 'Quoting a used, reconditioned, remanufactured item, or unused former Government surplus property.'
      expect(partI.quote).toContain(sentence)
      expect(partII.quote).toContain(sentence)
      expect(partI.identifier).toContain('Part I')
      expect(partII.identifier).toContain('Part II')
    }
    // The gate keys on the instrument, so identical text produces opposite verdicts.
    expect(runPreflight(base).verdict).toBe('clear')
    expect(
      runPreflight({ ...base, solicitation: { ...base.solicitation, type_character: 'U' } }).verdict,
    ).toBe('blocked')
  })

  it('the 90-day AIDC exception cites Part II 1(b), not the adjacent surplus paragraph 1(a)', () => {
    const r = runPreflight({
      ...base,
      compliance_path: 'l04_part_numbered_traceability',
      category: 'commercial_surplus',
      solicitation: { ...base.solicitation, type_character: 'U' },
      quote: { ...base.quote, validity_period_days: 60 },
    })
    const f = r.findings.find((x) => x.failing_field.includes('validity'))
    expect(f?.rule.citation.identifier).toContain('para 1(b)')
    expect(f?.rule.citation.identifier).not.toContain('1(a)')
  })

  it('3(g) carries its full text including the location clause', () => {
    const q = quotationOf(RULES.ms_alternate_no_automated_award)
    expect(q.ok).toBe(true)
    if (q.ok) expect(q.quote).toContain('to the location identified in the solicitation')
  })

  it('the factor quotation is reproduced with the source unclosed parenthesis, and says so', () => {
    const q = quotationOf(RULES.ms_automated_evaluation_factors)
    expect(q.ok).toBe(true)
    // The source's unclosed parenthesis is the one opening "(see DFARS"; the cite itself ends "(c).".
    if (q.ok) expect(q.quote).toContain('(see DFARS 225.502(c).')
    expect(RULES.ms_automated_evaluation_factors.quote_normalization).toContain('Not corrected')
  })
})
