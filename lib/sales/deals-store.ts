import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { normalizeDealRef, PIPELINE_STAGES, type Deal, type DealOwner, type PipelineStage } from './pipeline'

/**
 * THE DEAL STORE — the operator's real pipeline, persisted.
 *
 * Honest about what it is: an operator-maintained CRM, not an auto-synced projection off an engine
 * that does not exist yet. The operator pushes a corner or a supplier in, moves it through the
 * stages, and the counts and values are computed from these stored records, never written or
 * estimated. One JSON file in the gitignored state directory that survives deploys. Bad or unknown
 * shapes coerce to safe values rather than failing, and money is stored in whole cents.
 */

export type StoredDeal = {
  id: string
  stage: PipelineStage
  owner: DealOwner
  title: string
  /** A solicitation number, NSN, or free reference. */
  ref: string
  niin: string | null
  /** Modeled value in whole dollars; null when unknown. */
  valueUsd: number | null
  nextAction: string | null
  createdAt: number
  updatedAt: number
}

const OWNERS: DealOwner[] = ['DH', 'DG', 'AI']

function stateDir(): string {
  return process.env.ONLYSOURCE_STATE_DIR || path.join(process.cwd(), '.state')
}
function filePath(): string {
  return path.join(stateDir(), 'deals.json')
}

function coerce(raw: unknown): StoredDeal | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : ''
  if (!id) return null
  const stage = (PIPELINE_STAGES as readonly string[]).includes(r.stage as string)
    ? (r.stage as PipelineStage)
    : 'opportunities'
  const owner = OWNERS.includes(r.owner as DealOwner) ? (r.owner as DealOwner) : 'DH'
  return {
    id,
    stage,
    owner,
    title: typeof r.title === 'string' ? r.title : '(untitled)',
    ref: typeof r.ref === 'string' ? r.ref : '',
    niin: typeof r.niin === 'string' ? r.niin : null,
    valueUsd: typeof r.valueUsd === 'number' && Number.isFinite(r.valueUsd) ? r.valueUsd : null,
    nextAction: typeof r.nextAction === 'string' && r.nextAction.trim() ? r.nextAction : null,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  }
}

export function readDeals(): StoredDeal[] {
  try {
    const p = filePath()
    if (!existsSync(p)) return []
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    return Array.isArray(raw) ? raw.map(coerce).filter((d): d is StoredDeal => d !== null) : []
  } catch {
    return []
  }
}

function writeDeals(deals: StoredDeal[]): void {
  const dir = stateDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath(), JSON.stringify(deals, null, 2), 'utf8')
}

/** Upsert a deal by id (create if new). `nowMs` is passed in so the store never reads the clock. */
export function upsertDeal(input: Partial<StoredDeal> & { id: string }, nowMs: number): StoredDeal[] {
  const deals = readDeals()
  const existing = deals.find((d) => d.id === input.id)
  const merged = coerce({
    ...(existing ?? { createdAt: nowMs }),
    ...input,
    updatedAt: nowMs,
  })
  if (!merged) return deals
  const next = existing ? deals.map((d) => (d.id === merged.id ? merged : d)) : [...deals, merged]
  writeDeals(next)
  return next
}

export function removeDeal(id: string): StoredDeal[] {
  const next = readDeals().filter((d) => d.id !== id)
  writeDeals(next)
  return next
}

/**
 * The serving half of the Pursue dedupe: the deal already carrying this reference, or null.
 * Pressing Pursue twice, or pursuing the same NSN from two surfaces, must land on ONE card;
 * the API returns this existing deal rather than writing a twin. Normalization lives in
 * pipeline.ts (pure, shared with the client surfaces that mark pursued rows).
 */
export function findDealByRef(ref: string): StoredDeal | null {
  const wanted = normalizeDealRef(ref)
  if (!wanted) return null
  return readDeals().find((d) => normalizeDealRef(d.ref) === wanted) ?? null
}

/** Project a stored deal into the Deal shape computeStageMetrics + the pipeline UI expect. */
export function toDeal(s: StoredDeal): Deal {
  return {
    id: s.id,
    orgId: 'onlysource',
    stage: s.stage,
    owner: s.owner,
    subject: { kind: 'opportunity', ref: s.ref, niin: s.niin, title: s.title },
    pursuitId: null,
    modeledValueCents: s.valueUsd != null ? Math.round(s.valueUsd * 100) : null,
    valueBasis: s.valueUsd != null ? 'modelled' : 'insufficient',
    nextAction: s.nextAction,
    updatedAt: s.updatedAt,
  }
}
