import { NextRequest } from 'next/server'
import {
  callerAccountId,
  callerPermissions,
  permissionRefusal,
  readCaller,
  requirePermission,
} from '@/lib/session/authz'
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
  guardAccountReach,
  guardRoleGrant,
  guardRoleRemoval,
  guardSelfRoleChange,
  guardSignInChange,
  guardStatusChange,
  validateNewUser,
  type GuardedUser,
} from '@/lib/admin/roster-rules'
import { revokePassword, setPassword } from '@/lib/auth/accounts'
import { systemClock } from '@/lib/time/clock'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * THE ROSTER API. Authorized per caller, and it re-decides every rule the interface believes.
 *
 * ★ THE ESCALATION THIS ROUTE SHIPPED WITH, AND HOW IT IS CLOSED. Until 2026-08-18 the only
 * check here was `gateOrJson()`, which answers "is any account signed in" and nothing else. A
 * session holding `read_only`, the weakest role the product ships with, POSTed its own id with
 * `roleKey: 'owner'`, was promoted, and then set a password on the seeded owner account. Full
 * takeover, from the role designed to see the least. Every handler below now resolves WHO is
 * calling and asks the permission model what they may do.
 *
 * ★ AND THE SECOND HALF, WHICH THE FIRST VERSION OF THIS COMMENT CLAIMED AND DID NOT HAVE. It
 * said "a role change additionally refuses the caller's own row, so no privilege increase is
 * ever a single-person act". Refusing the caller's own row is defeated by a second identity,
 * and on 2026-08-18 the seeded `admin` account walked to `owner` alone in three permitted
 * requests by creating one, giving it a password, and promoting itself from it. Every request
 * answered 200. The claim was false as written. What makes it true is `guardRoleGrant` and
 * `guardRoleRemoval`: a caller may only hand out, or take away, a role whose permissions are a
 * subset of what they themselves hold, on the create path as well as the change path.
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
  /**
   * A new password for this user, or null to revoke their sign in.
   *
   * NEVER logged, never echoed back, never stored. It is hashed by `lib/auth/accounts` and only
   * the derivation reaches the disk. This field is also the reason this route must never gain a
   * "log the request body" line for debugging.
   */
  password?: unknown
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

/**
 * The roster as the screen sees it. Requires `users.manage`.
 *
 * A read, and still admin-plane: it returns every person's name, address, role and whether
 * they have a sign in, which is the shape of the organization. There is no `users.read`
 * permission in the model, so this asks for the one that exists rather than inventing a key
 * here, where nobody would ever find it again.
 */
export async function GET() {
  const denied = await requirePermission('users.manage')
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
  /*
   * The caller is resolved ONCE and asked twice: `users.manage` for the right to touch the
   * roster at all, and `roles.manage` at each point below where a role is handed out. Reading
   * the caller a second time would let a deactivation landing mid-request answer two different
   * questions inside one write.
   */
  const caller = await readCaller()
  const denied = permissionRefusal(caller, 'users.manage')
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

    /*
     * A create NAMES a role, and naming a role is handing one out. It asks for `roles.manage`
     * for the same reason the change path does: a caller who may add people but not grant
     * roles must not be able to add a person who arrives already holding one.
     */
    const roleDenied = permissionRefusal(caller, 'roles.manage')
    if (roleDenied) return roleDenied

    /*
     * AND THE ROLE NAMED HAS TO BE ONE THIS CALLER COULD GIVE AWAY. The create path is checked
     * for the same reason the change path is, and it is not redundant with it: the measured
     * escalation started HERE, with an admin minting a second account to act through. Bounding
     * only the change path would leave "create an owner, then set its password, then sign in as
     * it" standing, which is the same takeover with one fewer request.
     */
    const grant = guardRoleGrant(callerPermissions(caller), check.value.roleKey)
    if (!grant.ok) return refuse('role_refused', grant.reason)

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
          passwordHash: null,
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

  /*
   * The credential change is handled FIRST and on its own, because it is the one field that is
   * not a patch on the roster row: it is hashed and written by the account layer. Doing it here
   * also means a request carrying only a password is not treated as an "empty change".
   */
  if (body.password !== undefined) {
    /*
     * A PASSWORD IS AN IDENTITY, which is the escalation a permission check alone cannot see.
     * `users.manage` says the caller may work the roster; it does not say they may hand
     * themselves the keys to a bigger account. Both directions are covered here, setting and
     * revoking, because taking a sign in away from the owner is its own kind of takeover.
     */
    const reach = guardSignInChange(callerPermissions(caller), {
      id: target.id,
      name: target.name,
      roleKey: target.roleKey,
      status: target.status,
      seeded: target.seeded,
    })
    if (!reach.ok) return refuse('sign_in_refused', reach.reason)

    if (body.password === null) {
      const done = revokePassword(id, systemClock.now())
      if (!done.ok) return notSaved()
      return ok(readRoster())
    }
    if (typeof body.password !== 'string') {
      return refuse('bad_password', 'A password has to be text.')
    }
    const result = await setPassword(id, body.password, systemClock.now())
    if (!result.ok) return refuse('password_refused', result.reason)
    return ok(readRoster())
  }

  const patch: { roleKey?: string; title?: string; status?: RosterStatus } = {}

  if (body.roleKey !== undefined) {
    const nextRole = typeof body.roleKey === 'string' ? body.roleKey.trim() : ''
    // Changing a role is a second, narrower privilege than changing a person's title.
    const roleDenied = permissionRefusal(caller, 'roles.manage')
    if (roleDenied) return roleDenied
    // And nobody changes their OWN role, whatever they hold. See `guardSelfRoleChange`.
    const self = guardSelfRoleChange(guarded(users), callerAccountId(caller), id, nextRole)
    if (!self.ok) return refuse('self_role_refused', self.reason)
    /*
     * AND NOBODY HANDS OUT MORE THAN THEY HOLD, OR TAKES AWAY MORE THAN THEY HOLD.
     *
     * `guardSelfRoleChange` compares ids, so it is defeated by a second identity, and one was
     * minted and used on 2026-08-18 to walk an `admin` account to `owner` in three permitted
     * requests. These two rules compare PERMISSION SETS instead, which no number of puppets can
     * change. They are the role-shaped twin of `guardSignInChange` above.
     */
    const held = callerPermissions(caller)
    const grant = guardRoleGrant(held, nextRole)
    if (!grant.ok) return refuse('role_refused', grant.reason)
    const strip = guardRoleRemoval(held, {
      id: target.id,
      name: target.name,
      roleKey: target.roleKey,
      status: target.status,
      seeded: target.seeded,
    }, nextRole)
    if (!strip.ok) return refuse('role_refused', strip.reason)
    const g = guardRoleChange(guarded(users), id, nextRole)
    if (!g.ok) return refuse('role_refused', g.reason)
    patch.roleKey = nextRole
  }

  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'deactivated') {
      return refuse('bad_status', 'A user is either active or deactivated.')
    }
    const target = users.find((u) => u.id === id)
    // Deactivation is a reach into the account, so it is bounded by the same rule as a role
    // change. Without this an admin refused the role change simply deactivates the owner.
    if (target) {
      const reach = guardAccountReach(callerPermissions(caller), guarded([target])[0]!, 'deactivate or reactivate')
      if (!reach.ok) return refuse('reach_refused', reach.reason)
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

/** Remove an added user. Requires `users.manage`. Seeded users are refused, with the reason. */
export async function DELETE(req: NextRequest) {
  const denied = await requirePermission('users.manage')
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
  const target = users.find((u) => u.id === id)
  // Removal is the largest reach of all, so it asks the same question the role and status
  // verbs now ask: does this row hold access the caller does not?
  if (target) {
    const caller = await readCaller()
    const reach = guardAccountReach(callerPermissions(caller), guarded([target])[0]!, 'remove')
    if (!reach.ok) return refuse('reach_refused', reach.reason)
  }
  const g = guardRemove(guarded(users), id)
  if (!g.ok) return refuse('remove_refused', g.reason)

  try {
    return ok(removeMember(id))
  } catch {
    return notSaved()
  }
}
