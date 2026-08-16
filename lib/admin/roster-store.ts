import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ROLES } from './permissions'

/**
 * THE ROSTER STORE. The operator's real, persisted user list.
 *
 * ==========================================================================================
 * WHAT CHANGED, AND WHY IT IS NOW HONEST TO LET AN OPERATOR EDIT THIS SCREEN.
 * ==========================================================================================
 * The Admin screen used to disable every mutating control, and that was the correct call at
 * the time: there was no database, so a role change or a deactivation could not have been
 * saved, and a screen that accepts a change it cannot persist is worse than one that says it
 * cannot.
 *
 * There is still no database. There is now something better suited to a two person
 * organization: the same gitignored JSON state directory that already carries the deal
 * pipeline, the packet vault, the contacted suppliers and the alert settings. It survives a
 * deploy, it survives `git reset --hard`, and it is backed up with the server. So a change
 * made here IS saved, and the controls may honestly render enabled.
 *
 * THE THREE KINDS OF FACT, STILL NEVER BLURRED:
 *
 *   1. PRODUCT FACTS. The organization is ONLYSOURCE and it ships with two users, David
 *      Hitchman and David Goodreau, from `_intel/BUILD-DIRECTIVE.md`. Their NAME and EMAIL
 *      are product facts and this store deliberately cannot overwrite them. It can only
 *      carry what an operator legitimately decides: their role, their title, and whether the
 *      account is active.
 *
 *   2. OPERATOR FACTS. Anyone the operator adds, and every change the operator makes. Real,
 *      written to disk, read back on the next request. This file holds exactly those and
 *      nothing else.
 *
 *   3. FACTS THAT WOULD NEED A DATABASE AND AN IDENTITY PROVIDER. Who signed in last, who
 *      changed a role and when, whether an invitation was accepted. Not stored, not shown,
 *      not guessed. A "last active" column filled with a plausible date would be a
 *      fabrication in a settings screen, which is the same defect as a green dot on a
 *      connector that is not connected.
 *
 * ==========================================================================================
 * THE ONE THING THIS SCREEN MUST SAY OUT LOUD, BECAUSE IT WOULD OTHERWISE MISLEAD.
 * ==========================================================================================
 * Access to this build is ONE shared organization phrase. There is no per person sign in
 * yet. So adding a person to the roster records who is in the organization and what they may
 * do; it does not create a separate login and it does not send anybody an email. The surface
 * states that in plain words rather than letting an operator infer an invitation was sent.
 * `lib/admin/directory.ts` carries the sentence as `accessNote` so the interface and this
 * module can never drift apart on it.
 *
 * Shape on disk (`.state/admin-users.json`):
 *   { "overrides": { "seed:hitchman": { roleKey, title, status, updatedAt } },
 *     "added": [ { id, name, email, title, roleKey, status, createdAt, updatedAt } ] }
 *
 * Bad or unknown shapes coerce to safe values rather than throwing, exactly like the deal
 * store, because a hand edited or half written state file must never take the console down.
 * An unknown role coerces to `operator`, the least privileged real role, never to `owner`.
 */

export type RosterStatus = 'active' | 'deactivated'

/** A change an operator made to a seeded user. Name and email are absent by design. */
export type RosterOverride = {
  roleKey?: string
  title?: string
  status?: RosterStatus
  updatedAt: number
}

/** A user the operator added. Fully operator owned, so every field is editable. */
export type RosterMember = {
  id: string
  name: string
  email: string
  title: string
  roleKey: string
  status: RosterStatus
  createdAt: number
  updatedAt: number
}

export type Roster = {
  overrides: Record<string, RosterOverride>
  added: RosterMember[]
}

export const EMPTY_ROSTER: Roster = { overrides: {}, added: [] }

/** The safe landing role for a value that is not a real role key. Least privilege, never owner. */
const FALLBACK_ROLE = 'operator'

function knownRole(key: unknown): string {
  return typeof key === 'string' && ROLES.some((r) => r.key === key) ? key : FALLBACK_ROLE
}

export function isKnownRole(key: unknown): key is string {
  return typeof key === 'string' && ROLES.some((r) => r.key === key)
}

function coerceStatus(v: unknown): RosterStatus {
  return v === 'deactivated' ? 'deactivated' : 'active'
}

function stateDir(): string {
  return process.env.ONLYSOURCE_STATE_DIR || path.join(process.cwd(), '.state')
}

function filePath(): string {
  return path.join(stateDir(), 'admin-users.json')
}

function coerceOverride(raw: unknown): RosterOverride | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: RosterOverride = {
    updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
  }
  if (r.roleKey !== undefined) out.roleKey = knownRole(r.roleKey)
  if (typeof r.title === 'string') out.title = r.title
  if (r.status !== undefined) out.status = coerceStatus(r.status)
  return out
}

function coerceMember(raw: unknown): RosterMember | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id.trim() : ''
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  const email = typeof r.email === 'string' ? r.email.trim() : ''
  // An added user with no id, no name or no email is not a user, it is corruption. Dropping
  // the row is the honest read: rendering a nameless account would invent a person.
  if (!id || !name || !email) return null
  return {
    id,
    name,
    email,
    title: typeof r.title === 'string' ? r.title.trim() : '',
    roleKey: knownRole(r.roleKey),
    status: coerceStatus(r.status),
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
  }
}

/** Coerce any parsed value into a usable roster. Never throws, never returns null. */
export function coerceRoster(raw: unknown): Roster {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { overrides: {}, added: [] }
  const r = raw as Record<string, unknown>

  const overrides: Record<string, RosterOverride> = {}
  if (r.overrides && typeof r.overrides === 'object' && !Array.isArray(r.overrides)) {
    for (const [id, value] of Object.entries(r.overrides as Record<string, unknown>)) {
      if (!id.trim()) continue
      const o = coerceOverride(value)
      if (o) overrides[id] = o
    }
  }

  const added: RosterMember[] = []
  const seenIds = new Set<string>()
  if (Array.isArray(r.added)) {
    for (const value of r.added) {
      const m = coerceMember(value)
      // A duplicate id would make "remove this one" ambiguous, so the first wins.
      if (m && !seenIds.has(m.id)) {
        seenIds.add(m.id)
        added.push(m)
      }
    }
  }

  return { overrides, added }
}

export function readRoster(): Roster {
  try {
    const p = filePath()
    if (!existsSync(p)) return { overrides: {}, added: [] }
    return coerceRoster(JSON.parse(readFileSync(p, 'utf8')))
  } catch {
    return { overrides: {}, added: [] }
  }
}

/**
 * Write the roster. THIS ONE THROWS, deliberately.
 *
 * Every read in this module is fail soft, because a broken state file must not take the
 * console down. A WRITE is the opposite: if the change did not reach the disk, the operator
 * has to be told, or they will believe an account was deactivated when it was not. The route
 * handler catches this and answers with a stated failure instead of a cheerful 200.
 */
export function writeRoster(roster: Roster): void {
  const dir = stateDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath(), JSON.stringify(roster, null, 2), 'utf8')
}

/** Record a change to a seeded user. Name and email are not accepted, by design. */
export function setOverride(
  id: string,
  patch: { roleKey?: string; title?: string; status?: RosterStatus },
  nowMs: number,
): Roster {
  const roster = readRoster()
  const existing = roster.overrides[id] ?? { updatedAt: 0 }
  const merged = coerceOverride({ ...existing, ...patch, updatedAt: nowMs })
  if (!merged) return roster
  const next: Roster = {
    overrides: { ...roster.overrides, [id]: merged },
    added: roster.added,
  }
  writeRoster(next)
  return next
}

/** Add a user the operator owns entirely. */
export function addMember(member: RosterMember): Roster {
  const roster = readRoster()
  const next: Roster = {
    overrides: roster.overrides,
    added: [...roster.added, member],
  }
  writeRoster(next)
  return next
}

/** Patch an added user. Returns the roster unchanged when the id is not an added user. */
export function updateMember(
  id: string,
  patch: Partial<Omit<RosterMember, 'id' | 'createdAt'>>,
  nowMs: number,
): Roster {
  const roster = readRoster()
  if (!roster.added.some((m) => m.id === id)) return roster
  const added = roster.added.map((m) => {
    if (m.id !== id) return m
    return coerceMember({ ...m, ...patch, id: m.id, createdAt: m.createdAt, updatedAt: nowMs }) ?? m
  })
  const next: Roster = { overrides: roster.overrides, added }
  writeRoster(next)
  return next
}

/** Remove an added user. Seeded users are never removable and this never sees one. */
export function removeMember(id: string): Roster {
  const roster = readRoster()
  const next: Roster = {
    overrides: roster.overrides,
    added: roster.added.filter((m) => m.id !== id),
  }
  writeRoster(next)
  return next
}
