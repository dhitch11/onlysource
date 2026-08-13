import { describe, expect, it, vi } from 'vitest'
import {
  applyStageChange,
  canTransition,
  computeStageMetrics,
  dealsMissingNextAction,
  PIPELINE_STAGES,
  StageAuditFailed,
  StageChangeRefused,
  type Deal,
  type StageAuditWriter,
  type TransitionActor,
} from '@/lib/sales/pipeline'

const HUMAN: TransitionActor = { kind: 'human', operator: 'DH' }
const AI: TransitionActor = { kind: 'ai', pursuitId: 'p1', stepId: 's1' }
const NOW = 1_760_000_000_000

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: 'd1',
    orgId: 'onlysource',
    stage: 'opportunities',
    owner: 'AI',
    subject: { kind: 'solicitation', ref: 'SPE4A7-25-T-0001', niin: '011805372', title: 'Bushing' },
    pursuitId: null,
    modeledValueCents: 1_820_000,
    valueBasis: 'modelled',
    nextAction: 'Start outreach',
    updatedAt: NOW,
    ...over,
  }
}

describe('the five stages are the pipeline, in order', () => {
  it('has exactly the five approved stages in the approved order', () => {
    expect([...PIPELINE_STAGES]).toEqual([
      'opportunities', 'leads', 'quoting', 'customers', 'won_revenue',
    ])
  })
})

describe('transitions are strict about EVIDENCE and permissive about DIRECTION', () => {
  it('refuses Leads without an active pursuit', () => {
    const v = canTransition(deal(), 'leads', HUMAN, { hasActivePursuit: false })
    expect(v.allowed).toBe(false)
    if (!v.allowed) expect(v.code).toBe('NO_ACTIVE_PURSUIT')
  })

  it('allows Leads once a pursuit is genuinely running', () => {
    expect(canTransition(deal(), 'leads', HUMAN, { hasActivePursuit: true }).allowed).toBe(true)
  })

  it('refuses Quoting until the documents lane reports a packet forming', () => {
    const d = deal({ stage: 'leads' })
    const none = canTransition(d, 'quoting', HUMAN, { packetReadiness: 'none' })
    expect(none.allowed).toBe(false)
    if (!none.allowed) expect(none.code).toBe('NO_PACKET')
    expect(canTransition(d, 'quoting', HUMAN, { packetReadiness: 'forming' }).allowed).toBe(true)
  })

  it('allows a deal to move BACKWARDS, because a silent supplier really is back at Leads', () => {
    const d = deal({ stage: 'quoting' })
    expect(canTransition(d, 'leads', HUMAN, { hasActivePursuit: true }).allowed).toBe(true)
  })

  it('refuses a move to the stage it is already in', () => {
    const v = canTransition(deal({ stage: 'leads' }), 'leads', HUMAN, { hasActivePursuit: true })
    expect(v.allowed).toBe(false)
    if (!v.allowed) expect(v.code).toBe('SAME_STAGE')
  })
})

describe('Won & Revenue is structurally unreachable by the machine', () => {
  const ready = {
    terminalOutcome: 'material_confirmed' as const,
    awardRecordId: 'award-7',
  }

  it('REFUSES Hunter Mode outright, even with full evidence', () => {
    const v = canTransition(deal({ stage: 'quoting' }), 'won_revenue', AI, ready)
    expect(v.allowed).toBe(false)
    if (!v.allowed) expect(v.code).toBe('AI_CANNOT_FILE')
  })

  it('POSITIVE CONTROL: a human with the same evidence is allowed', () => {
    expect(canTransition(deal({ stage: 'quoting' }), 'won_revenue', HUMAN, ready).allowed).toBe(true)
  })

  it('refuses a human without a terminal outcome', () => {
    const v = canTransition(deal({ stage: 'quoting' }), 'won_revenue', HUMAN, { awardRecordId: 'a' })
    expect(v.allowed).toBe(false)
    if (!v.allowed) expect(v.code).toBe('NO_TERMINAL_OUTCOME')
  })

  it('refuses a human without a joined award record', () => {
    const v = canTransition(deal({ stage: 'quoting' }), 'won_revenue', HUMAN, {
      terminalOutcome: 'documents_received',
    })
    expect(v.allowed).toBe(false)
    if (!v.allowed) expect(v.code).toBe('NO_AWARD_RECORD')
  })
})

describe('the audit row is written FIRST and the stage does not move without it', () => {
  it('writes the audit event and returns a moved deal', async () => {
    const audit = vi.fn<StageAuditWriter>().mockResolvedValue(undefined)
    const moved = await applyStageChange(
      deal(), 'leads', HUMAN, 'outreach started', audit, NOW, { hasActivePursuit: true },
    )
    expect(moved.stage).toBe('leads')
    expect(audit).toHaveBeenCalledTimes(1)
    const event = audit.mock.calls[0]?.[0]
    expect(event?.from).toBe('opportunities')
    expect(event?.to).toBe('leads')
    expect(event?.actor).toEqual(HUMAN)
  })

  it('DOES NOT MOVE THE DEAL when the audit write fails', async () => {
    const audit = vi.fn<StageAuditWriter>().mockRejectedValue(new Error('audit down'))
    const original = deal()
    await expect(
      applyStageChange(original, 'leads', HUMAN, 'outreach started', audit, NOW, {
        hasActivePursuit: true,
      }),
    ).rejects.toBeInstanceOf(StageAuditFailed)
    // The original object is untouched: no moved card left behind by a partial failure.
    expect(original.stage).toBe('opportunities')
  })

  it('does not write an audit row for a refused transition', async () => {
    const audit = vi.fn<StageAuditWriter>().mockResolvedValue(undefined)
    await expect(
      applyStageChange(deal(), 'leads', HUMAN, 'no pursuit', audit, NOW, { hasActivePursuit: false }),
    ).rejects.toBeInstanceOf(StageChangeRefused)
    expect(audit).not.toHaveBeenCalled()
  })

  it('records an AI transition identically, with the actor recorded as ai', async () => {
    const audit = vi.fn<StageAuditWriter>().mockResolvedValue(undefined)
    await applyStageChange(deal(), 'leads', AI, 'reply confirmed', audit, NOW, {
      hasActivePursuit: true,
    })
    expect(audit.mock.calls[0]?.[0].actor).toEqual(AI)
  })
})

describe('metrics are computed, and unknown is not zero', () => {
  it('returns all five stages even when empty, with honest zeros', () => {
    const m = computeStageMetrics([])
    expect(m).toHaveLength(5)
    expect(m.every((s) => s.count === 0 && s.valueCents === 0)).toBe(true)
  })

  it('sums only KNOWN values and counts the unknown ones separately', () => {
    const m = computeStageMetrics([
      deal({ id: 'a', modeledValueCents: 100_000, valueBasis: 'modelled' }),
      deal({ id: 'b', modeledValueCents: 50_000, valueBasis: 'measured' }),
      deal({ id: 'c', modeledValueCents: null, valueBasis: 'insufficient' }),
    ])
    const opp = m.find((s) => s.stage === 'opportunities')
    expect(opp?.count).toBe(3)
    expect(opp?.valueCents).toBe(150_000)
    // The third deal is NOT silently counted as zero. A total that hides unknowns lies.
    expect(opp?.unknownValueCount).toBe(1)
  })
})

describe('an open deal with no next action is a bug', () => {
  it('flags open deals missing a next action', () => {
    const flagged = dealsMissingNextAction([
      deal({ id: 'a', nextAction: null }),
      deal({ id: 'b', nextAction: '   ' }),
      deal({ id: 'c', nextAction: 'Chase supplier' }),
      deal({ id: 'd', stage: 'won_revenue', nextAction: null }),
    ])
    expect(flagged.map((d) => d.id)).toEqual(['a', 'b'])
  })
})
