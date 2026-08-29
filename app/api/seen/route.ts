import { NextRequest } from 'next/server'
import { readCaller, callerAccountId, requirePermission } from '@/lib/session/authz'
import { readSeen, markSeen } from '@/lib/intelligence/seen-store'
import { systemClock } from '@/lib/time/clock'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * SEEN-STATE: which corners this operator has already opened.
 *
 * ==========================================================================================
 * WHY `requirement:read` GATES A WRITE
 * ==========================================================================================
 * `gateOrJson` answers "is anyone signed in" and explicitly cannot answer who — its own docblock
 * records that a `read_only` session once used a handler guarded that way to promote itself to
 * owner. So a state-changing handler asks `requirePermission`.
 *
 * `requirement:read` is the RIGHT permission here and a stronger one would be a bug. Marking a
 * row seen is private view state about the caller's own eyes, not a shared annotation and not an
 * org setting: every role on the roster holds `requirement:read`, and a read_only analyst working
 * the board needs this feature exactly as much as an owner does. The invariant that makes the
 * write safe is not the strength of the permission, it is the SCOPING below.
 *
 * ==========================================================================================
 * ⛔ THE ACCOUNT ID IS READ FROM THE SESSION AND NEVER FROM THE REQUEST
 * ==========================================================================================
 * The body carries a stock number and nothing else. There is no `accountId` field to forge,
 * because the id is derived server-side from the gate cookie via `readCaller()`. A caller can
 * therefore only ever write their OWN marks, whatever they put in the body. If this route ever
 * grows an operator-supplied id, that property is gone.
 */

/** Read this caller's seen set. `available:false` means UNKNOWN, never "nothing seen". */
export async function GET() {
  const denied = await requirePermission('requirement:read')
  if (denied) return denied
  const accountId = callerAccountId(await readCaller())
  return Response.json(readSeen(accountId))
}

/**
 * Mark one stock number as opened by this caller.
 *
 * Idempotent, so the grid's optimistic click and the dossier page's on-open mark can both fire
 * for the same row without racing to a different answer.
 */
export async function POST(req: NextRequest) {
  const denied = await requirePermission('requirement:read')
  if (denied) return denied

  const accountId = callerAccountId(await readCaller())
  if (!accountId) {
    // A bootstrap caller is owner-equivalent but is not a PERSON, so there is no id to key marks
    // against. Refusing is honest; inventing a shared "bootstrap" bucket would mix two operators'
    // boards together the moment a second one signed in.
    return Response.json({ error: 'no_account', message: 'Seen-state is stored per account.' }, { status: 409 })
  }

  let nsn: unknown
  try {
    nsn = ((await req.json()) as { nsn?: unknown }).nsn
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 })
  }
  if (typeof nsn !== 'string' || nsn.trim() === '') {
    return Response.json({ error: 'bad_request', message: 'nsn is required.' }, { status: 400 })
  }

  // `systemClock.now()` is epoch MILLISECONDS, not a Date — the clock module exists precisely so
  // no module reaches for a bare `new Date()`, and its `now()` returns a number.
  const result = markSeen(accountId, nsn, new Date(systemClock.now()).toISOString())
  if (!result.ok) {
    // The store is unwritable. Say so with a 503 rather than a cheerful 200: a fail-open control
    // returning a happy status is the defect class this estate has been bitten by most often, and
    // here it would leave the operator believing the board is remembering him when it is not.
    return Response.json(
      { error: 'store_unavailable', message: 'Seen-state could not be saved.' },
      { status: 503 },
    )
  }
  return Response.json(result)
}
