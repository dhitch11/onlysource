import { NextRequest } from 'next/server'
import { gateOrJson } from '@/lib/session/require-gate'
import {
  findDealByRef,
  readDeals,
  upsertDeal,
  removeDeal,
  toDeal,
  OWNERS,
  type StoredDeal,
} from '@/lib/sales/deals-store'
import {
  PIPELINE_STAGES,
  STAGE_LABEL,
  STAGE_NEXT_ACTION,
  applyStageChange,
  isSeededNextAction,
  normalizeDealRef,
  StageAuditFailed,
  StageChangeRefused,
  type DealOwner,
  type PipelineStage,
  type TransitionEvidence,
} from '@/lib/sales/pipeline'
import { dealStageAuditWriter } from '@/lib/sales/deal-audit'
import { readPackets } from '@/lib/compliance/packets-store'
import { systemClock } from '@/lib/time/clock'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** List the pipeline. Gated. */
export async function GET() {
  const denied = await gateOrJson()
  if (denied) return denied
  return Response.json({ deals: readDeals() })
}

/*
 * THE STAGE GUARD, WIRED. lib/sales/pipeline.ts defines canTransition/applyStageChange and,
 * until 2026-08-16, nothing outside its own tests called them: an AI-owned deal could be
 * POSTed straight into Won & Revenue at any figure with no evidence and no audit row. This
 * handler is now the caller, so the guarantees those functions document are the guarantees
 * this API actually gives:
 *
 *   - every stage CHANGE goes through canTransition with evidence computed SERVER-SIDE:
 *       leads    <- the operator's explicit attestation that a supplier pursuit is running
 *                   (`attest: 'outreach_running'`). No pursuit engine runs yet, so the
 *                   attestation IS the available evidence; it is recorded as an attestation
 *                   in the audit trail, never dressed as a measurement.
 *       quoting  <- a saved packet in Documents whose NSN matches this deal's ref. The
 *                   documents lane reports that state; this handler only reads it.
 *       won      <- a human-entered actual amount, an award/PO reference, and the stated
 *                   basis (material confirmed or documents received). An AI-owned deal is
 *                   refused outright: reassign it to the person who closed it first, so the
 *                   record names who filed.
 *   - the audit row is written BEFORE the stage moves, and if the audit write fails the
 *     stage does not move (applyStageChange, 4.17.4).
 *   - unknown stage or owner values are refused with 400, never silently coerced to a
 *     different valid value.
 *   - the recorded close (wonValueUsd / wonRef) is writable ONLY by the move into Won.
 *     Leaving Won clears it and says so. The generic update path cannot touch it.
 */

type PostBody = Partial<StoredDeal> & {
  attest?: unknown
  wonBasis?: unknown
}

const WON_BASES = ['material_confirmed', 'documents_received'] as const
type WonBasis = (typeof WON_BASES)[number]

/** Does a saved Documents packet exist for this deal's reference? */
function packetReadinessFor(ref: string): 'none' | 'forming' {
  const wanted = normalizeDealRef(ref)
  if (!wanted) return 'none'
  return readPackets().some((p) => normalizeDealRef(p.nsn) === wanted) ? 'forming' : 'none'
}

/** The mutable fields a client may write directly. Everything else moves through the flows above. */
function directPatch(body: PostBody): Partial<StoredDeal> {
  const patch: Partial<StoredDeal> = {}
  if (typeof body.title === 'string') patch.title = body.title
  if (typeof body.ref === 'string') patch.ref = body.ref
  if (typeof body.niin === 'string' || body.niin === null) patch.niin = body.niin ?? null
  if (typeof body.valueUsd === 'number' || body.valueUsd === null) patch.valueUsd = body.valueUsd ?? null
  if (typeof body.owner === 'string') patch.owner = body.owner as DealOwner
  if (typeof body.nextAction === 'string' || body.nextAction === null) patch.nextAction = body.nextAction ?? null
  return patch
}

/** Create or update a deal. Gated. A new deal without an id gets one. */
export async function POST(req: NextRequest) {
  const denied = await gateOrJson()
  if (denied) return denied
  let body: PostBody
  try {
    body = (await req.json()) as PostBody
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }

  // ---- enum validation: a wrong value is refused, never silently mapped to a default ----
  if (body.stage !== undefined && !(PIPELINE_STAGES as readonly string[]).includes(body.stage as string)) {
    return Response.json(
      { error: 'bad_stage', message: `"${String(body.stage)}" is not a pipeline stage.` },
      { status: 400 },
    )
  }
  if (body.owner !== undefined && !(OWNERS as readonly string[]).includes(body.owner as string)) {
    return Response.json(
      { error: 'bad_owner', message: `"${String(body.owner)}" is not a deal owner.` },
      { status: 400 },
    )
  }
  if (body.attest !== undefined && body.attest !== 'outreach_running') {
    return Response.json(
      { error: 'bad_attest', message: 'The only recognised attestation is "outreach_running".' },
      { status: 400 },
    )
  }
  if (body.wonBasis !== undefined && !(WON_BASES as readonly string[]).includes(body.wonBasis as string)) {
    return Response.json(
      { error: 'bad_won_basis', message: 'The close basis is either material_confirmed or documents_received.' },
      { status: 400 },
    )
  }

  const isNew = !(typeof body.id === 'string' && body.id)

  if (isNew) {
    // A brand-new deal needs at least a title; refuse a contentless create rather than store an
    // "(untitled)" placeholder.
    if (!((body.title ?? '').trim())) {
      return Response.json({ error: 'empty_deal', message: 'A deal needs a title.' }, { status: 400 })
    }
    /*
     * A deal is never BORN won. Won & Revenue carries recorded money, and the recorded close
     * is entered on the move into Won so it always has an amount, a reference and an audit
     * row behind it. Create the deal at Customers and move it, and the close form appears.
     */
    if (body.stage === 'won_revenue') {
      return Response.json(
        {
          error: 'cannot_create_won',
          message:
            'A deal cannot be created directly in Won & Revenue. Create it in an earlier stage and move it in, so the actual close amount and award reference are recorded.',
        },
        { status: 400 },
      )
    }
    /*
     * THE PURSUE DEDUPE. A create carrying a reference that is already in the pipeline returns
     * the EXISTING deal (200, {existing:true}) and writes nothing. Pressing Pursue twice, or
     * pursuing one NSN from the Monopoly Map and again from its dossier, must land on one card:
     * a pipeline with two cards for one part double-counts its own money. Refs compare
     * normalized (case and punctuation stripped); an empty ref never matches, so plain manual
     * deals with no reference are never folded into each other.
     */
    if (typeof body.ref === 'string') {
      const existing = findDealByRef(body.ref)
      if (existing) {
        return Response.json({ deals: readDeals(), id: existing.id, existing: true })
      }
    }
    const id = crypto.randomUUID()
    const stage = (body.stage ?? 'opportunities') as PipelineStage
    const patch = directPatch(body)
    // Seed the honest stage action when the operator wrote none. Never overwrite their text.
    if (!patch.nextAction || !patch.nextAction.trim()) patch.nextAction = STAGE_NEXT_ACTION[stage]
    const deals = upsertDeal({ ...patch, id, stage }, systemClock.now())
    return Response.json({ deals, id })
  }

  // ---------------------------------------------------------------- update path
  const id = body.id as string
  const existing = readDeals().find((d) => d.id === id)
  if (!existing) {
    return Response.json({ error: 'not_found', message: 'No deal with that id.' }, { status: 404 })
  }

  const wantsStageChange = typeof body.stage === 'string' && body.stage !== existing.stage
  const carriesWonFields =
    body.wonValueUsd !== undefined || body.wonRef !== undefined || body.wonBasis !== undefined

  // The recorded close is writable only by the move into Won. Anything else is refused, not ignored.
  if (carriesWonFields && !(wantsStageChange && body.stage === 'won_revenue')) {
    return Response.json(
      {
        error: 'won_fields_locked',
        message:
          'The recorded close is written when a deal moves into Won & Revenue, and only then. It is not a field to edit in place.',
      },
      { status: 400 },
    )
  }

  if (!wantsStageChange) {
    const deals = upsertDeal({ ...directPatch(body), id }, systemClock.now())
    return Response.json({ deals, id })
  }

  // ---------------------------------------------------------------- stage change
  const to = body.stage as PipelineStage
  const now = systemClock.now()

  /*
   * THE AI-OWNED REFUSAL, S-AT.8. The HTTP caller is always the signed-in operator, so
   * canTransition's ai-actor check alone cannot see an AI-OWNED deal being pushed into Won by
   * a person. The record of a win names who filed it, so the deal is reassigned to that
   * person FIRST, then moved. This mirrors AI_CANNOT_FILE rather than bypassing it.
   */
  if (to === 'won_revenue' && existing.owner === 'AI') {
    return Response.json(
      {
        error: 'stage_refused',
        code: 'AI_CANNOT_FILE',
        message:
          'Hunter Mode cannot hold a deal in Won & Revenue. Reassign this deal to the person who closed it, then record the win.',
      },
      { status: 409 },
    )
  }

  let wonValueUsd: number | null = null
  if (to === 'won_revenue') {
    const v = body.wonValueUsd
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return Response.json(
        {
          error: 'won_value_required',
          message: 'Recording a win needs the actual close amount in dollars (0 or more).',
        },
        { status: 400 },
      )
    }
    wonValueUsd = v
  }

  const wonRef = typeof body.wonRef === 'string' && body.wonRef.trim() ? body.wonRef.trim() : null
  const evidence: TransitionEvidence = {
    hasActivePursuit: body.attest === 'outreach_running',
    packetReadiness: packetReadinessFor(existing.ref),
    terminalOutcome: to === 'won_revenue' ? ((body.wonBasis as WonBasis | undefined) ?? null) : null,
    awardRecordId: wonRef,
  }

  const reasonParts = [`operator moved ${STAGE_LABEL[existing.stage]} to ${STAGE_LABEL[to]}`]
  if (body.attest === 'outreach_running') reasonParts.push('attested: a supplier pursuit is running')
  if (evidence.packetReadiness === 'forming') reasonParts.push('a saved Documents packet matches this ref')
  if (wonRef) reasonParts.push(`award ref ${wonRef}`)
  if (to === 'won_revenue') reasonParts.push(`recorded close $${wonValueUsd}`)

  try {
    await applyStageChange(
      toDeal(existing),
      to,
      { kind: 'human', operator: 'DH' },
      reasonParts.join('; '),
      dealStageAuditWriter,
      now,
      evidence,
    )
  } catch (e) {
    if (e instanceof StageChangeRefused) {
      return Response.json(
        { error: 'stage_refused', code: e.verdict.code, message: e.verdict.explanation },
        { status: 409 },
      )
    }
    if (e instanceof StageAuditFailed) {
      // 4.17.4: no audit row, no move. The stage is exactly where it was.
      return Response.json(
        {
          error: 'audit_failed',
          message: 'The audit record could not be written, so the deal was not moved.',
        },
        { status: 503 },
      )
    }
    throw e
  }

  const patch: Partial<StoredDeal> & { id: string } = { ...directPatch(body), id, stage: to }
  const leavingWon = existing.stage === 'won_revenue' && to !== 'won_revenue'
  if (to === 'won_revenue') {
    patch.wonValueUsd = wonValueUsd
    patch.wonAtMs = now
    patch.wonRef = wonRef
  } else {
    // Leaving Won clears the recorded close (the coercion boundary enforces it too).
    patch.wonValueUsd = null
    patch.wonAtMs = null
    patch.wonRef = null
  }
  // Seed the new stage's honest action, only over an empty field or another seed.
  if (patch.nextAction === undefined || patch.nextAction === null) {
    if (isSeededNextAction(existing.nextAction)) patch.nextAction = STAGE_NEXT_ACTION[to]
  }

  const deals = upsertDeal(patch, now)
  return Response.json({
    deals,
    id,
    moved: { from: existing.stage, to },
    ...(leavingWon
      ? {
          clearedRecordedClose: true,
          note: 'This deal left Won & Revenue, so its recorded close was cleared. Won & Revenue counts recorded closes only.',
        }
      : {}),
  })
}

/** Remove a deal. Gated. Body or query: { id }. */
export async function DELETE(req: NextRequest) {
  const denied = await gateOrJson()
  if (denied) return denied
  const url = new URL(req.url)
  let id = url.searchParams.get('id') ?? ''
  if (!id) {
    try {
      id = ((await req.json()) as { id?: string }).id ?? ''
    } catch {
      /* no body */
    }
  }
  if (!id) return Response.json({ error: 'no_id' }, { status: 400 })
  return Response.json({ deals: removeDeal(id) })
}
