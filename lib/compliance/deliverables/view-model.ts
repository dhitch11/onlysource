/**
 * THE DOCUMENTS AND POs VIEW MODEL.
 *
 * One pure function turns captured facts into everything the screen renders: the deliverable rows and
 * their computed states, the compliance classification with its rules, the pre-flight verdict, and the
 * rendered artifact or the honest refusal to render one.
 *
 * WHY THIS EXISTS AS A SEPARATE LAYER. The conductor's fleet notice is that presentation belongs to T8's
 * components and the mockup is a design comp rather than production markup. So the screen must be a thin
 * render, which means every decision has to be made here, in code that can be tested without a browser.
 * Nothing below returns markup, a class name, a colour or a pixel. It returns sentences and states.
 *
 * The practical test of whether this boundary is right: swapping T8's components in must not change a
 * single verdict, and re-theming the product must not touch this file at all.
 *
 * EVERY STRING HERE IS AUTHORED, NOT GENERATED. The compliance copy on this surface is load-bearing (an
 * unexplained verdict costs an award, and the reader is an expert who has never read the regulation that
 * just blocked him), so it is written by hand in this lane and never produced by a model.
 */

import { citationLabel, quarantinedCitations, type RuleCitation } from '../citations'
import { measured } from '../confirmation'
import { classifyLot, type Determination, type MaterialCondition } from '../classify'
import { runPreflight, type PreflightResult } from '../preflight'
import type { AcquisitionChannel } from '../provenance-ladder'
import {
  DELIVERABLE_LABEL,
  REQUIRED_REFS,
  STATE_LABEL,
  counterOfferMemoTemplate,
  deliverableState,
  templateFor,
  type ArtifactAssembly,
  type DeliverableKind,
  type DeliverableState,
} from './artifacts'
import {
  HardRenderFailure,
  assemble,
  deterministicValue,
  type Payloads,
} from './assembler'

/**
 * What an operator has captured. Every field is a string exactly as entered, because this layer is fed
 * from a form today and from a database row tomorrow, and both arrive as text.
 *
 * An empty string means not captured. There are no defaults, because a defaulted procurement fact is an
 * invented one.
 */
export type CapturedFacts = {
  readonly nsn: string
  readonly cage: string
  readonly part_number: string
  readonly qty: string
  readonly unit_price: string
  readonly validity_days: string
  readonly supplier: string
  readonly solicitation_number: string
  readonly countered_price: string
  readonly counter_price: string
  readonly original_contract_number: string
  readonly form_1427_document_id: string
  readonly sale_solicitation_document_id: string
  readonly material_condition: string
  readonly acquisition_channel: string
  readonly type_character: string
  readonly package_markings_captured: boolean
  readonly is_automated: boolean
  readonly offering_alternate_product: boolean
  readonly item_cites_qpl_or_qml: boolean
  readonly quoted_manufacturer_listed: boolean
  readonly quote_carries_remark: boolean
  readonly higher_level_quality_answered_none: boolean
}

export const EMPTY_FACTS: CapturedFacts = {
  nsn: '', cage: '', part_number: '', qty: '', unit_price: '', validity_days: '', supplier: '',
  solicitation_number: '', countered_price: '', counter_price: '', original_contract_number: '',
  form_1427_document_id: '', sale_solicitation_document_id: '', material_condition: '',
  acquisition_channel: '', type_character: '',
  package_markings_captured: false, is_automated: false, offering_alternate_product: false,
  item_cites_qpl_or_qml: false, quoted_manufacturer_listed: false, quote_carries_remark: false,
  higher_level_quality_answered_none: false,
}

/**
 * NORMALISE AT THE BOUNDARY. Every string field is trimmed before anything reads it.
 *
 * THE DEFECT THIS FIXES, found by T4's audit and it was a stop-ship. Emptiness is tested as
 * `=== ''` throughout this lane, which is the right test against a trimmed string and a silent
 * failure against an untrimmed one. A lot whose unit price and quantity were three spaces each
 * read as CAPTURED, cleared the pre-flight, and rendered a purchase order with an empty unit
 * price, an empty quantity, and an extended total of "0.00": a computed dollar figure invented
 * from whitespace. The numeric guard could not save it either, because `Number('   ')` is 0 in
 * JavaScript rather than NaN, so `Number.isFinite` was perfectly happy. Two guards, each
 * assuming the other handled it.
 *
 * The fix belongs HERE rather than at any individual check, for one reason: this function is the
 * only door into the view model, and a view model that trusts its caller is not a boundary. The
 * page's own form reader already trimmed, so the page path never showed the defect; a direct
 * caller, which is what an audit and a future database reader both are, walked straight in.
 *
 * The audit technique that found it is worth keeping: compare degenerate inputs against each
 * other, because when a MORE degenerate input produces a MORE complete artifact, the validation
 * is keyed on the wrong property. 'ZZZZ' was refused; three spaces rendered a dollar figure.
 */
export function normaliseFacts(f: CapturedFacts): CapturedFacts {
  return {
    nsn: f.nsn.trim(),
    cage: f.cage.trim(),
    part_number: f.part_number.trim(),
    qty: f.qty.trim(),
    unit_price: f.unit_price.trim(),
    validity_days: f.validity_days.trim(),
    supplier: f.supplier.trim(),
    solicitation_number: f.solicitation_number.trim(),
    countered_price: f.countered_price.trim(),
    counter_price: f.counter_price.trim(),
    original_contract_number: f.original_contract_number.trim(),
    form_1427_document_id: f.form_1427_document_id.trim(),
    sale_solicitation_document_id: f.sale_solicitation_document_id.trim(),
    material_condition: f.material_condition.trim(),
    acquisition_channel: f.acquisition_channel.trim(),
    type_character: f.type_character.trim(),
    package_markings_captured: f.package_markings_captured,
    is_automated: f.is_automated,
    offering_alternate_product: f.offering_alternate_product,
    item_cites_qpl_or_qml: f.item_cites_qpl_or_qml,
    quoted_manufacturer_listed: f.quoted_manufacturer_listed,
    quote_carries_remark: f.quote_carries_remark,
    higher_level_quality_answered_none: f.higher_level_quality_answered_none,
  }
}

export const MATERIAL_CONDITIONS: readonly MaterialCondition[] = [
  'new_unused', 'used', 'reconditioned', 'remanufactured',
]

export const ACQUISITION_CHANNELS: readonly AcquisitionChannel[] = [
  'dealer_purchase', 'dla_disposition_sale', 'dla_commercial_venture_sale', 'oem_direct',
  'oem_overrun_purchase', 'terminated_contract_purchase', 'affiliate_transfer', 'unknown',
]

// ---------------------------------------------------------------------------------------------------
// THE VIEW
// ---------------------------------------------------------------------------------------------------

export type DeliverableRow = {
  readonly kind: DeliverableKind
  readonly label: string
  readonly state: DeliverableState
  readonly state_label: string
  /** The identifier line under the title. Never a fabricated stand-in. */
  readonly subtitle: string
  readonly statement: string
  readonly next_action: string
  readonly missing: readonly { readonly ref: string; readonly label: string }[]
}

export type ReasonLine = {
  readonly code: string
  readonly statement: string
  readonly deciding_field: string
}

export type ClassificationView = {
  readonly path_label: string
  readonly is_classified: boolean
  readonly category: string
  readonly reasons: readonly ReasonLine[]
  readonly what_would_change_it: readonly string[]
  /** Internal-audience labels. A customer-facing surface must ask for its own with a live check. */
  readonly rule_labels: readonly string[]
  readonly blocked_facts: readonly { readonly field: string; readonly statement: string; readonly next_action: string }[]
  readonly provenance_rung: number | null
  readonly rung_gap: string | null
}

export type FindingView = {
  readonly check: string
  readonly severity: 'blocking' | 'unassessable'
  readonly statement: string
  readonly failing_field: string
  /** Present only when provenance permits a quotation. Null renders as a description instead. */
  readonly quote: string | null
  readonly quote_attribution: string
  readonly reroute: string | null
}

export type PreflightView = {
  readonly verdict: 'clear' | 'blocked' | 'cannot_assess'
  readonly verdict_label: string
  readonly clear_statement: string | null
  readonly findings: readonly FindingView[]
}

export type ArtifactView =
  | {
      readonly ok: true
      readonly title: string
      readonly body: string
      readonly provenance: readonly {
        readonly ref: string
        readonly value: string
        readonly source: string
      }[]
    }
  | { readonly ok: false; readonly refusals: readonly string[]; readonly explanation: string }

export type DocumentsView = {
  readonly captured: boolean
  readonly empty_state: { readonly title: string; readonly body: string } | null
  readonly deliverables: readonly DeliverableRow[]
  readonly classification: ClassificationView | null
  readonly preflight: PreflightView | null
  /**
   * One entry per deliverable that was actually attempted, in deliverable order. A kind with no template
   * in this build is absent rather than present-and-empty, so nothing here implies an artifact exists
   * when none does.
   */
  readonly artifacts: readonly {
    readonly kind: DeliverableKind
    readonly label: string
    readonly view: ArtifactView
  }[]
  /** Rules whose text we may not quote yet, rendered so the gap is visible rather than silent. */
  readonly quarantined_rules: readonly { readonly identifier: string; readonly why: string }[]
  readonly counter_offer_memo_segment_count: number
}

const DELIVERABLE_ORDER: readonly DeliverableKind[] = [
  'quote_packet', 'purchase_order', 'traceability_packet', 'counter_offer_memo',
]

const PATH_LABEL_SHORT: Readonly<Record<string, string>> = {
  c04_surplus_representation: 'C04 surplus representation path',
  l04_part_numbered_traceability: 'L04 part-numbered traceability path',
  unknown: 'Not classified',
}

const VERDICT_LABEL: Readonly<Record<PreflightResult['verdict'], string>> = {
  clear: 'Clear',
  blocked: 'Blocked',
  cannot_assess: 'Cannot assess',
}

function extendedTotal(qty: string, unit: string): string {
  const q = Number(qty)
  const u = Number(unit)
  if (qty === '' || unit === '' || !Number.isFinite(q) || !Number.isFinite(u)) return ''
  return (q * u).toFixed(2)
}

function payloadsFor(kind: DeliverableKind, f: CapturedFacts, asOf: string): Payloads {
  const out: Record<string, ReturnType<typeof deterministicValue>> = {}
  const put = (ref: string, column: string, value: string) => {
    if (value !== '') {
      out[ref] = deterministicValue({
        display: value,
        table: 'operator_entry',
        column,
        row_id: 'unsaved',
        as_of: asOf,
      })
    }
  }
  switch (kind) {
    case 'quote_packet':
      put('f1', 'solicitation_number', f.solicitation_number)
      put('f2', 'nsn', f.nsn)
      put('f3', 'unit_price', f.unit_price)
      put('f4', 'qty', f.qty)
      put('f5', 'validity_days', f.validity_days)
      return out
    case 'purchase_order':
      put('f1', 'supplier', f.supplier)
      put('f2', 'nsn', f.nsn)
      put('f3', 'unit_price', f.unit_price)
      put('f4', 'qty', f.qty)
      put('f5', 'extended_total', extendedTotal(f.qty, f.unit_price))
      return out
    case 'traceability_packet':
      put('f1', 'nsn', f.nsn)
      put('f2', 'cage', f.cage)
      put('f3', 'part_number', f.part_number)
      put('f4', 'qty', f.qty)
      return out
    case 'counter_offer_memo':
      put('f1', 'nsn', f.nsn)
      put('f2', 'countered_price', f.countered_price)
      put('f3', 'counter_price', f.counter_price)
      return out
  }
}

function classify(f: CapturedFacts, asOf: string): Determination {
  const condition = MATERIAL_CONDITIONS.find((c) => c === f.material_condition)
  const channel = ACQUISITION_CHANNELS.find((c) => c === f.acquisition_channel)
  const src = (ref: string) => ({ kind: 'operator_entry' as const, ref, as_of: asOf })

  return classifyLot({
    lot_id: 'unsaved',
    ...(condition ? { material_condition: measured(condition, src('form.material_condition')) } : {}),
    ...(channel ? { acquisition_channel: measured(channel, src('form.acquisition_channel')) } : {}),
    provenance_evidence: {
      ...(f.form_1427_document_id !== ''
        ? { form_1427_document_id: measured(f.form_1427_document_id, src('form.form_1427')) }
        : {}),
      ...(f.sale_solicitation_document_id !== ''
        ? { sale_solicitation_document_id: measured(f.sale_solicitation_document_id, src('form.sale_solicitation')) }
        : {}),
      ...(f.package_markings_captured && f.nsn !== ''
        ? { markings_nsn: measured(f.nsn, src('form.nsn')) }
        : {}),
      ...(f.package_markings_captured && f.cage !== ''
        ? { markings_cage_code: measured(f.cage, src('form.cage')) }
        : {}),
      ...(f.package_markings_captured && f.part_number !== ''
        ? { markings_part_number: measured(f.part_number, src('form.part_number')) }
        : {}),
      ...(f.original_contract_number !== ''
        ? { markings_original_contract_number: measured(f.original_contract_number, src('form.original_contract_number')) }
        : {}),
    },
  })
}

function labelOf(c: RuleCitation): string {
  const l = citationLabel(c, { audience: 'internal' })
  return l.ok ? l.label : c.identifier
}

/**
 * Build the whole view. Pure: no clock read (the caller passes `asOf`), no IO, no markup.
 */
export function buildDocumentsView(raw: CapturedFacts, asOf: string): DocumentsView {
  // The FIRST statement, deliberately. Nothing below may read an untrimmed field, so there is no
  // ordering by which a later check sees the raw input.
  const f = normaliseFacts(raw)

  const quarantined = quarantinedCitations().map((r) => ({
    identifier: `${r.authority} ${r.identifier}`,
    why:
      'The exact clause wording has not been read in the primary source, so it is described in our own ' +
      'words and never shown as a quotation.',
  }))

  const memoSegments = counterOfferMemoTemplate().segments.length

  // Nothing captured. Say so, and do not invent a row.
  if (f.nsn === '') {
    return {
      captured: false,
      empty_state: {
        title: 'No deliverables yet, because no lot has been captured.',
        body:
          'This list is built from captured lots. Nothing is stored yet, so there is nothing to show, ' +
          'and no sample rows stand in for real ones. Enter a lot below to run it through the real ' +
          'classifier, pre-flight and assembler.',
      },
      deliverables: [],
      classification: null,
      preflight: null,
      artifacts: [],
      quarantined_rules: quarantined,
      counter_offer_memo_segment_count: memoSegments,
    }
  }

  const determination = classify(f, asOf)

  const preflightResult: PreflightResult | null =
    f.solicitation_number === ''
      ? null
      : runPreflight({
          lot_id: 'unsaved',
          compliance_path: determination.path,
          category: determination.category,
          l04_self_classification: f.offering_alternate_product ? 'alternate_product' : 'unknown',
          solicitation: {
            solicitation_number: f.solicitation_number,
            type_character: f.type_character === 'T' ? 'T' : f.type_character === 'U' ? 'U' : 'unknown',
            solicitation_type_indicator: 'unknown',
            is_automated: f.is_automated ? true : 'unknown',
            requires_qpl_or_qml: f.item_cites_qpl_or_qml ? true : 'unknown',
            requires_qsld_or_qsl: 'unknown',
            cites_export_control: 'unknown',
            requires_higher_level_quality: 'unknown',
          },
          quote: {
            taking_exception_to_item_description: 'unknown',
            exception_to_packaging: 'unknown',
            exception_to_fob_terms: 'unknown',
            exception_to_inspection: 'unknown',
            exception_to_required_quantity: 'unknown',
            quantity_variance_greater_than_specified: 'unknown',
            higher_level_quality_answered_none: f.higher_level_quality_answered_none,
            quotes_child_labor: 'unknown',
            remarks_present: f.quote_carries_remark,
            validity_period_days: f.validity_days === '' ? 'unknown' : Number(f.validity_days),
          },
          listing: {
            quoter_on_qsld_or_qsl: 'unknown',
            quoted_manufacturer_on_qpl_or_qml: f.quoted_manufacturer_listed
              ? true
              : f.item_cites_qpl_or_qml
                ? false
                : 'unknown',
            quoter_export_certification_current: 'unknown',
            manufacturer_export_certification_current: 'unknown',
          },
        })

  const blockers = preflightResult
    ? preflightResult.findings.filter((x) => x.severity === 'blocking').map((x) => x.statement)
    : []

  const path: 'c04' | 'l04' | 'unknown' =
    determination.path === 'c04_surplus_representation'
      ? 'c04'
      : determination.path === 'l04_part_numbered_traceability'
        ? 'l04'
        : 'unknown'

  /**
   * Assemble every deliverable for real, then let the assembly decide the state.
   *
   * The counter-offer memo will refuse here until a person has written and signed its basis, and that is
   * the correct behaviour rather than a gap: its narrative slot takes a signed human paragraph and there
   * is nowhere for a generated one to enter.
   */
  const deliverables: DeliverableRow[] = []
  const artifacts: { kind: DeliverableKind; label: string; view: ArtifactView }[] = []

  for (const kind of DELIVERABLE_ORDER) {
    const payloads = payloadsFor(kind, f, asOf)
    const missingRefs = REQUIRED_REFS[kind].filter((r) => payloads[r.ref] === undefined)
    const tpl = templateFor(kind, path)

    let assembly: ArtifactAssembly
    if (tpl === null) {
      assembly = { assembled: false, reason: 'no_template_in_this_build', refusals: [] }
    } else if (missingRefs.length > 0) {
      // Do not attempt a render that is certain to fail on a field the row already names.
      assembly = { assembled: false, reason: 'render_refused', refusals: [] }
    } else {
      try {
        const art = assemble(tpl, payloads, {})
        assembly = { assembled: true }
        artifacts.push({
          kind,
          label: DELIVERABLE_LABEL[kind],
          view: {
            ok: true,
            title: art.title,
            body: art.body,
            provenance: art.figure_provenance.map((x) => ({
              ref: x.ref,
              value: x.display,
              source: `operator entry, unsaved (${x.column})`,
            })),
          },
        })
      } catch (e) {
        if (!(e instanceof HardRenderFailure)) throw e
        const refusals = e.failures.map((x) => x.statement)
        assembly = { assembled: false, reason: 'render_refused', refusals }
        artifacts.push({
          kind,
          label: DELIVERABLE_LABEL[kind],
          view: {
            ok: false,
            refusals,
            explanation:
              'A federal document with a gap where a figure belongs is not a draft, it is an artifact ' +
              'that must not exist. Resolve the named failure and it renders.',
          },
        })
      }
    }

    const st = deliverableState({ kind, payloads, artifact: assembly, open_blockers: blockers })
    deliverables.push({
      kind,
      label: DELIVERABLE_LABEL[kind],
      state: st.state,
      state_label: STATE_LABEL[st.state],
      subtitle: f.nsn,
      statement: st.statement,
      next_action: st.next_action,
      missing: st.missing,
    })
  }

  const classification: ClassificationView = {
    path_label: PATH_LABEL_SHORT[determination.path] ?? 'Not classified',
    is_classified: determination.path !== 'unknown',
    category: determination.category,
    reasons: determination.reasons.map((r) => ({
      code: r.code,
      statement: r.statement,
      deciding_field: r.deciding_field,
    })),
    what_would_change_it: determination.what_would_change_it,
    rule_labels: determination.citations.map(labelOf),
    blocked_facts: determination.blocked_facts.map((b) => ({
      field: b.field,
      statement: b.statement,
      next_action: b.next_action,
    })),
    provenance_rung: determination.ladder.highest_rung,
    rung_gap: determination.ladder.gap_to_next_rung_up?.statement ?? null,
  }

  const preflight: PreflightView | null = preflightResult
    ? {
        verdict: preflightResult.verdict,
        verdict_label: VERDICT_LABEL[preflightResult.verdict],
        clear_statement: preflightResult.clear_statement,
        findings: preflightResult.findings.map((x) => ({
          check: x.check.replace(/_/g, ' '),
          severity: x.severity,
          statement: x.statement,
          failing_field: x.failing_field,
          quote: x.rule.quote,
          quote_attribution: labelOf(x.rule.citation),
          reroute: x.reroute,
        })),
      }
    : null

  return {
    captured: true,
    empty_state: null,
    deliverables,
    classification,
    preflight,
    artifacts,
    quarantined_rules: quarantined,
    counter_offer_memo_segment_count: memoSegments,
  }
}
