/**
 * HUNTER MODE. The outreach engine with a face.
 *
 * BUILD-DIRECTIVE surface 4. It is NOT a new engine: it is the 4.6 pursuit machinery surfaced
 * as a menu item, a dashboard control and the Sales Hub banner, with two buttons that commit
 * real effects. Everything below either delegates to machinery this lane already owns, or
 * refuses.
 *
 * ---------------------------------------------------------------------------------------
 * WHAT "FAIL-CLOSED" MEANS ON THIS SURFACE, CONCRETELY
 * ---------------------------------------------------------------------------------------
 * Every gate here refuses on UNCERTAINTY, not merely on a known-bad answer. A consent store
 * that cannot be read is treated exactly like a contact with no consent. A line-type lookup
 * that errors is treated exactly like a wireless number with no recorded basis. The reason is
 * that the alternative (proceed when the check is unavailable) converts an outage into an
 * outbound campaign, and the customer's name is on the From line.
 *
 * Every refusal emits telemetry with a named reason, and those refusals are COUNTED AND SHOWN.
 * "3 outreach withheld today: 2 quiet hours, 1 suppression" belongs on this surface exactly as
 * it belongs on the call surface. Restraint displayed as telemetry is the differentiator.
 */

import type { DealOwner } from './pipeline'

/** Server-read, never trusted from the client. A paused toggle is a control, not a style. */
export type HunterMode = 'active' | 'paused'

export type HunterState = {
  mode: HunterMode
  /** Who moved it. The autonomy dial is moved by a person and the product records which. */
  changedBy: 'DH' | 'DG'
  changedAt: number
  reason: string | null
}

/**
 * The consent basis enum. CLOSED, and `sourceArtifact` is a foreign key to the actual PO,
 * email or inbound call record, never free text (convai verdict N4).
 */
export type ConsentBasis =
  | 'existing_purchase_order'
  | 'inbound_enquiry_from_contact'
  | 'operator_entered_with_attestation'
  | 'imported_from_operator_records'

export type ConsentRecord = {
  contactId: string
  basis: ConsentBasis
  /** FK to the artifact. A record without one is not a consent record. */
  sourceArtifactId: string
  capturedAt: number
  revokedAt: number | null
}

export type LineType = 'landline' | 'wireless' | 'voip' | 'unknown'

/**
 * The reasons outbound is withheld. Each is COUNTED and SHOWN, never silently swallowed.
 */
export type WithheldReason =
  | 'no_consent_basis'
  | 'consent_revoked'
  | 'consent_store_unreadable'
  | 'suppressed'
  | 'suppression_store_unreadable'
  | 'do_not_contact'
  | 'quiet_hours'
  | 'unknown_timezone'
  | 'wireless_with_imported_basis_only'
  | 'line_type_unknown'
  | 'line_type_lookup_failed'
  | 'government_line'
  | 'hunter_paused'
  | 'no_configured_contact'
  | 'per_supplier_cap_reached'

export const WITHHELD_LABEL: Record<WithheldReason, string> = {
  no_consent_basis: 'no recorded lawful basis',
  consent_revoked: 'consent withdrawn',
  consent_store_unreadable: 'consent record could not be read',
  suppressed: 'suppression list',
  suppression_store_unreadable: 'suppression list could not be read',
  do_not_contact: 'do not contact flag',
  quiet_hours: 'quiet hours',
  unknown_timezone: 'timezone unknown',
  wireless_with_imported_basis_only:
    'mobile or VoIP number whose only basis is a bulk import',
  line_type_unknown: 'line type could not be determined',
  line_type_lookup_failed: 'line type lookup failed',
  government_line: 'government line, never dialed by design',
  hunter_paused: 'Hunter Mode paused',
  no_configured_contact: 'no configured contact',
  per_supplier_cap_reached: 'per-supplier contact cap',
}

export type Contact = {
  id: string
  orgId: string
  /** Null when the operator has not configured one. Never invented. */
  email: string | null
  phoneE164: string | null
  /** Set at import time. A government line is never AI-dialed, in either direction. */
  isGovernmentLine: boolean
  doNotContact: { flagged: boolean; reason: string | null; author: string | null }
  /** IANA zone of the callee. Unknown is treated as INSIDE quiet hours. */
  timezone: string | null
}

/**
 * Lookups the gate needs. Each returns a RESULT rather than throwing, so "the store was
 * unreadable" is a value the gate can branch on instead of an exception that might be caught
 * somewhere careless and turned into a default.
 */
export type GateLookups = {
  consent: (contactId: string) => { ok: true; record: ConsentRecord | null } | { ok: false }
  suppression: (contactId: string) => { ok: true; suppressed: boolean } | { ok: false }
  lineType: (phoneE164: string) => { ok: true; type: LineType } | { ok: false }
  /** Contacts touched across ALL channels and requests, for the per-supplier cap (J5.35). */
  contactsInWindow: (contactId: string) => number
  /** True when the callee's local time is inside permitted hours. */
  withinCallingHours: (timezone: string, at: number) => boolean
}

export type GateConfig = {
  /** Per-supplier contact cap across every channel and request. */
  perSupplierCap: number
}

export type GateDecision =
  | { allowed: true; consentBasis: ConsentBasis; lineType: LineType | null }
  | { allowed: false; reason: WithheldReason }

/**
 * THE OUTBOUND GATE. Deterministic, fail-closed, no model, no network of its own.
 *
 * Order matters and is chosen by cost and certainty: the cheapest checks that can settle the
 * case run first, so an obviously blocked contact never triggers a paid line-type lookup.
 */
export function evaluateOutboundGate(
  contact: Contact,
  channel: 'email' | 'voice',
  hunter: HunterState,
  lookups: GateLookups,
  config: GateConfig,
  at: number,
): GateDecision {
  if (hunter.mode === 'paused') return { allowed: false, reason: 'hunter_paused' }

  // A government line is never dialed and never AI-mailed, in either direction. This is the
  // never-list item enforced in the query layer, checked here as well because a control that
  // exists in exactly one place is a control with a single point of omission.
  if (contact.isGovernmentLine) return { allowed: false, reason: 'government_line' }

  if (contact.doNotContact.flagged) return { allowed: false, reason: 'do_not_contact' }

  const suppression = lookups.suppression(contact.id)
  if (!suppression.ok) return { allowed: false, reason: 'suppression_store_unreadable' }
  if (suppression.suppressed) return { allowed: false, reason: 'suppressed' }

  const consent = lookups.consent(contact.id)
  if (!consent.ok) return { allowed: false, reason: 'consent_store_unreadable' }
  if (consent.record === null) return { allowed: false, reason: 'no_consent_basis' }
  if (consent.record.revokedAt !== null) return { allowed: false, reason: 'consent_revoked' }

  if (lookups.contactsInWindow(contact.id) >= config.perSupplierCap) {
    return { allowed: false, reason: 'per_supplier_cap_reached' }
  }

  if (channel === 'email') {
    if (contact.email === null) return { allowed: false, reason: 'no_configured_contact' }
    return { allowed: true, consentBasis: consent.record.basis, lineType: null }
  }

  // Voice from here down.
  if (contact.phoneE164 === null) return { allowed: false, reason: 'no_configured_contact' }

  // Unknown timezone is treated as INSIDE quiet hours. Calling a supplier at 5am because we
  // did not know where they were is not a defensible outcome.
  if (contact.timezone === null) return { allowed: false, reason: 'unknown_timezone' }
  if (!lookups.withinCallingHours(contact.timezone, at)) {
    return { allowed: false, reason: 'quiet_hours' }
  }

  const line = lookups.lineType(contact.phoneE164)
  if (!line.ok) return { allowed: false, reason: 'line_type_lookup_failed' }

  /*
   * A LOOKUP THAT SUCCEEDS AND SAYS "unknown" IS THE SAME FACT AS A LOOKUP THAT FAILED.
   *
   * Found by T5's audit (cycle T5>T6), reproduced against this function: `!line.ok` catches a
   * lookup that ERRORS, and caught nothing when the lookup returned `type: 'unknown'`, which is
   * a first-class member of our own LineType union. Measured before the fix:
   *     lookup errors  -> refused, line_type_lookup_failed
   *     type 'unknown' -> ALLOWED, and the dialer dialed
   * Both states mean exactly one thing: we do not know whether this rings a mobile.
   *
   * The same call was already made correctly eight lines above, where an unknown timezone is
   * treated as inside quiet hours. This is that principle, applied where it was missing.
   *
   * VOIP IS DECIDED DELIBERATELY RATHER THAN LEFT TO FALL THROUGH. A VoIP number can terminate
   * on a mobile handset and the carrier lookup cannot tell us that it does not, so it is held
   * to the same standard as wireless. The cost of being wrong in this direction is a call
   * routed to a human; the cost in the other direction lands on the customer.
   */
  if (line.type === 'unknown') return { allowed: false, reason: 'line_type_unknown' }

  const needsStrongBasis = line.type === 'wireless' || line.type === 'voip'
  if (needsStrongBasis && consent.record.basis === 'imported_from_operator_records') {
    return { allowed: false, reason: 'wireless_with_imported_basis_only' }
  }

  return { allowed: true, consentBasis: consent.record.basis, lineType: line.type }
}

/**
 * START OUTREACH. Instantiates a real pursuit from an APPROVED TEMPLATE.
 *
 * The template's every slot is a deterministic database value. Model-drafted free prose goes
 * out only on a human-reviewed send, which is why this path takes a template id rather than
 * text: there is no parameter here through which prose can arrive.
 */
export type StartOutreachDeps = {
  gate: () => GateDecision
  /** Creates the bounded pursuit state machine. Owned by 4.6, called here. */
  createPursuit: (input: {
    dealId: string
    contactId: string
    templateId: string
    idempotencyKey: string
  }) => Promise<{ pursuitId: string }>
  /** Records the withheld event so the guardrail counter is real, not decorative. */
  recordWithheld: (reason: WithheldReason) => void
}

export type StartOutreachResult =
  | { started: true; pursuitId: string }
  | { started: false; reason: WithheldReason; operatorAction: string }

/**
 * What the operator is offered when outreach cannot start. Never an invented recipient.
 *
 * The platform never assembles a prospect list on its own. "No configured contact" therefore
 * offers a CONFIGURE action, not a suggestion of who to write to.
 */
const OPERATOR_ACTION: Record<WithheldReason, string> = {
  no_configured_contact: 'Configure a contact for this supplier.',
  no_consent_basis: 'Record a lawful basis for contacting this supplier.',
  consent_revoked: 'This contact withdrew consent. Choose a different contact.',
  consent_store_unreadable: 'The consent record could not be read. Nothing was sent. Retry, or report it.',
  suppressed: 'This contact is suppressed. Suppression is permanent and cross-channel.',
  suppression_store_unreadable: 'The suppression list could not be read. Nothing was sent. Retry, or report it.',
  do_not_contact: 'This contact carries a do-not-contact flag. Open the contact to see who set it and why.',
  quiet_hours: 'It is outside calling hours where this supplier is. This will run when hours open.',
  unknown_timezone: 'Set this contact timezone so calling hours can be honoured.',
  wireless_with_imported_basis_only:
    'This number is mobile or VoIP and its only recorded basis is a bulk import, which is the weakest basis we hold. Use the human call task, or record a stronger basis such as a purchase order.',
  line_type_unknown:
    'The carrier could not tell us whether this number is a mobile. Nothing was dialed. Use the human call task.',
  line_type_lookup_failed: 'The line type could not be checked. Nothing was dialed. Retry, or use the human call task.',
  government_line: 'Government lines are never dialed by design. Contact them yourself.',
  hunter_paused: 'Hunter Mode is paused. Switch it to Active to resume outreach.',
  per_supplier_cap_reached: 'This supplier has reached the contact cap for this window.',
}

export async function startOutreach(
  input: { dealId: string; contactId: string; templateId: string; niin: string | null; attemptWindowDate: string; orgId: string },
  deps: StartOutreachDeps,
): Promise<StartOutreachResult> {
  const decision = deps.gate()
  if (!decision.allowed) {
    deps.recordWithheld(decision.reason)
    return {
      started: false,
      reason: decision.reason,
      operatorAction: OPERATOR_ACTION[decision.reason],
    }
  }

  // The idempotency key is derived from BUSINESS IDENTITY, never a UUID minted at enqueue,
  // because the enqueue is the thing that gets retried. The date component is what makes the
  // autumn DST double-hour harmless: the same window resolves to the same key.
  const idempotencyKey = [
    'supplier_outreach', input.orgId, input.contactId, input.niin ?? 'no-niin', input.attemptWindowDate,
  ].join(':')

  const { pursuitId } = await deps.createPursuit({
    dealId: input.dealId,
    contactId: input.contactId,
    templateId: input.templateId,
    idempotencyKey,
  })
  return { started: true, pursuitId }
}

/**
 * SUBMIT QUOTE. Opens the human filing flow. It NEVER writes to a government system.
 *
 * This function deliberately returns a HANDOFF rather than performing anything. There is no
 * code path from here to a DIBBS write, and no parameter that could create one. S-AT.8 makes
 * "a rule submits a quote to the Government" a structural impossibility rather than a policy,
 * and a structural impossibility means the function to do it does not exist.
 *
 * The AI actor is refused before the readiness check, so a Hunter-owned deal cannot reach the
 * filing screen unattended even when everything else about it is ready.
 */
export type SubmitQuoteResult =
  | { outcome: 'human_confirm_required'; dealId: string; readiness: 'ready' | 'incomplete'; blockers: string[] }
  | { outcome: 'refused'; reason: 'ai_cannot_file' | 'no_packet'; explanation: string }

export function submitQuote(
  input: { dealId: string; owner: DealOwner; packetReadiness: 'none' | 'forming' | 'ready'; blockers: string[] },
  actor: { kind: 'human'; operator: 'DH' | 'DG' } | { kind: 'ai' },
): SubmitQuoteResult {
  if (actor.kind === 'ai') {
    return {
      outcome: 'refused', reason: 'ai_cannot_file',
      explanation: 'Filing a quote is reserved for a person. Hunter Mode assembles the packet and stops at the confirm screen.',
    }
  }
  if (input.packetReadiness === 'none') {
    return {
      outcome: 'refused', reason: 'no_packet',
      explanation: 'There is no packet for this requirement yet. The documents lane builds it before a quote can be filed.',
    }
  }
  return {
    outcome: 'human_confirm_required',
    dealId: input.dealId,
    readiness: input.packetReadiness === 'ready' ? 'ready' : 'incomplete',
    blockers: input.blockers,
  }
}

/**
 * THE BANNER COUNTERS. Every one is a verified terminal effect, never an attempt.
 *
 * The `sms.sent` false-success class is banned by spec: a send that was accepted by a provider
 * is not a message that arrived. So this type has no "sent" counter at all. A chase with zero
 * VERIFIED touches inside its SLA is a loud escalation, never a quiet green number.
 */
export type HunterCounters = {
  /** Pursuits in a non-terminal state right now. */
  sequencesRunning: number
  /** Human replies today. An out-of-office is not a reply and does not count. */
  repliesToday: number
  /** Calls that reached answer PLUS duration PLUS transcript. Nothing less counts. */
  connectedCallsToday: number
  /** Bookings joined to a created calendar event and a call_sid. */
  bookingsToday: number
  /** Withheld outbound, by reason. Shown as proudly as the connects. */
  withheldToday: Array<{ reason: WithheldReason; count: number }>
}

/** Render the guardrail line: "3 outreach withheld today: 2 quiet hours, 1 suppression". */
export function renderWithheldSummary(withheld: HunterCounters['withheldToday']): string | null {
  const total = withheld.reduce((n, w) => n + w.count, 0)
  if (total === 0) return null
  const parts = [...withheld]
    .filter((w) => w.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((w) => `${w.count} ${WITHHELD_LABEL[w.reason]}`)
  return `${total} outreach withheld today: ${parts.join(', ')}`
}
