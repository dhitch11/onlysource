import { ROLES, can, permission, role } from './permissions'
import type { RosterStatus } from './roster-store'

/**
 * THE ROSTER RULES. One module, so the interface and the route handler can never disagree.
 *
 * ==========================================================================================
 * WHY THESE LIVE HERE AND NOT IN THE PAGE OR THE ROUTE.
 * ==========================================================================================
 * A disabled button and a refusing endpoint are two implementations of the same rule, and the
 * usual way that goes wrong is that one of them is updated and the other is not. Then either
 * the operator is blocked from something the server would happily do, or, far worse, a control
 * renders enabled and the server refuses after the click, which reads as a broken product.
 *
 * So the page asks these functions what an operator may do, and the route asks the SAME
 * functions before it writes. The refusal sentence an operator reads under a disabled control
 * is the identical string the API would have answered with. There is one rule, in one place,
 * and it is enforced on the server whatever the client believes.
 *
 * ==========================================================================================
 * THE RULE THAT ACTUALLY MATTERS: THE ORGANIZATION KEEPS AN OWNER.
 * ==========================================================================================
 * `owner` is the only role holding `org.manage`. Demote or deactivate the last active owner
 * and nobody can ever grant it back, because granting it is itself an owner capability. That
 * is a one click, unrecoverable lockout of the organization from itself, and no confirmation
 * dialog is an acceptable defence against it. It is refused structurally, on the server, and
 * the control is disabled with the reason stated in visible text.
 *
 * Seeded users cannot be removed either. They are product facts from the approved build
 * directive, so a delete would be undone by the next read and the operator would watch a row
 * reappear. Deactivation is the honest verb for them and it persists properly.
 */

export type RosterGuard = { ok: true } | { ok: false; reason: string }

const OK: RosterGuard = { ok: true }

/** The minimum a rule needs to know about a user. The directory row satisfies it. */
export type GuardedUser = {
  id: string
  name: string
  roleKey: string
  status: RosterStatus
  seeded: boolean
}

export function isOwnerRole(roleKey: string): boolean {
  return roleKey === 'owner'
}

function activeOwnersOtherThan(users: readonly GuardedUser[], id: string): number {
  return users.filter((u) => u.id !== id && isOwnerRole(u.roleKey) && u.status === 'active').length
}

function find(users: readonly GuardedUser[], id: string): GuardedUser | undefined {
  return users.find((u) => u.id === id)
}

const NOT_IN_ROSTER = 'That user is not in the roster.'

/**
 * The single sentence used everywhere the last owner is protected. Written once so the
 * disabled control and the API refusal are word for word identical.
 */
export const LAST_OWNER_REASON =
  'ONLYSOURCE has to keep one active owner. Give somebody else the owner role first.'

export function guardRoleChange(
  users: readonly GuardedUser[],
  id: string,
  nextRoleKey: string,
): RosterGuard {
  const user = find(users, id)
  if (!user) return { ok: false, reason: NOT_IN_ROSTER }
  if (!ROLES.some((r) => r.key === nextRoleKey)) {
    return { ok: false, reason: 'That role does not exist.' }
  }
  if (nextRoleKey === user.roleKey) return OK
  // Losing owner matters. Gaining it never does.
  if (isOwnerRole(user.roleKey) && user.status === 'active' && activeOwnersOtherThan(users, id) === 0) {
    return { ok: false, reason: LAST_OWNER_REASON }
  }
  return OK
}

/**
 * The single sentence used wherever somebody tries to change their own role. Written once, so
 * the disabled select and the API refusal are word for word identical.
 */
export const SELF_ROLE_REASON =
  'You cannot change your own role. Somebody else with the permission has to do it, so nobody ' +
  'can promote themselves.'

/**
 * NOBODY CHANGES THEIR OWN ROLE. Not an operator, not an admin, not the owner.
 *
 * This is separate from the permission check and it is not the same rule. A permission asks
 * "may this person edit roles at all"; this asks "may they edit THEIR OWN", and the answer is
 * always no. Without it, one compromised admin session is a self-service promotion to owner,
 * and the audit trail reads as a legitimate role change made by somebody entitled to make it.
 * The recovery is deliberately social: another person with the permission makes the change,
 * so two accounts are involved in every privilege increase.
 *
 * `callerId` is null when there is no person behind the request, which today means the
 * break-glass door on a server with no credentials at all. There is no self to protect in that
 * case, so the rule does not fire and first-run setup still works.
 */
export function guardSelfRoleChange(
  users: readonly GuardedUser[],
  callerId: string | null,
  id: string,
  nextRoleKey: string,
): RosterGuard {
  if (!callerId || callerId !== id) return OK
  const user = find(users, id)
  if (!user) return { ok: false, reason: NOT_IN_ROSTER }
  // Asking for the role you already hold changes nothing, so it is not an escalation. This
  // matches `guardRoleChange`, which also lets a no-op through rather than refusing a request
  // that would have had no effect.
  if (nextRoleKey === user.roleKey) return OK
  return { ok: false, reason: SELF_ROLE_REASON }
}

/**
 * NOBODY HANDS OUT A SIGN IN TO AN ACCOUNT THAT OUTRANKS THEM.
 *
 * `users.manage` carries the power to set a password, and a password is an identity. Without
 * this rule an admin sets a password on the OWNER account, signs in as the owner, and holds
 * everything, without a single role ever changing. The escalation is invisible in a roster
 * diff: no role moved, nobody was added, and the audit trail says a password was set by
 * somebody entitled to set passwords.
 *
 * The comparison is between PERMISSION SETS, not role names, so it keeps working when an admin
 * authors a fifth role. A caller may set a sign in for anybody who cannot do more than they
 * can, which is the whole of the rule and needs no list of role pairs to maintain.
 */
export function guardSignInChange(callerHeld: readonly string[], user: GuardedUser): RosterGuard {
  const target = role(user.roleKey)
  // An unrecognised role key holds nothing, so there is nothing to escalate to.
  if (!target) return OK

  const beyond = target.permissions.filter((key) => !can(callerHeld, key))
  if (beyond.length === 0) return OK

  const first = permission(beyond[0] as string)?.label ?? (beyond[0] as string)
  return {
    ok: false,
    reason:
      `You cannot change the sign in for ${user.name}, because that account holds access your ` +
      `own role does not, starting with "${first}". Somebody with at least that access has to ` +
      'set it.',
  }
}

export function guardStatusChange(
  users: readonly GuardedUser[],
  id: string,
  next: RosterStatus,
): RosterGuard {
  const user = find(users, id)
  if (!user) return { ok: false, reason: NOT_IN_ROSTER }
  if (next === user.status) return OK
  if (next === 'deactivated' && isOwnerRole(user.roleKey) && activeOwnersOtherThan(users, id) === 0) {
    return { ok: false, reason: LAST_OWNER_REASON }
  }
  return OK
}

export function guardRemove(users: readonly GuardedUser[], id: string): RosterGuard {
  const user = find(users, id)
  if (!user) return { ok: false, reason: NOT_IN_ROSTER }
  if (user.seeded) {
    return {
      ok: false,
      reason:
        `${user.name} ships with the product, so removing the row would only bring it back on the ` +
        'next load. Deactivate the account instead, which does save.',
    }
  }
  if (isOwnerRole(user.roleKey) && user.status === 'active' && activeOwnersOtherThan(users, id) === 0) {
    return { ok: false, reason: LAST_OWNER_REASON }
  }
  return OK
}

/**
 * Validate a new user before anything is written.
 *
 * A create with no content is refused rather than stored as a blank row, which is the same
 * rule the deal store and the packet vault already follow. The email check is deliberately
 * shallow: it rejects the shapes that are certainly not addresses and accepts everything
 * else, because a clever pattern that rejects a real address is a worse failure than a loose
 * one that accepts a typo the operator can see and fix.
 */
export function validateNewUser(
  users: readonly GuardedUser[],
  emailsInUse: readonly string[],
  input: { name?: unknown; email?: unknown; roleKey?: unknown; title?: unknown },
): { ok: true; value: { name: string; email: string; roleKey: string; title: string } } | { ok: false; reason: string } {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const email = typeof input.email === 'string' ? input.email.trim() : ''
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const roleKey = typeof input.roleKey === 'string' ? input.roleKey.trim() : ''

  if (!name) return { ok: false, reason: 'A new user needs a name.' }
  if (!email) return { ok: false, reason: 'A new user needs an email address.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: 'That does not look like an email address.' }
  }
  if (!roleKey) return { ok: false, reason: 'A new user needs a role.' }
  if (!ROLES.some((r) => r.key === roleKey)) return { ok: false, reason: 'That role does not exist.' }
  if (emailsInUse.some((e) => e.toLowerCase() === email.toLowerCase())) {
    return { ok: false, reason: 'Somebody in the roster already uses that email address.' }
  }
  // `users` is accepted for symmetry with the guards and so a future rule (a seat limit, a
  // domain restriction) has the roster in hand without changing every call site.
  void users
  return { ok: true, value: { name, email, roleKey, title } }
}
