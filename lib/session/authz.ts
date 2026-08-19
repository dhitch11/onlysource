import 'server-only'
import { log } from '@/lib/log'
import { ANONYMOUS_SUBJECT } from './pre-release-gate'
import { readGateVerdict } from './require-gate'
import { credentialedAccountCount, findAccountById, type Account } from '@/lib/auth/accounts'
import { can, permission, role } from '@/lib/admin/permissions'

/**
 * AUTHORIZATION. WHO is calling, and WHAT may they do. One module, asked by every mutating route.
 *
 * ==========================================================================================
 * THE DEFECT THIS EXISTS TO END, STATED PLAINLY BECAUSE IT WAS REPRODUCED ON A LIVE BUILD.
 * ==========================================================================================
 * `gateOrJson()` answers exactly one question: is ANY account signed in. It never asks who,
 * and it never asks what that person may do. Until this module landed it was the ONLY check
 * on `POST /api/admin/users`, so a session holding the `read_only` role called that route,
 * promoted ITSELF to `owner`, and then set a password on the seeded owner account. That is a
 * full identity takeover reachable from the weakest role the product ships with.
 *
 * The permission model was not missing. `lib/admin/permissions.ts` has carried the planes, the
 * roles and `can()` all along, and the Admin screen has been drawing them. It was enforced on
 * no mutating route anywhere in the app. A permission model that no route consults is a
 * diagram, not a control.
 *
 * ==========================================================================================
 * THE FOUR REFUSALS, EACH OF WHICH IS A TEST IN test/authz/.
 * ==========================================================================================
 *   1. NO SESSION HOLDS NOTHING. An absent, forged or expired token is anonymous. This is the
 *      behaviour `gateOrJson` already had and it is preserved exactly, including the 401.
 *
 *   2. AN UNRESOLVABLE SUBJECT HOLDS NOTHING. A token whose `sub` is not in the roster is
 *      denied, never defaulted. `roleFor()` in accounts.ts used to answer an unknown ROLE KEY
 *      with the operator role, and the same instinct applied to an unknown SUBJECT would hand
 *      a deleted user's live cookie the operator plane for the remaining life of the token.
 *      Deleting somebody has to take their access with it, in the same second.
 *
 *   3. A DEACTIVATED ACCOUNT HOLDS NOTHING, whatever its token says. The roster is the
 *      authority on access, not a claim frozen into a cookie twelve hours ago. Deactivation
 *      that only takes effect at token expiry is not deactivation, it is a delay.
 *
 *   4. BREAK-GLASS IS OWNER-EQUIVALENT ONLY WHILE NO CREDENTIAL EXISTS. The moment the first
 *      password is set, a `pre-release` token holds nothing. That is the exact promise the
 *      door already makes in `app/(auth)/enter/actions.ts`, made true on the read side too:
 *      a recovery path that keeps working after you no longer need it is a backdoor.
 *
 * WHY 401 AND 403 ARE BOTH USED, AND ARE NOT INTERCHANGEABLE. A 401 says "this request
 * carries no usable identity", and the remedy is to sign in. A 403 says "we know who you are
 * and this is not yours", and the remedy is a role change somebody else has to make. Telling
 * an operator to sign in again when their role is the problem sends them round a loop that
 * cannot end.
 */

/** Why a request carries no usable identity. Each maps to a different sentence for the person. */
export type AnonymousReason = 'no_session' | 'unknown_subject' | 'deactivated' | 'bootstrap_closed'

export type Caller =
  /** A resolved, active roster account. The normal case, and the only one that holds a role. */
  | { kind: 'account'; account: Account }
  /** The break-glass door on a server where no account has a credential yet. Owner-equivalent. */
  | { kind: 'bootstrap' }
  /** Nobody. Holds nothing, in every environment, for every permission. */
  | { kind: 'anonymous'; reason: AnonymousReason }

/**
 * Resolve the caller from the gate cookie.
 *
 * Every question is asked against the roster AS IT IS NOW. The token supplies one thing, the
 * subject, and nothing else about it is trusted: not the role, not the status, not whether the
 * person still exists.
 */
export async function readCaller(): Promise<Caller> {
  const verdict = await readGateVerdict()
  if (!verdict.valid) return { kind: 'anonymous', reason: 'no_session' }

  const subject = verdict.payload.sub

  if (subject === ANONYMOUS_SUBJECT) {
    if (credentialedAccountCount() === 0) return { kind: 'bootstrap' }
    return { kind: 'anonymous', reason: 'bootstrap_closed' }
  }

  const account = findAccountById(subject)
  if (!account) return { kind: 'anonymous', reason: 'unknown_subject' }
  if (account.status !== 'active') return { kind: 'anonymous', reason: 'deactivated' }
  return { kind: 'account', account }
}

/** The roster id behind a caller, or null when there is no person to name. */
export function callerAccountId(caller: Caller): string | null {
  return caller.kind === 'account' ? caller.account.id : null
}

/**
 * Everything this caller holds, as permission keys. The empty array is a complete answer.
 *
 * Exported because a rule sometimes has to COMPARE two permission sets rather than ask one
 * question. `guardSignInChange` is the case: it refuses a caller who would be handing out a
 * sign in to an account that can do more than they can.
 */
export function callerPermissions(caller: Caller): readonly string[] {
  if (caller.kind === 'anonymous') return []

  if (caller.kind === 'bootstrap') {
    /*
     * The count is asked again here rather than trusted from the moment the caller was read.
     * A request that started while the server had no credentials, and is still running when
     * the first password lands, must not spend a privilege that has just closed. It costs one
     * read of a small file and it removes the window entirely.
     */
    if (credentialedAccountCount() > 0) return []
    return role('owner')?.permissions ?? []
  }

  return caller.account.role.permissions
}

/**
 * The role name to SHOW this caller, for a refusal that names who they are.
 *
 * It lives here rather than in a page because it is a fact about a `Caller`, and the second
 * surface that needed it would otherwise have copied it. Two copies of a mapping like this drift,
 * and the drift is silent: one screen says "No account" while another says "Anonymous" about the
 * same session, and neither is wrong enough to notice.
 */
export function callerRoleName(caller: Caller): string {
  if (caller.kind === 'account') return caller.account.role.name
  if (caller.kind === 'bootstrap') return 'Break-glass session'
  return 'No account'
}

/**
 * May this caller do this?
 *
 * The whole answer for an account is `can()` over the permissions its CURRENT role holds, so
 * adding a permission to a role changes what the API allows with no second edit anywhere.
 */
export function callerCan(caller: Caller, permissionKey: string): boolean {
  return can(callerPermissions(caller), permissionKey)
}

/** The sentence an anonymous caller reads, chosen by WHY they are anonymous. */
function anonymousRefusal(reason: AnonymousReason): { error: string; message: string } {
  switch (reason) {
    case 'unknown_subject':
      return {
        error: 'session_unknown',
        message:
          'This session no longer belongs to anybody in the roster, so nothing was done. ' +
          'Sign in again.',
      }
    case 'deactivated':
      return {
        error: 'account_deactivated',
        message:
          'That account is deactivated, so it can no longer change anything here. ' +
          'An owner has to reactivate it first.',
      }
    case 'bootstrap_closed':
      return {
        error: 'bootstrap_closed',
        message:
          'The first-run session ended when the first sign in was created, so nothing was done. ' +
          'Sign in with your email and password.',
      }
    case 'no_session':
    default:
      // Byte-identical to `gateOrJson`, because this is the same fact and the interface
      // already reads it.
      return { error: 'not_authorised', message: 'This environment is gated.' }
  }
}

/**
 * The refusal for a caller already in hand, or null when the caller may proceed.
 *
 * Separate from `requirePermission` so a handler that needs the caller for a second rule (the
 * roster route needs it for the self-promotion guard) resolves it once and asks twice.
 */
export function permissionRefusal(caller: Caller, permissionKey: string): Response | null {
  if (callerCan(caller, permissionKey)) return null

  /*
   * The log line carries the permission inside `reason`, and that is not laziness. `lib/log`
   * redacts any field name that is not on its allow-list, so a new `permission` key would have
   * been written to the log as `[redacted:unlisted]` and every denial would have recorded that
   * something was refused without recording what. Measured, on the first run of this file.
   */
  if (caller.kind === 'anonymous') {
    const body = anonymousRefusal(caller.reason)
    log.warn('authz.denied', {
      outcome: 'denied',
      gate: 'permission',
      reason: `${caller.reason}: ${permissionKey}`,
    })
    return Response.json(body, { status: 401 })
  }

  if (caller.kind === 'bootstrap' && credentialedAccountCount() > 0) {
    /*
     * The first credential landed between resolving this caller and asking this question. The
     * door is shut now, so the honest answer is the shut-door answer and not "your role is too
     * small": there is no role here, there was a door and it closed.
     */
    log.warn('authz.denied', {
      outcome: 'denied',
      gate: 'permission',
      reason: `bootstrap_closed: ${permissionKey}`,
    })
    return Response.json(anonymousRefusal('bootstrap_closed'), { status: 401 })
  }

  const label = permission(permissionKey)?.label ?? permissionKey
  /*
   * `callerRoleName`, not a local ternary. This string goes into the 403 BODY the caller reads —
   * "Your role, X, does not include …" — so getting it wrong tells somebody what they are while
   * refusing them, and the two halves of that sentence then disagree.
   *
   * The literal it replaces was `'Break-glass'` for every non-account caller, which names an
   * OWNER-EQUIVALENT door. The same collapse was live in `app/(app)/layout.tsx`, where a caller
   * holding nothing was shown "Break-glass session" in the shell on every page. Fixed there too.
   *
   * In practice this branch is close to unreachable — the `bootstrap_closed` 401 above catches
   * anonymous callers, and a real bootstrap caller holds owner-equivalent permissions so it is not
   * denied here. "Close to unreachable" is not a reason to keep a wrong label: it is a reason
   * nobody would have caught it.
   */
  const roleName = callerRoleName(caller)
  log.warn('authz.denied', {
    outcome: 'denied',
    gate: 'permission',
    actor_id: callerAccountId(caller),
    membership_role: caller.kind === 'account' ? caller.account.roleKey : 'break-glass',
    reason: `role_lacks_permission: ${permissionKey}`,
  })
  return Response.json(
    {
      error: 'not_permitted',
      message:
        `Your role, ${roleName}, does not include "${label}", so nothing was changed. ` +
        'Ask an owner to change your role if you need it.',
    },
    { status: 403 },
  )
}

/**
 * THE ONE LINE A MUTATING ROUTE HANDLER RUNS BEFORE IT WRITES ANYTHING.
 *
 *   const denied = await requirePermission('supplier.pursue')
 *   if (denied) return denied
 *
 * It replaces `gateOrJson()` on every route that changes state. `gateOrJson` remains correct
 * for a read that any signed-in person may make, and it is never sufficient for a write.
 */
export async function requirePermission(permissionKey: string): Promise<Response | null> {
  return permissionRefusal(await readCaller(), permissionKey)
}
