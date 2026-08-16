/**
 * THE SALES HUB PIPELINE. A CRM lens over objects this lane already owns.
 *
 * BUILD-DIRECTIVE surface 3. Five ordered stages, cards that move between them, per-stage
 * counts and values, and owners.
 *
 * ---------------------------------------------------------------------------------------
 * THE ONE ARCHITECTURAL RULE, FROM 4.17: THIS IS A PROJECTION, NOT A SECOND PIPELINE
 * ---------------------------------------------------------------------------------------
 * A `Deal` JOINS an opportunity or solicitation, its pursuit, its readiness state and its
 * owner. It does not own any of them. The pursuit state machine decides whether a supplier is
 * responding; the deadline resolver decides when the clock fires; T5 decides whether a packet
 * is ready. The Sales Hub renders those facts in a shape a salesperson recognises.
 *
 * Building it the other way round (a CRM with its own stage truth, synced from the engine) is
 * the standard mistake and it produces two answers to "what is happening with this deal", which
 * is worse than having none.
 *
 * ---------------------------------------------------------------------------------------
 * EVERY NUMBER HERE IS COMPUTED, NEVER WRITTEN
 * ---------------------------------------------------------------------------------------
 * Per-stage counts and sums come from the deals passed in. A value that is not known is `null`
 * and renders as an honest "insufficient data", never as zero and never as an estimate wearing
 * a measurement's clothes. Zero and unknown are different facts and the difference is money.
 */

/** The five stages, in order. The order is the pipeline. */
export const PIPELINE_STAGES = [
  'opportunities',
  'leads',
  'quoting',
  'customers',
  'won_revenue',
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export const STAGE_LABEL: Record<PipelineStage, string> = {
  opportunities: 'Opportunities',
  leads: 'Leads',
  quoting: 'Quoting',
  customers: 'Customers',
  won_revenue: 'Won & Revenue',
}

/**
 * Deal owners. Two named operators and the machine.
 *
 * `AI` is not cosmetic. An AI-owned deal's outbound is bound by the autonomy ramp, the STOP ALL
 * CALLS control and the per-operator kill switch exactly as the voice rung is. When Hunter is
 * paused, an AI-owned deal holds with a next action and advances nothing.
 */
export type DealOwner = 'DH' | 'DG' | 'AI'

export const OWNER_LABEL: Record<DealOwner, string> = {
  DH: 'David Hitchman',
  DG: 'David Goodreau',
  AI: 'Hunter Mode',
}

/** How a value came to be known. Rendered as a provenance glyph, never as a bare number. */
export type ValueBasis = 'measured' | 'modelled' | 'insufficient'

export type Deal = {
  id: string
  orgId: string
  stage: PipelineStage
  owner: DealOwner
  /** What the deal is about. Identifiers are stored, never composed for display by a model. */
  subject: {
    kind: 'solicitation' | 'opportunity'
    /** Solicitation number or internal opportunity reference. */
    ref: string
    /** NIIN-keyed, never the full NSN, per the Zone B rule. Null when not yet resolved. */
    niin: string | null
    title: string
  }
  /** The 4.6 pursuit behind this card, when one has been started. */
  pursuitId: string | null
  /**
   * Modeled lift in whole cents. NULL means we do not know, which is a shippable answer.
   * Cents rather than a float because money in a float is a defect waiting for a decimal.
   */
  modeledValueCents: number | null
  valueBasis: ValueBasis
  /** What happens next. An open deal with no next action is a bug, asserted below. */
  nextAction: string | null
  updatedAt: number
}

/** Evidence a transition is permitted to rely on. Absent evidence blocks, never assumes. */
export type TransitionEvidence = {
  /** A 4.6 pursuit exists and is in a non-terminal state. */
  hasActivePursuit?: boolean
  /** T5 says a packet is forming or ready. This lane never decides this itself. */
  packetReadiness?: 'none' | 'forming' | 'ready'
  /** A terminal pursuit outcome that counts as material secured. */
  terminalOutcome?: 'material_confirmed' | 'documents_received' | null
  /** A joined award record. Required before anything reaches Won & Revenue. */
  awardRecordId?: string | null
}

export type TransitionActor =
  | { kind: 'human'; operator: 'DH' | 'DG' }
  | { kind: 'ai'; pursuitId: string; stepId: string }

export type TransitionRefusal = {
  allowed: false
  /** A machine-readable code for the guard feed. */
  code:
    | 'UNKNOWN_STAGE'
    | 'NO_ACTIVE_PURSUIT'
    | 'NO_PACKET'
    | 'NO_TERMINAL_OUTCOME'
    | 'NO_AWARD_RECORD'
    | 'AI_CANNOT_FILE'
    | 'SAME_STAGE'
  /** One sentence an operator can act on, with no jargon. */
  explanation: string
}

export type TransitionApproval = { allowed: true }

export type TransitionVerdict = TransitionRefusal | TransitionApproval

/**
 * Can this deal move to this stage, given this evidence and this actor?
 *
 * Deliberately permissive about DIRECTION and strict about EVIDENCE. A deal can go backwards:
 * a supplier who confirmed material and then stopped answering is genuinely back at Leads, and
 * a CRM that only moves forward lies about the state of the business. What it cannot do is
 * arrive somewhere without the fact that stage asserts.
 */
export function canTransition(
  deal: Deal,
  to: PipelineStage,
  actor: TransitionActor,
  evidence: TransitionEvidence = {},
): TransitionVerdict {
  if (!PIPELINE_STAGES.includes(to)) {
    return { allowed: false, code: 'UNKNOWN_STAGE', explanation: `"${to}" is not a pipeline stage.` }
  }
  if (deal.stage === to) {
    return {
      allowed: false, code: 'SAME_STAGE',
      explanation: `This deal is already in ${STAGE_LABEL[to]}.`,
    }
  }

  if (to === 'leads' && evidence.hasActivePursuit !== true) {
    return {
      allowed: false, code: 'NO_ACTIVE_PURSUIT',
      explanation: 'A deal reaches Leads when a supplier pursuit is actually running. Start outreach first.',
    }
  }

  if (to === 'quoting') {
    if (evidence.packetReadiness !== 'forming' && evidence.packetReadiness !== 'ready') {
      return {
        allowed: false, code: 'NO_PACKET',
        explanation: 'A deal reaches Quoting when a packet is forming. The documents lane reports that state; it is not set here.',
      }
    }
  }

  if (to === 'won_revenue') {
    // THE STRUCTURAL IMPOSSIBILITY, S-AT.8. No automated path files with the Government, so no
    // automated path can declare a win either. An award is evidence, never an inference.
    if (actor.kind === 'ai') {
      return {
        allowed: false, code: 'AI_CANNOT_FILE',
        explanation: 'Hunter Mode cannot move a deal into Won & Revenue. A win is recorded by a person against a real award record.',
      }
    }
    if (!evidence.terminalOutcome) {
      return {
        allowed: false, code: 'NO_TERMINAL_OUTCOME',
        explanation: 'Won & Revenue needs a confirmed terminal outcome on the pursuit, either material confirmed or documents received.',
      }
    }
    if (!evidence.awardRecordId) {
      return {
        allowed: false, code: 'NO_AWARD_RECORD',
        explanation: 'Won & Revenue needs a joined award record, so every figure on this card traces to its arithmetic.',
      }
    }
  }

  return { allowed: true }
}

/**
 * The audit writer this module requires. Supplied by the caller, never constructed here.
 *
 * T1 owns the `audit_event` table, T7 owns `lib/audit`. This lane is a CALLER. Taking the
 * writer as a parameter is what makes the fail-closed property below testable without a
 * database, and what stops this file from growing its own audit path.
 */
export type StageAuditWriter = (event: {
  dealId: string
  orgId: string
  from: PipelineStage
  to: PipelineStage
  actor: TransitionActor
  reason: string
  at: number
}) => Promise<void>

export class StageChangeRefused extends Error {
  readonly verdict: TransitionRefusal
  constructor(verdict: TransitionRefusal) {
    super(`Stage change refused: ${verdict.code}`)
    this.name = 'StageChangeRefused'
    this.verdict = verdict
  }
}

export class StageAuditFailed extends Error {
  constructor(cause: unknown) {
    super(`Stage change abandoned because the audit write failed: ${String(cause)}`)
    this.name = 'StageAuditFailed'
  }
}

/**
 * Move a deal, writing the audit row FIRST.
 *
 * 4.17.4: the audit row is written in the same transaction as the stage change, and IF THE
 * AUDIT WRITE FAILS THE STAGE DOES NOT MOVE. Ordering is the whole control: a system that moves
 * the card and then records it produces a deal whose history has a hole exactly where somebody
 * will later ask "why did this move".
 *
 * The returned deal is a NEW object. Mutating in place would leave a moved card behind if the
 * audit throws, which is the failure this function exists to prevent.
 */
export async function applyStageChange(
  deal: Deal,
  to: PipelineStage,
  actor: TransitionActor,
  reason: string,
  audit: StageAuditWriter,
  now: number,
  evidence: TransitionEvidence = {},
): Promise<Deal> {
  const verdict = canTransition(deal, to, actor, evidence)
  if (!verdict.allowed) throw new StageChangeRefused(verdict)

  try {
    await audit({
      dealId: deal.id, orgId: deal.orgId, from: deal.stage, to, actor, reason, at: now,
    })
  } catch (cause) {
    throw new StageAuditFailed(cause)
  }

  return { ...deal, stage: to, updatedAt: now }
}

export type StageMetrics = {
  stage: PipelineStage
  label: string
  count: number
  /** Sum of KNOWN values only. */
  valueCents: number
  /**
   * How many deals in this stage have no known value. Rendered beside the sum, because a
   * total that silently omits eight unknown deals is a number that lies by omission.
   */
  unknownValueCount: number
}

/**
 * Per-stage counts and sums, computed from the rows themselves.
 *
 * Returns every stage, including empty ones, so the board renders five columns on day one with
 * honest zeros rather than collapsing to whatever happens to have data.
 */
export function computeStageMetrics(deals: Deal[]): StageMetrics[] {
  return PIPELINE_STAGES.map((stage) => {
    const inStage = deals.filter((d) => d.stage === stage)
    let valueCents = 0
    let unknownValueCount = 0
    for (const d of inStage) {
      if (d.modeledValueCents === null || d.valueBasis === 'insufficient') unknownValueCount += 1
      else valueCents += d.modeledValueCents
    }
    return { stage, label: STAGE_LABEL[stage], count: inStage.length, valueCents, unknownValueCount }
  })
}

/** An open deal with no next action is a bug. This is the assertion that says so. */
export function dealsMissingNextAction(deals: Deal[]): Deal[] {
  return deals.filter((d) => d.stage !== 'won_revenue' && (d.nextAction === null || d.nextAction.trim() === ''))
}

/**
 * Reference equality for the Pursue dedupe: uppercase, punctuation and spacing stripped, so
 * the same stock number written "5325-01-705-3574" and "5325017053574" is one reference.
 * Empty normalizes to empty and MUST NEVER match anything: a deal with no reference is not
 * "the same deal" as every other deal with no reference.
 *
 * Lives here rather than in the deals store because it is pure and both sides need it: the
 * server dedupes creates with it, and the client surfaces use it to mark rows already in
 * the pipeline (the store imports node:fs and cannot be pulled into a client bundle).
 */
export function normalizeDealRef(ref: string): string {
  return ref.replace(/[^0-9a-zA-Z]/g, '').toUpperCase()
}

/**
 * The honest first next-action for a pursued opportunity. One sentence, no promise the
 * system cannot keep, and it names the VENUE: a new deal card that says "source the
 * article" without saying where is a task with no door. The approved-source list is on the
 * corner dossier; the contactable book is /suppliers.
 */
export const PURSUE_NEXT_ACTION =
  'Find who holds the approved article (approved sources, then the Suppliers book), draft the buy-side email, and document traceability'

/**
 * THE STAGE-SEEDED NEXT ACTIONS. Deterministic, written here, never generated.
 *
 * Each stage seeds an honest suggestion the moment a deal arrives with no next action of
 * its own. Two rules, both load-bearing:
 *
 *   1. NEVER OVERWRITE AN OPERATOR'S OWN TEXT. A seed replaces nothing except another seed
 *      (or an empty field). `isSeededNextAction` is how the server tells the difference.
 *   2. NO PROMISE THE SYSTEM CANNOT KEEP. The Quoting seed says where quotes are actually
 *      filed (DIBBS, the government's own site) because this product prepares the case and
 *      never submits it.
 */
export const STAGE_NEXT_ACTION: Record<PipelineStage, string> = {
  opportunities: PURSUE_NEXT_ACTION,
  leads:
    'Work the supplier: confirm they still hold the article, what condition it is in, and what they want for it',
  quoting:
    'Build the quote case in Documents, then file it on DIBBS yourself; the government site is where quotes are filed',
  customers:
    'Deliver against the order and keep the traceability packet with the shipment',
  won_revenue: 'Collect payment and keep the award reference with this record',
}

/** True when this text is one of the seeds (any stage), so replacing it loses nothing an operator wrote. */
export function isSeededNextAction(text: string | null): boolean {
  if (text === null) return true
  const t = text.trim()
  if (t === '') return true
  return Object.values(STAGE_NEXT_ACTION).includes(t) || t === PURSUE_NEXT_ACTION
}
