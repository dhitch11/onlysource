import 'server-only'
import { buildUsers } from '@/lib/admin/directory'
import { readRoster, setOverride, updateMember, type RosterStatus } from '@/lib/admin/roster-store'
import { hashPassword, passwordProblem, verifyPassword } from './credentials'
import { role, type Role } from '@/lib/admin/permissions'

/**
 * ACCOUNTS. Real per-person sign in over the roster, replacing the shared pre-release phrase.
 *
 * ==========================================================================================
 * WHY THIS SITS ON THE ROSTER RATHER THAN ON A NEW TABLE.
 * ==========================================================================================
 * The roster is already the answer to "who is in this organization and what may they do". An
 * account is that same person plus a credential. Putting sign-in anywhere else would create a
 * second list of people that drifts from the first, and the first thing that drifts is who was
 * deactivated. So a credential is a field on the roster entry, and deactivating somebody in the
 * admin console takes their sign in away in the same write. One list, one truth.
 *
 * ==========================================================================================
 * THE RULES THIS ENFORCES, AND EACH IS A DELIBERATE REFUSAL.
 * ==========================================================================================
 *   - A DEACTIVATED USER CANNOT SIGN IN, whatever their password. The roster is the authority
 *     on access, not the credential store.
 *   - A USER WITH NO CREDENTIAL CANNOT SIGN IN. Being listed in the roster is not an account.
 *     Owner ruling 2026-08-16: exactly one login exists right now.
 *   - THE SAME ANSWER FOR EVERY FAILURE. Wrong password, unknown address, deactivated account
 *     and no-credential all return the identical refusal. Distinguishing them tells an attacker
 *     which addresses are real, which is how a credential-stuffing list gets refined for free.
 *   - THE WORK IS DONE EVEN WHEN THE ACCOUNT DOES NOT EXIST. An unknown address still pays for
 *     one scrypt verification against a dummy credential, so response time does not reveal
 *     whether the address is in the roster.
 */

export type Account = {
  id: string
  name: string
  email: string
  roleKey: string
  role: Role
  status: RosterStatus
  seeded: boolean
}

/**
 * A real credential, used only to burn the same CPU time on an unknown address that a known one
 * costs. Its plaintext is a random string nobody holds, so it can never be signed in with.
 */
const DUMMY_CREDENTIAL =
  'scrypt$32768$8$1$YWJjZGVmZ2hpamtsbW5vcA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

/**
 * A role key that matches no role. It holds NOTHING, and it says so where a role name is shown.
 *
 * This is the answer to a stored key the permission model does not recognise, which happens
 * when a role is deleted, renamed, or hand-edited into the state file. The previous answer was
 * the operator role, chosen by array index, and that is a silent grant: a typo in a JSON file
 * would have handed somebody the whole operator plane with nothing to see and nothing logged.
 */
const UNRECOGNISED_ROLE: Role = {
  key: 'unrecognised',
  name: 'Unrecognised role',
  plane: 'operator',
  permissions: [],
  builtin: false,
}

/** The role behind a stored key. Never a default, because a default role is a grant nobody made. */
function roleFor(key: string): Role {
  return role(key) ?? UNRECOGNISED_ROLE
}

type RosterCredential = { id: string; passwordHash: string | null }

/** Read the stored credential for an id, from wherever that id lives. Server only. */
function credentialFor(id: string): RosterCredential {
  const roster = readRoster()
  const added = roster.added.find((m) => m.id === id)
  if (added) return { id, passwordHash: added.passwordHash }
  return { id, passwordHash: roster.overrides[id]?.passwordHash ?? null }
}

/** Does this person have a sign in at all? Safe to expose: it is not a credential. */
export function hasCredential(id: string): boolean {
  return Boolean(credentialFor(id).passwordHash)
}

/** Every account with a credential. Used to decide whether the break-glass door is still open. */
export function credentialedAccountCount(): number {
  const roster = readRoster()
  const added = roster.added.filter((m) => m.passwordHash).length
  const overrides = Object.values(roster.overrides).filter((o) => o.passwordHash).length
  return added + overrides
}

export function findAccountByEmail(email: string): Account | null {
  const addr = email.trim().toLowerCase()
  if (!addr) return null
  const user = buildUsers(readRoster()).find((u) => u.email.toLowerCase() === addr)
  if (!user) return null
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleKey: user.roleKey,
    role: roleFor(user.roleKey),
    status: user.status,
    seeded: user.seeded,
  }
}

export function findAccountById(id: string): Account | null {
  const user = buildUsers(readRoster()).find((u) => u.id === id)
  if (!user) return null
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleKey: user.roleKey,
    role: roleFor(user.roleKey),
    status: user.status,
    seeded: user.seeded,
  }
}

export type SignInResult = { ok: true; account: Account } | { ok: false }

/**
 * Verify an email and password.
 *
 * Returns a bare `{ok:false}` on every failure, with no reason, on purpose. The CALLER logs the
 * distinction for operators; the BROWSER is told only that the pair did not work.
 */
export async function verifyCredentials(email: string, password: string): Promise<SignInResult> {
  const account = findAccountByEmail(email)
  const stored = account ? credentialFor(account.id).passwordHash : null

  // Always run one verification, even with nothing to verify against, so an unknown address
  // costs the same wall time as a known one.
  const matched = await verifyPassword(password, stored ?? DUMMY_CREDENTIAL)

  if (!account) return { ok: false }
  if (!stored) return { ok: false }
  if (account.status !== 'active') return { ok: false }
  if (!matched) return { ok: false }
  return { ok: true, account }
}

export type SetPasswordResult = { ok: true } | { ok: false; reason: string }

/**
 * Set or replace somebody's password. The plaintext is hashed here and never persisted, logged
 * or returned. Refuses on a deactivated account, because granting a sign in to somebody who has
 * been switched off is the kind of quiet contradiction that outlives the person who made it.
 */
export async function setPassword(id: string, password: string, nowMs: number): Promise<SetPasswordResult> {
  const problem = passwordProblem(password)
  if (problem) return { ok: false, reason: problem }

  const account = findAccountById(id)
  if (!account) return { ok: false, reason: 'That user is not in the roster.' }
  if (account.status !== 'active') {
    return { ok: false, reason: 'That account is deactivated, so a sign in cannot be set for it.' }
  }

  const passwordHash = await hashPassword(password)
  try {
    if (account.seeded) setOverride(id, { passwordHash }, nowMs)
    else updateMember(id, { passwordHash }, nowMs)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'That could not be written to the server state directory, so nothing was saved.' }
  }
}

/** Remove somebody's ability to sign in, without removing them from the roster. */
export function revokePassword(id: string, nowMs: number): { ok: boolean } {
  const account = findAccountById(id)
  if (!account) return { ok: false }
  try {
    const roster = readRoster()
    if (account.seeded) {
      const existing = roster.overrides[id]
      if (existing) delete existing.passwordHash
      setOverride(id, {}, nowMs)
    } else {
      updateMember(id, { passwordHash: null }, nowMs)
    }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
