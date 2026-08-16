import { NextRequest } from 'next/server'
import { gateOrJson } from '@/lib/session/require-gate'
import { buildUsers, type DirectoryUser } from '@/lib/admin/directory'
import {
  addMember,
  readRoster,
  removeMember,
  setOverride,
  updateMember,
  type Roster,
  type RosterStatus,
} from '@/lib/admin/roster-store'
import {
  guardRemove,
  guardRoleChange,
  guardStatusChange,
  validateNewUser,
  type GuardedUser,
} from '@/lib/admin/roster-rules'
import { systemClock } from '@/lib/time/clock'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * THE ROSTER API. Gated, and it re-decides every rule the interface believes.
 *
 * The screen disables a control the server would refuse, which is a courtesy. THIS is the
 * control: every write below re-runs the same `roster-rules` functions the page used, against
 * the roster it just read off the disk, so a client that ignored the disabled attribute, or a
 * second operator racing the first, is refused with the same sentence.
 *
 * Refusal shape, deliberately uniform: a 400 with `{ error, message }` where `message` is a
 * sentence written for a person, because the interface renders it verbatim. A malformed body
 * is a 400, never a 500. A write that fails to reach the disk is a 500 that SAYS so, because
 * an operator who is told an account was deactivated when it was not is worse off than one who
 * is told the save failed.
 */

type Body = {
  id?: unknown
  name?: unknown
  email?: unknown
  title?: unknown
  roleKey?: unknown
  status?: unknown
}

function guarded(users: DirectoryUser[]): GuardedUser[] {
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    roleKey: u.roleKey,
    status: u.status,
    seeded: u.seeded,
  }))
}

function refuse(error: string, message: string) {
  return Response.json({ error, message }, { status: 400 })
}

function ok(roster: Roster) {
  return Response.json({ users: buildUsers(roster) })
}

/** A write that did not reach the disk is reported, never swallowed. */
function notSaved() {
  return Response.json(
    {
      error: 'not_saved',
      message:
        'That change could not be written to the server state directory, so nothing was saved. ' +
        'Try again, and if it keeps failing the state directory is not writable.',
    },
    { status: 500 },
  )
}

/** The roster as the screen sees it. Gated. */
export async function GET() {
  const denied = await gateOrJson()
  if (denied) return denied
  return Response.json({ users: buildUsers(readRoster()) })
}

/**
 * Add a user (no id) or change one (id present). Gated.
 *
 * Both live on POST because that is the house idiom the deal store already set, and one
 * endpoint means one place where the rules are re-checked.
 */
export async function POST(req: NextRequest) {
  const denied = await gateOrJson()
  if (denied) return denied

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return Response.json({ error: 'bad_request', message: 'That request was not valid JSON.' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return refuse('bad_request', 'That request was not a user.')
  }

  const roster = readRoster()
  const users = buildUsers(roster)
  const id = typeof body.id === 'string' ? body.id.trim() : ''

  // ---------- create ----------
  if (!id) {
    const check = validateNewUser(
      guarded(users),
      users.map((u) => u.email),
      { name: body.name, email: body.email, roleKey: body.roleKey, title: body.title },
    )
    if (!check.ok) return refuse('invalid_user', check.reason)

    const now = systemClock.now()
    try {
      return ok(
        addMember({
          id: `user:${crypto.randomUUID()}`,
          name: check.value.name,
          email: check.value.email,
          title: check.value.title,
          roleKey: check.value.roleKey,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        }),
      )
    } catch {
      return notSaved()
    }
  }

  // ---------- change ----------
  const target = users.find((u) => u.id === id)
  if (!target) return refuse('unknown_user', 'That user is not in the roster.')

  const patch: { roleKey?: string; title?: string; status?: RosterStatus } = {}

  if (body.roleKey !== undefined) {
    const nextRole = typeof body.roleKey === 'string' ? body.roleKey.trim() : ''
    const g = guardRoleChange(guarded(users), id, nextRole)
    if (!g.ok) return refuse('role_refused', g.reason)
    patch.roleKey = nextRole
  }

  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'deactivated') {
      return refuse('bad_status', 'A user is either active or deactivated.')
    }
    const g = guardStatusChange(guarded(users), id, body.status)
    if (!g.ok) return refuse('status_refused', g.reason)
    patch.status = body.status
  }

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') return refuse('bad_title', 'A title has to be text.')
    patch.title = body.title.trim()
  }

  // An empty patch is a request that asks for nothing. Refusing it is honest: answering 200
  // would tell the operator a change was saved when none was made.
  if (Object.keys(patch).length === 0) {
    return refuse('empty_change', 'That request did not ask to change anything.')
  }

  try {
    return ok(target.seeded ? setOverride(id, patch, systemClock.now()) : updateMember(id, patch, systemClock.now()))
  } catch {
    return notSaved()
  }
}

/** Remove an added user. Gated. Seeded users are refused, with the reason. */
export async function DELETE(req: NextRequest) {
  const denied = await gateOrJson()
  if (denied) return denied

  const url = new URL(req.url)
  let id = url.searchParams.get('id') ?? ''
  if (!id) {
    try {
      id = ((await req.json()) as { id?: string }).id ?? ''
    } catch {
      /* no body, and the query string was empty; handled below */
    }
  }
  if (!id) return refuse('no_id', 'That request did not say which user to remove.')

  const roster = readRoster()
  const users = buildUsers(roster)
  const g = guardRemove(guarded(users), id)
  if (!g.ok) return refuse('remove_refused', g.reason)

  try {
    return ok(removeMember(id))
  } catch {
    return notSaved()
  }
}
