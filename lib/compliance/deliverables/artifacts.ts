/**
 * THE FOUR DELIVERABLES OF THE DOCUMENTS AND POs SURFACE, and the state each one is actually in.
 *
 * The approved mockup shows four artifact rows and three state tags: ready to submit, draft awaiting
 * approval, and generate from blueprint. This module owns which state an artifact is in, and the whole
 * design rule is that THE STATE IS COMPUTED, NEVER ASSERTED. A checkbox an operator can tick to declare
 * a packet ready is a defect rather than a convenience, because the defect that kills awards does not
 * look like a bug: it looks like a clean interface showing "Ready to submit" over an incomplete packet.
 *
 * So `deliverableState()` resolves a requirement set against an evidence set and returns the state plus
 * the named missing artifacts. There is no setter.
 *
 * The mockup's sample rows (a Moog manifold quote packet, an OLY Aero purchase order) are illustrative
 * domain examples and never ship as live data. Nothing in this module carries them.
 */

import { RULES, quotationOf, type RuleCitation } from '../citations'
import type { Payloads, Template } from './assembler'

/**
 * Read a citation's plain-language argument, or say honestly that none is recorded.
 *
 * `argument` is optional on RuleCitation and genuinely absent on several rules, so this returns a
 * sentence rather than an empty string. An empty string would render as a dangling "described rather
 * than quoted:" with nothing after the colon, which reads as a bug and tells the operator nothing. The
 * not-fabricated rule applies to an absent field the same way it applies to an absent number.
 */
function argumentOrHonestAbsence(c: RuleCitation): string {
  if (typeof c.argument === 'string' && c.argument.trim() !== '') return c.argument
  return (
    `No plain-language summary of ${c.authority} ${c.identifier} is recorded in this build, so none is ` +
    'shown. Read the rule at its citation.'
  )
}

export type DeliverableKind =
  | 'quote_packet'
  | 'purchase_order'
  | 'traceability_packet'
  | 'counter_offer_memo'

/** The mockup's three tags, spelled once. */
export type DeliverableState = 'ready_to_submit' | 'draft_awaiting_approval' | 'generate_from_blueprint'

export const DELIVERABLE_LABEL: Readonly<Record<DeliverableKind, string>> = {
  quote_packet: 'Quote packet',
  purchase_order: 'Purchase order',
  traceability_packet: 'Traceability packet',
  counter_offer_memo: 'Counter-offer memo',
}

export const STATE_LABEL: Readonly<Record<DeliverableState, string>> = {
  ready_to_submit: 'Ready to submit',
  draft_awaiting_approval: 'Draft, awaiting approval',
  generate_from_blueprint: 'Generate from blueprint',
}

/**
 * What each deliverable must have before it can be called ready. Named refs, so a missing one is a
 * sentence an operator can act on rather than a percentage.
 */
export const REQUIRED_REFS: Readonly<Record<DeliverableKind, readonly { ref: string; label: string }[]>> = {
  quote_packet: [
    { ref: 'f1', label: 'the solicitation number' },
    { ref: 'f2', label: 'the national stock number' },
    { ref: 'f3', label: 'the quoted unit price' },
    { ref: 'f4', label: 'the quoted quantity' },
    { ref: 'f5', label: 'the quote validity period in days' },
  ],
  purchase_order: [
    { ref: 'f1', label: 'the supplier name' },
    { ref: 'f2', label: 'the national stock number' },
    { ref: 'f3', label: 'the unit price' },
    { ref: 'f4', label: 'the quantity' },
    { ref: 'f5', label: 'the extended total' },
  ],
  traceability_packet: [
    { ref: 'f1', label: 'the national stock number' },
    { ref: 'f2', label: 'the approved manufacturing source CAGE code' },
    { ref: 'f3', label: 'the part number' },
    { ref: 'f4', label: 'the quantity the evidence covers' },
  ],
  counter_offer_memo: [
    { ref: 'f1', label: 'the national stock number' },
    { ref: 'f2', label: 'the price being countered' },
    { ref: 'f3', label: 'our counter figure' },
  ],
}

/** Deliverables that cannot be submitted until a person approves them, regardless of completeness. */
export const REQUIRES_HUMAN_APPROVAL: Readonly<Record<DeliverableKind, boolean>> = {
  quote_packet: false,
  // A purchase order commits money. It renders as a draft and waits for a person, always.
  purchase_order: true,
  traceability_packet: false,
  // A counter-offer memo carries a signed narrative, so a person is already in the loop by construction.
  counter_offer_memo: true,
}

/**
 * Whether an artifact actually exists.
 *
 * THIS INPUT IS THE FIX FOR A REAL DEFECT THIS LANE SHIPPED. The first version of this module computed
 * state from field presence alone, so a quote packet whose five fields were filled reported "ready to
 * submit" while no artifact had been assembled at all, and only one of the four kinds even had a
 * template. A ready-to-submit chip on a packet that does not exist is the worst version of the
 * fabricated-state defect, because the thing being fabricated is a compliance status.
 *
 * So readiness now requires an assembly that succeeded. Field presence is necessary and not sufficient.
 */
export type ArtifactAssembly =
  | { readonly assembled: true }
  | {
      readonly assembled: false
      readonly reason: 'no_template_in_this_build' | 'render_refused'
      readonly refusals: readonly string[]
    }

export type DeliverableEvidence = {
  readonly kind: DeliverableKind
  readonly payloads: Payloads
  readonly artifact: ArtifactAssembly
  /** True only when a named person has approved. Never defaulted to true. */
  readonly approved_by?: string
  readonly approved_at?: string
  /**
   * Open compliance blockers from the readiness verdict or the pre-flight. A deliverable is never ready
   * while one is open, because a beautifully rendered packet over a blocked candidate is the exact
   * failure this lane exists to prevent.
   */
  readonly open_blockers: readonly string[]
}

export type DeliverableStatus = {
  readonly kind: DeliverableKind
  readonly state: DeliverableState
  readonly missing: readonly { readonly ref: string; readonly label: string }[]
  /** Operator-facing single line for the row, naming the object and the next action. */
  readonly statement: string
  readonly next_action: string
}

/**
 * Compute the state. Pure, and the only source of a state value.
 *
 * Order is deliberate: missing fields first (nothing to render), then open blockers (renders but must
 * not go), then approval (complete and clean but a person has not said yes).
 */
export function deliverableState(ev: DeliverableEvidence): DeliverableStatus {
  const required = REQUIRED_REFS[ev.kind]
  const missing = required.filter((r) => ev.payloads[r.ref] === undefined)
  const label = DELIVERABLE_LABEL[ev.kind]

  if (missing.length > 0) {
    return {
      kind: ev.kind,
      state: 'generate_from_blueprint',
      missing,
      statement:
        `${label} cannot be built yet. Missing ${missing.map((m) => m.label).join(', ')}.`,
      next_action:
        missing.length === 1
          ? `Capture ${missing[0]?.label} and this deliverable builds itself.`
          : `Capture the ${missing.length} missing fields and this deliverable builds itself.`,
    }
  }

  // No artifact exists. Field presence is not an artifact, so this is never "ready".
  if (!ev.artifact.assembled) {
    return {
      kind: ev.kind,
      state: 'generate_from_blueprint',
      missing: [],
      statement:
        ev.artifact.reason === 'no_template_in_this_build'
          ? `${label} has every field it needs, and this build has no template to render it with, so no ` +
            'artifact exists yet. It is not ready to submit, and saying otherwise would be a compliance ' +
            'status we invented.'
          : `${label} has every field it needs and the render was refused: ` +
            `${ev.artifact.refusals.join(' ')}`,
      next_action:
        ev.artifact.reason === 'no_template_in_this_build'
          ? 'The template for this deliverable is still to be built in this lane.'
          : 'Resolve the named render failure, then this assembles.',
    }
  }

  if (ev.open_blockers.length > 0) {
    return {
      kind: ev.kind,
      state: 'draft_awaiting_approval',
      missing: [],
      statement:
        `${label} renders, and it must not be submitted while ${ev.open_blockers.length} compliance ` +
        `blocker(s) are open: ${ev.open_blockers.join('; ')}.`,
      next_action: 'Clear the named blockers, then this becomes ready to submit.',
    }
  }

  if (REQUIRES_HUMAN_APPROVAL[ev.kind] && (ev.approved_by === undefined || ev.approved_at === undefined)) {
    return {
      kind: ev.kind,
      state: 'draft_awaiting_approval',
      missing: [],
      statement: `${label} is complete and waiting for a person to approve it.`,
      next_action:
        ev.kind === 'purchase_order'
          ? 'Review the figures against the source documents, then approve. This commits money.'
          : 'Review and sign the narrative, then approve.',
    }
  }

  return {
    kind: ev.kind,
    state: 'ready_to_submit',
    missing: [],
    statement: `${label} is complete, every figure traces to a stored column, and nothing is blocking it.`,
    next_action: 'Submit it, and the transmission is logged with the exact bytes that went out.',
  }
}

// ---------------------------------------------------------------------------------------------------
// TEMPLATES
// ---------------------------------------------------------------------------------------------------

/**
 * The traceability packet cover index.
 *
 * Note what the fixed text does and does not do. It states the rule the packet answers and quotes it
 * only where provenance permits, and it declares every numeral it contains (the DLAD pin, the day
 * counts) so the post-generation extractor can tell a citation from a figure. Every actual value is a
 * payload reference.
 */
export function traceabilityPacketTemplate(path: 'c04' | 'l04'): Template {
  // Annotated to the declared interface, not cast: the two literal members differ in which optional
  // fields they carry, and the template only ever reads them through the interface.
  const clockRule: RuleCitation = path === 'c04' ? RULES.c04_24_hour_clock : RULES.l04_traceability_2_day
  const q = quotationOf(clockRule)

  const heading =
    path === 'c04'
      ? 'TRACEABILITY PACKET, C04 SURPLUS REPRESENTATION PATH (DLAD 11.390)\n\n'
      : 'TRACEABILITY PACKET, L04 PART-NUMBERED TRACEABILITY PATH (DLAD 11.391)\n\n'

  const consequence = q.ok
    ? `Consequence of a late or incomplete response, quoted from ${clockRule.authority} ` +
      `${clockRule.identifier}: "${q.quote}"\n\n`
    : `Consequence of a late or incomplete response, per ${clockRule.authority} ` +
      `${clockRule.identifier}. The exact clause wording is not yet verified in the primary source, so ` +
      `it is described rather than quoted. ${argumentOrHonestAbsence(clockRule)}\n\n`

  return {
    id: `traceability_packet_${path}`,
    title: `Traceability packet, ${path.toUpperCase()} path`,
    segments: [
      {
        // '04' is a real token inside the note letters C04 and L04, and the check is right to demand it
        // be declared. Declaring the tokens explicitly keeps the check meaningful: auto-declaring a
        // segment from its own text would let a figure smuggle itself in as boilerplate.
        kind: 'fixed',
        text: heading,
        numerals_declared: path === 'c04' ? ['04', '11.390'] : ['04', '11.391'],
      },
      { kind: 'fixed', text: 'National stock number: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f1', label: 'the national stock number' },
      { kind: 'fixed', text: '\nApproved manufacturing source CAGE code: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f2', label: 'the approved manufacturing source CAGE code' },
      { kind: 'fixed', text: '\nPart number: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f3', label: 'the part number' },
      { kind: 'fixed', text: '\nQuantity this evidence covers: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f4', label: 'the quantity the evidence covers' },
      { kind: 'fixed', text: '\n\n', numerals_declared: [] },
      {
        // Declared from the CITATION's own fields, not from the composed sentence. The only numerals
        // permitted here are those in the rule's identifier and in its verified primary text, so a
        // figure cannot enter this segment by being interpolated into it.
        kind: 'fixed',
        text: consequence,
        numerals_declared: [
          ...numeralsOf(clockRule.identifier),
          ...numeralsOf(q.ok ? q.quote : argumentOrHonestAbsence(clockRule)),
        ],
      },
      {
        kind: 'fixed',
        text:
          'This documentation is proprietary and is stamped accordingly, as the same rule requires of ' +
          'the Government. It is provided unredacted: prices, dates and all other information are ' +
          'present, because redacted traceability documentation is rejected.\n',
        numerals_declared: [],
      },
    ],
  }
}

/**
 * The counter-offer memo. The one deliverable with a narrative slot, and the slot takes a signed human
 * narrative rather than any generated string.
 */
export function counterOfferMemoTemplate(): Template {
  return {
    id: 'counter_offer_memo',
    title: 'Counter-offer memo',
    segments: [
      { kind: 'fixed', text: 'COUNTER-OFFER MEMORANDUM\n\nNational stock number: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f1', label: 'the national stock number' },
      { kind: 'fixed', text: '\nPrice being countered: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f2', label: 'the price being countered' },
      { kind: 'fixed', text: '\nOur counter: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f3', label: 'our counter figure' },
      { kind: 'fixed', text: '\n\nBasis, written and signed:\n', numerals_declared: [] },
      { kind: 'narrative', ref: 'n1', label: 'the signed basis for the counter' },
    ],
  }
}

/** Helper so a template's declared numerals cannot drift from its own text. */
function numeralsOf(s: string): readonly string[] {
  return s.match(/\d[\d.,\-/:%$]*\d|\d/g) ?? []
}

/**
 * The quote packet cover sheet.
 *
 * Deliberately spare. This is the index that travels with an offer, so every line on it is either fixed
 * boilerplate or a resolved reference. There is no summary, no rationale and no "prepared by" prose,
 * because prose on this document is exactly what a machine must never contribute.
 */
export function quotePacketTemplate(): Template {
  return {
    id: 'quote_packet',
    title: 'Quote packet',
    segments: [
      { kind: 'fixed', text: 'QUOTE PACKET\n\nSolicitation: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f1', label: 'the solicitation number' },
      { kind: 'fixed', text: '\nNational stock number: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f2', label: 'the national stock number' },
      { kind: 'fixed', text: '\nUnit price quoted: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f3', label: 'the quoted unit price' },
      { kind: 'fixed', text: '\nQuantity quoted: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f4', label: 'the quoted quantity' },
      { kind: 'fixed', text: '\nQuote validity, days: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f5', label: 'the quote validity period in days' },
      {
        kind: 'fixed',
        text:
          '\n\nEnclosures are listed in the traceability packet accompanying this quote. Every figure ' +
          'above is a stored value, and each one is listed with its source in the generating record.\n',
        numerals_declared: [],
      },
    ],
  }
}

/**
 * The purchase order.
 *
 * This one commits money, which is why it always renders as a draft and waits for a named person. The
 * extended total is a payload, computed by deterministic code before it reaches the template, never
 * multiplied inside the document.
 */
export function purchaseOrderTemplate(): Template {
  return {
    id: 'purchase_order',
    title: 'Purchase order',
    segments: [
      { kind: 'fixed', text: 'PURCHASE ORDER\n\nSupplier: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f1', label: 'the supplier name' },
      { kind: 'fixed', text: '\nNational stock number: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f2', label: 'the national stock number' },
      { kind: 'fixed', text: '\nUnit price: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f3', label: 'the unit price' },
      { kind: 'fixed', text: '\nQuantity: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f4', label: 'the quantity' },
      { kind: 'fixed', text: '\nExtended total: ', numerals_declared: [] },
      { kind: 'payload', ref: 'f5', label: 'the extended total' },
      {
        kind: 'fixed',
        text:
          '\n\nThis order is not placed until a named person approves it. Ask the supplier for the ' +
          'label photograph, the unredacted invoice or packing slip with its number, and the bill of ' +
          'sale, before the material ships and before the packaging is discarded.\n',
        numerals_declared: [],
      },
    ],
  }
}

/**
 * The template for a kind, or null when this build has none.
 *
 * Null is a real and honest answer, and the caller must treat it as one: a deliverable with no template
 * cannot be ready to submit, because there is no artifact. Returning a stub template here so every kind
 * "works" would be the fabrication this whole module exists to prevent.
 */
export function templateFor(
  kind: DeliverableKind,
  path: 'c04' | 'l04' | 'unknown',
): Template | null {
  switch (kind) {
    case 'quote_packet':
      return quotePacketTemplate()
    case 'purchase_order':
      return purchaseOrderTemplate()
    case 'traceability_packet':
      return path === 'unknown' ? null : traceabilityPacketTemplate(path)
    case 'counter_offer_memo':
      return counterOfferMemoTemplate()
  }
}
