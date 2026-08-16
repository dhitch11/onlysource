import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { StageAuditWriter } from './pipeline'

/**
 * THE DEAL STAGE AUDIT TRAIL — one append-only JSONL file in the state directory.
 *
 * `applyStageChange` (lib/sales/pipeline.ts) requires an audit writer and refuses to move a
 * deal when the write fails. This is that writer, made real: every stage change the API
 * serves lands here as one line of JSON BEFORE the deal store is touched, so "why did this
 * move" always has an answer with an actor, a reason and a timestamp on it.
 *
 * Append-only by construction: this module exposes no delete and no rewrite. The file lives
 * in the gitignored state directory next to deals.json, so it survives deploys with the
 * pipeline it describes.
 *
 * SYNCHRONOUS ON PURPOSE. The contract is audit-BEFORE-move, and an fsync-less async write
 * that is still in flight when the stage flips would reduce the ordering to a hope. One
 * appendFileSync per stage change is nothing at this volume, and it either lands or throws.
 */

export type DealAuditEvent = {
  dealId: string
  orgId: string
  from: string
  to: string
  actor: unknown
  reason: string
  at: number
}

function stateDir(): string {
  return process.env.ONLYSOURCE_STATE_DIR || path.join(process.cwd(), '.state')
}
function filePath(): string {
  return path.join(stateDir(), 'deal-audit.jsonl')
}

/** The writer `applyStageChange` takes. Throws on failure, which is exactly what aborts the move. */
export const dealStageAuditWriter: StageAuditWriter = async (event) => {
  const dir = stateDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(filePath(), `${JSON.stringify(event)}\n`, 'utf8')
}

/** Read the trail back, newest last. For tests and any future history surface. */
export function readDealAudit(): DealAuditEvent[] {
  try {
    const p = filePath()
    if (!existsSync(p)) return []
    return readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as DealAuditEvent)
  } catch {
    return []
  }
}
